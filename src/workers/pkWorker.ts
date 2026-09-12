// PK computation Web Worker (F07). Vite bundles this module as a dedicated
// worker chunk from the `new Worker(new URL('./pkWorker.ts', import.meta.url))`
// reference in pkWorkerClient.ts.
//
// The worker owns one copy of the PK engine, whose custom-gel registry is
// module-global. Requests are serialised through the queue below so each
// request observes a consistent registry: set registry → compute → respond,
// with no interleaving in between.
import { computePK } from './pkCompute';
import type { PKWorkerRequest, PKWorkerResponse } from './pkWorkerProtocol';

// Minimal facade over the worker global: avoids pulling in the `webworker`
// lib (which would collide with the project's DOM lib in a shared program).
interface PKWorkerGlobal {
    onmessage: ((ev: MessageEvent<PKWorkerRequest>) => void) | null;
    postMessage(response: PKWorkerResponse): void;
}
const w = self as unknown as PKWorkerGlobal;

const queue: PKWorkerRequest[] = [];
let processing = false;

function drain(): void {
    if (processing) return;
    processing = true;
    try {
        while (queue.length > 0) {
            const request = queue.shift()!;
            w.postMessage(computePK(request));
        }
    } finally {
        processing = false;
    }
}

w.onmessage = (ev) => {
    queue.push(ev.data);
    drain();
};
