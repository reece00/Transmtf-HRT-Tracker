// Request/response protocol shared by the PK Web Worker (pkWorker.ts), the
// compute implementation (pkCompute.ts) and the main-thread client
// (pkWorkerClient.ts). All payloads are plain structured-cloneable JSON — the
// PK types involved (DoseEvent, LabResult, SimulationResult,
// PersonalModelState, ...) already are, so no custom (de)serialisation exists.
import type { DoseEvent, LabResult, SimulationResult } from '../../types';
import type { GelProductSpec } from '../../pk';
import type { CalibrationModel, CalibrationMode } from '../../calibration';
import type {
    PersonalModelState,
    EKFDiagnostics,
    computeSimulationWithCI,
} from '../../personalModel';

export type PKWorkerKind = 'simulation' | 'personalModel' | 'ci';

/** Return shape of computeSimulationWithCI, re-exported as a named type. */
export type SimCIResult = ReturnType<typeof computeSimulationWithCI>;

export type PKWorkerRequest =
    | {
        type: 'simulation';
        id: number;
        events: DoseEvent[];
        gelProducts?: GelProductSpec[];
        /**
         * F03: optional grid extension (hours since epoch). The simulation grid
         * ends at max(lastEvent + 14d, endTimeH) so "current value" interpolation
         * never freezes on the 14-day tail clamp.
         */
        endTimeH?: number;
    }
    | {
        type: 'personalModel';
        id: number;
        events: DoseEvent[];
        labResults: LabResult[];
        gelProducts?: GelProductSpec[];
    }
    | {
        type: 'ci';
        id: number;
        simulation: SimulationResult;
        events: DoseEvent[];
        model: PersonalModelState;
        applyE2LearningToCPA: boolean;
        labResults: LabResult[];
        calibrationModel: CalibrationModel;
        applyCPAInhibitionToE2: boolean;
        calibrationMode: CalibrationMode;
        gelProducts?: GelProductSpec[];
    };

export type PKWorkerResponse =
    | { type: 'simulation'; id: number; simulation: SimulationResult | null }
    | { type: 'personalModel'; id: number; model: PersonalModelState; diagnostics: EKFDiagnostics }
    | { type: 'ci'; id: number; simCI: SimCIResult }
    | { type: 'error'; id: number; message: string };

export type PKWorkerPayload<K extends PKWorkerKind> = Omit<Extract<PKWorkerRequest, { type: K }>, 'type' | 'id'>;

export type PKWorkerResult<K extends PKWorkerKind> =
    K extends 'simulation' ? SimulationResult | null
    : K extends 'personalModel' ? { model: PersonalModelState; diagnostics: EKFDiagnostics }
    : SimCIResult;
