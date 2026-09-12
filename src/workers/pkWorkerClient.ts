// Main-thread client for the PK Web Worker. Wraps one lazily-created Worker
// per compute kind (simulation / personalModel / ci) so that cancelling one
// kind never kills another kind's in-flight work — the three compute effects
// in AppDataContext cascade off each other's results (a fresh `simulation`
// re-triggers the CI effect while the personal-model replay may still be
// running), and a shared worker + cancelAll() there would drop the replay.
//
// Cancellation: terminating the worker is the only reliable cross-browser way
// to stop an in-flight compute, so `cancel`/`cancelAll` bump a per-slot epoch,
// reject all pending requests as PKWorkerCancelledError, terminate the worker
// and let the next `run` recreate it. Responses that still arrive from a
// superseded epoch are dropped.
import { computePK } from './pkCompute';
import type {
    PKWorkerKind,
    PKWorkerPayload,
    PKWorkerRequest,
    PKWorkerResponse,
    PKWorkerResult,
} from './pkWorkerProtocol';

/** Marker for promises settled by cancellation; effects drop these silently. */
export class PKWorkerCancelledError extends Error {
    readonly kind: PKWorkerKind;
    constructor(kind: PKWorkerKind) {
        super(`pk worker request cancelled (${kind})`);
        this.name = 'PKWorkerCancelledError';
        this.kind = kind;
    }
}

interface PendingRequest {
    epoch: number;
    resolve: (value: never) => void;
    reject: (err: unknown) => void;
}

interface WorkerSlot {
    worker: Worker;
    /** Bumped on every cancel; responses from an older epoch are dropped. */
    epoch: number;
    nextId: number;
    pending: Map<number, PendingRequest>;
}

function resultOf(response: PKWorkerResponse): unknown {
    switch (response.type) {
        case 'simulation': return response.simulation;
        case 'personalModel': return { model: response.model, diagnostics: response.diagnostics };
        case 'ci': return response.simCI;
        case 'error': throw new Error(response.message);
    }
}

class PKWorkerClient {
    private slots = new Map<PKWorkerKind, WorkerSlot>();

    run<K extends PKWorkerKind>(kind: K, payload: PKWorkerPayload<K>): Promise<PKWorkerResult<K>> {
        if (typeof Worker === 'undefined') {
            // No Worker (vitest node env, exotic runtimes): fall back to
            // synchronous in-memory compute on the calling thread. The gel
            // registry is shared with the app here, and AppDataContext sets it
            // synchronously before calling us, so computePK's own set is
            // idempotent.
            try {
                const response = computePK({ type: kind, id: 0, ...payload } as PKWorkerRequest);
                return Promise.resolve(resultOf(response) as PKWorkerResult<K>);
            } catch (err) {
                return Promise.reject(err);
            }
        }
        const slot = this.ensureSlot(kind);
        const id = slot.nextId++;
        const epoch = slot.epoch;
        return new Promise<PKWorkerResult<K>>((resolve, reject) => {
            slot.pending.set(id, { epoch, resolve: resolve as (value: never) => void, reject });
            slot.worker.postMessage({ type: kind, id, ...payload });
        });
    }

    /** Cancel all in-flight work of one kind; the next run() recreates its worker. */
    cancel(kind: PKWorkerKind): void {
        const slot = this.slots.get(kind);
        if (!slot) return;
        slot.epoch++;
        for (const p of slot.pending.values()) {
            p.reject(new PKWorkerCancelledError(kind));
        }
        slot.pending.clear();
        slot.worker.terminate();
        this.slots.delete(kind);
    }

    /** Cancel everything in flight across all kinds. */
    cancelAll(): void {
        for (const kind of Array.from(this.slots.keys())) {
            this.cancel(kind);
        }
    }

    private ensureSlot(kind: PKWorkerKind): WorkerSlot {
        const existing = this.slots.get(kind);
        if (existing) return existing;

        const worker = new Worker(new URL('./pkWorker.ts', import.meta.url), { type: 'module' });
        const slot: WorkerSlot = { worker, epoch: 0, nextId: 1, pending: new Map() };

        worker.onmessage = (ev: MessageEvent<PKWorkerResponse>) => {
            const response = ev.data;
            const p = slot.pending.get(response.id);
            if (!p) return;
            slot.pending.delete(response.id);
            if (p.epoch !== slot.epoch) return; // stale response from a superseded worker
            try {
                p.resolve(resultOf(response) as never);
            } catch (err) {
                p.reject(err);
            }
        };
        worker.onerror = (ev) => {
            // Worker-level failure (e.g. script load error): fail everything
            // pending on this kind and drop the slot so the next run retries
            // with a fresh worker.
            const message = ev.message || 'pk worker error';
            for (const p of slot.pending.values()) {
                p.reject(new Error(message));
            }
            slot.pending.clear();
            worker.terminate();
            this.slots.delete(kind);
        };

        this.slots.set(kind, slot);
        return slot;
    }
}

export const pkWorker = new PKWorkerClient();
