// Shared PK compute implementation, used by BOTH the Web Worker (pkWorker.ts)
// and the client's synchronous fallback (pkWorkerClient.ts) for environments
// without Worker support (vitest node env, etc.).
//
// The PK engine's custom-gel registry (setCustomGelProducts in pk.ts) is
// module-global, so every request MUST set the registry before computing. The
// worker serialises requests through a queue (see pkWorker.ts), which makes
// set-then-compute atomic per request even though the registry is shared.
import { runSimulation, setCustomGelProducts } from '../../pk';
import {
    replayPersonalModel,
    ekfUpdatePersonalModel,
    initPersonalModel,
    computeSimulationWithCI,
} from '../../personalModel';
import type { PKWorkerRequest, PKWorkerResponse } from './pkWorkerProtocol';

export function computePK(request: PKWorkerRequest): PKWorkerResponse {
    const { id } = request;
    try {
        switch (request.type) {
            case 'simulation': {
                if (request.gelProducts) setCustomGelProducts(request.gelProducts);
                const simulation = runSimulation(request.events);
                return { type: 'simulation', id, simulation };
            }
            case 'personalModel': {
                if (request.gelProducts) setCustomGelProducts(request.gelProducts);
                const { events, labResults } = request;
                // Replay EKF from the prior using all sorted lab results.
                const model = replayPersonalModel(events, labResults);
                // Derive last diagnostics from the most recent lab point: replay
                // the prior state (n-1 labs) and run the update for the last lab
                // against it — identical to the derivation the context used to
                // perform inline.
                const sorted = [...labResults].sort((a, b) => a.timeH - b.timeH);
                const lastLab = sorted[sorted.length - 1];
                const priorModel = labResults.length > 1
                    ? replayPersonalModel(events, sorted.slice(0, -1))
                    : initPersonalModel();
                const { diagnostics } = ekfUpdatePersonalModel(
                    events, priorModel, lastLab,
                    labResults.length > 1 ? sorted[sorted.length - 2].timeH : undefined
                );
                return { type: 'personalModel', id, model, diagnostics };
            }
            case 'ci': {
                if (request.gelProducts) setCustomGelProducts(request.gelProducts);
                const simCI = computeSimulationWithCI(
                    request.simulation,
                    request.events,
                    request.model,
                    request.applyE2LearningToCPA,
                    request.labResults,
                    request.calibrationModel,
                    request.applyCPAInhibitionToE2,
                    request.calibrationMode
                );
                return { type: 'ci', id, simCI };
            }
        }
    } catch (err) {
        return { type: 'error', id, message: err instanceof Error ? err.message : String(err) };
    }
}
