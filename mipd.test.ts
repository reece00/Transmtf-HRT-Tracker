import { describe, it, expect } from 'vitest';
import { Route, Ester, type DoseEvent, type LabResult } from './types';
import { runSimulation } from './pk';
import { computeE2AtTimeWithTheta, computeSimulationWithCI, initPersonalModel } from './personalModel';
import {
    fitMipd,
    fitMipdTimeline,
    mipdDrugE2AtTimeSorted,
    mipdPredict,
    gpResidualPredict,
    MIPD_DEFAULT_PRIOR,
    GP_RESIDUAL_DEFAULT,
    type MipdAnchor,
} from './mipd';

const DAY = 24;

function evDose(i: number, weightKG = 65, doseMG = 4): DoseEvent {
    return {
        id: `ev-${i}`,
        route: Route.injection,
        timeH: i * 7 * DAY,
        doseMG,
        ester: Ester.EV,
        weightKG,
        extras: {},
    };
}

/** Weekly EV injection schedule. */
function schedule(n: number): DoseEvent[] {
    return Array.from({ length: n }, (_, i) => evDose(i));
}

/** Build noise-free labs at given times from a known true η (drug-only signal). */
function cleanLabs(events: DoseEvent[], times: number[], eta: [number, number, number]): LabResult[] {
    const sorted = [...events].sort((a, b) => a.timeH - b.timeH);
    return times.map((t, k) => ({
        id: `lab-${k}`,
        timeH: t,
        concValue: Math.max(1, mipdDrugE2AtTimeSorted(sorted, t, eta)),
        unit: 'pg/ml' as const,
    }));
}

describe('Hybrid-MIPD forward model', () => {
    it('reproduces the population EKF curve exactly at η = 0 (aScale = kScale = s = 1)', () => {
        const events = schedule(8);
        const sorted = [...events].sort((a, b) => a.timeH - b.timeH);
        for (const t of [10 * DAY, 24 * DAY, 40 * DAY, 55 * DAY]) {
            const mipd = mipdDrugE2AtTimeSorted(sorted, t, [0, 0, 0]);
            const ekf = computeE2AtTimeWithTheta(events, t, [0, 0]);
            expect(mipd).toBeCloseTo(ekf, 6);
        }
    });

    it('absorption scale η_a shifts the curve (k1 actually changes)', () => {
        const events = schedule(6);
        const sorted = [...events].sort((a, b) => a.timeH - b.timeH);
        const t = 2 * DAY + 1 * 7 * DAY; // shortly after a dose (absorption phase)
        const base = mipdDrugE2AtTimeSorted(sorted, t, [0, 0, 0]);
        const faster = mipdDrugE2AtTimeSorted(sorted, t, [0, 0, 0.5]);
        expect(faster).not.toBeCloseTo(base, 3);
    });
});

describe('Hybrid-MIPD MAP fit — graceful degradation', () => {
    it('returns the population prior (η = 0, prior-dominated) with no labs', () => {
        const events = schedule(6);
        const fit = fitMipd(events, [], MIPD_DEFAULT_PRIOR);
        expect(fit.eta).toEqual([0, 0, 0]);
        expect(fit.nPostDose).toBe(0);
        expect(fit.priorDominated.every((b) => b)).toBe(true);
        expect(fit.converged).toBe(true);
    });

    it('accumulates an endogenous baseline from pre-dose labs only', () => {
        const events = schedule(6);
        const preDose: LabResult[] = [
            { id: 'pre1', timeH: -2 * DAY, concValue: 30, unit: 'pg/ml' },
            { id: 'pre2', timeH: -1 * DAY, concValue: 40, unit: 'pg/ml' },
        ];
        const fit = fitMipd(events, preDose, MIPD_DEFAULT_PRIOR);
        expect(fit.baselinePGmL).toBeCloseTo(35, 5);
        // Pre-dose labs carry no PK info → still prior.
        expect(fit.nPostDose).toBe(0);
    });
});

describe('Hybrid-MIPD MAP fit — individualisation', () => {
    it('recovers a known true parameter vector from many clean labs', () => {
        const events = schedule(12);
        const trueEta: [number, number, number] = [0.4, -0.2, 0.3];
        // Dense, phase-varied sampling so the likelihood dominates the prior.
        const times: number[] = [];
        for (let d = 3; d <= 9; d++) {
            times.push(d * 7 * DAY + 2 * DAY);    // near peak
            times.push(d * 7 * DAY + 6.5 * DAY);  // near trough
        }
        const labs = cleanLabs(events, times, trueEta);
        const fit = fitMipd(events, labs, MIPD_DEFAULT_PRIOR);
        expect(fit.converged).toBe(true);
        // MAP estimates are legitimately shrunk toward the prior mean (0); we
        // therefore require recovery of most of the magnitude with the correct
        // sign, not an exact match.
        expect(fit.eta[0]).toBeGreaterThan(0.20); // amplitude (true 0.4)
        expect(fit.eta[0]).toBeLessThan(0.50);
        expect(fit.eta[1]).toBeLessThan(-0.02);   // clearance (true -0.2), correct sign
        expect(fit.eta[1]).toBeGreaterThan(-0.40);
        // Absorption is harder; require correct sign and rough magnitude.
        expect(fit.eta[2]).toBeGreaterThan(0.1);  // (true 0.3)
        // With rich data the amplitude posterior should tighten meaningfully
        // below the prior (params are correlated, so each marginal stays partly
        // wide even when the joint fit is excellent — see the benchmark).
        expect(fit.informationGain[0]).toBeGreaterThan(0.2);
    });

    it('is robust to a single gross outlier lab (Student-t down-weighting)', () => {
        const events = schedule(12);
        const trueEta: [number, number, number] = [0.2, 0.0, 0.0];
        const times = [3 * 7 * DAY + 2 * DAY, 4 * 7 * DAY + 6.5 * DAY, 6 * 7 * DAY + 2 * DAY, 7 * 7 * DAY + 6.5 * DAY, 9 * 7 * DAY + 3 * DAY];
        const labs = cleanLabs(events, times, trueEta);
        const cleanFit = fitMipd(events, labs, MIPD_DEFAULT_PRIOR);

        // Corrupt one lab to 5× its true value.
        const corrupted = labs.map((l, i) => (i === 2 ? { ...l, concValue: l.concValue * 5 } : l));
        const robustFit = fitMipd(events, corrupted, MIPD_DEFAULT_PRIOR);

        // The amplitude estimate must not be dragged far toward the outlier.
        expect(Math.abs(robustFit.eta[0] - cleanFit.eta[0])).toBeLessThan(0.35);
        // The corrupted observation must receive a reduced robust weight.
        const corruptedAnchor = robustFit.anchors[2];
        expect(corruptedAnchor.weight).toBeLessThan(0.8);
    });

    it('flags absorption as prior-dominated when only trough labs are available', () => {
        const events = schedule(12);
        const trueEta: [number, number, number] = [0.3, 0.0, 0.0];
        // Trough-only sampling: cannot identify absorption.
        const times = [3, 5, 7, 9].map((d) => d * 7 * DAY + 6.7 * DAY);
        const labs = cleanLabs(events, times, trueEta);
        const fit = fitMipd(events, labs, MIPD_DEFAULT_PRIOR);
        expect(fit.priorDominated[2]).toBe(true); // absorption not identified
    });
});

describe('Hybrid-MIPD predictive uncertainty', () => {
    it('produces ordered, finite, positive CI bands through computeSimulationWithCI', () => {
        const events = schedule(10);
        const labs = cleanLabs(events, [3 * 7 * DAY + 2 * DAY, 5 * 7 * DAY + 6.5 * DAY, 7 * 7 * DAY + 2 * DAY], [0.25, -0.1, 0.2]);
        const sim = runSimulation(events);
        const state = initPersonalModel();
        const ci = computeSimulationWithCI(sim, events, state, false, labs, 'hybrid-mipd', false, 'retrospective');
        expect(ci.e2Adjusted.length).toBe(sim.timeH.length);
        for (let i = 0; i < ci.timeH.length; i += 37) {
            expect(Number.isFinite(ci.e2Adjusted[i])).toBe(true);
            expect(ci.ci95Low[i]).toBeGreaterThanOrEqual(0);
            expect(ci.ci95Low[i]).toBeLessThanOrEqual(ci.ci68Low[i] + 1e-6);
            expect(ci.ci68Low[i]).toBeLessThanOrEqual(ci.ci68High[i] + 1e-6);
            expect(ci.ci68High[i]).toBeLessThanOrEqual(ci.ci95High[i] + 1e-6);
        }
    });

    it('with 0 labs the hybrid-mipd curve equals the raw population curve', () => {
        const events = schedule(6);
        const sim = runSimulation(events);
        const ci = computeSimulationWithCI(sim, events, initPersonalModel(), false, [], 'hybrid-mipd', false, 'retrospective');
        for (let i = 0; i < sim.timeH.length; i += 53) {
            // η = 0, no baseline, no Jensen shift on the central line ⇒ the
            // MIPD curve falls back exactly onto the population curve.
            const pop = sim.concPGmL_E2[i];
            if (pop < 1) continue; // skip near-zero points where relative error is noisy
            expect(ci.e2Adjusted[i]).toBeGreaterThan(pop * 0.98);
            expect(ci.e2Adjusted[i]).toBeLessThan(pop * 1.02);
        }
    });
});

describe('Hybrid-MIPD causal vs retrospective semantics', () => {
    it('in causal mode, a later lab never rewrites earlier estimates', () => {
        const events = schedule(12);
        const earlyLabs = cleanLabs(events, [3 * 7 * DAY + 2 * DAY, 4 * 7 * DAY + 6.5 * DAY], [0.3, -0.1, 0.2]);
        const laterLab = cleanLabs(events, [9 * 7 * DAY + 2 * DAY], [0.3, -0.1, 0.2]);
        const sim = runSimulation(events);
        const state = initPersonalModel();

        const before = computeSimulationWithCI(sim, events, state, false, earlyLabs, 'hybrid-mipd', false, 'causal');
        const after = computeSimulationWithCI(sim, events, state, false, [...earlyLabs, ...laterLab], 'hybrid-mipd', false, 'causal');

        const cutoff = laterLab[0].timeH;
        for (let i = 0; i < sim.timeH.length; i++) {
            if (sim.timeH[i] < cutoff) {
                expect(after.e2Adjusted[i]).toBeCloseTo(before.e2Adjusted[i], 6);
            }
        }
    });
});

describe('F22: patch removal targets one physical patch (MIPD forward model)', () => {
    const DAY24 = 24;
    const patchApply = (id: string, timeH: number, doseMG = 0.1): DoseEvent => ({
        id, route: Route.patchApply, timeH, doseMG, ester: Ester.E2, weightKG: 70,
        extras: { patchInstanceId: id },
    });
    const patchRemove = (id: string, timeH: number, target?: string): DoseEvent => ({
        id, route: Route.patchRemove, timeH, doseMG: 0, ester: Ester.E2, weightKG: 70,
        extras: target !== undefined ? { patchRemovalFor: target } : {},
    });

    it('a targeted removal terminates only its patch (η = 0 matches the EKF forward model)', () => {
        const events = [patchApply('p1', 0), patchApply('p2', DAY24), patchRemove('r1', 2 * DAY24, 'p1')];
        const sorted = [...events].sort((a, b) => a.timeH - b.timeH);
        const mipd = mipdDrugE2AtTimeSorted(sorted, 60, [0, 0, 0]);
        const ekf = computeE2AtTimeWithTheta(events, 60, [0, 0]);
        expect(mipd).toBeCloseTo(ekf, 6);
        // p2 is still active, so the level must be far above both-removed.
        expect(mipd).toBeGreaterThan(5);
    });

    it('legacy no-id data keeps the old both-applies-terminated behaviour', () => {
        const legacy = [patchApply('p1', 0), patchApply('p2', DAY24), patchRemove('r1', 2 * DAY24)]
            .map(e => ({ ...e, extras: {} }));
        const sorted = [...legacy].sort((a, b) => a.timeH - b.timeH);
        const mipd = mipdDrugE2AtTimeSorted(sorted, 60, [0, 0, 0]);
        const ekf = computeE2AtTimeWithTheta(legacy, 60, [0, 0]);
        expect(mipd).toBeCloseTo(ekf, 6);
        expect(mipd).toBeLessThan(1); // both patches removed at 48 h → only tails
    });
});


describe('GP residual layer', () => {
    it('returns a trivial correction below the anchor threshold', () => {
        const anchors: MipdAnchor[] = [
            { timeH: 0, logResidual: 0.3, weight: 1 },
            { timeH: 100, logResidual: 0.25, weight: 1 },
        ];
        const out = gpResidualPredict(anchors, 50, GP_RESIDUAL_DEFAULT);
        expect(out.mean).toBe(0);
        expect(out.var).toBe(0);
    });

    it('interpolates a bounded correction near consistent anchors', () => {
        const anchors: MipdAnchor[] = [
            { timeH: 0, logResidual: 0.3, weight: 1 },
            { timeH: 24, logResidual: 0.32, weight: 1 },
            { timeH: 48, logResidual: 0.28, weight: 1 },
            { timeH: 72, logResidual: 0.31, weight: 1 },
        ];
        const out = gpResidualPredict(anchors, 36, GP_RESIDUAL_DEFAULT);
        expect(out.mean).toBeGreaterThan(0.1);
        expect(Math.abs(out.mean)).toBeLessThanOrEqual(GP_RESIDUAL_DEFAULT.bound + 1e-9);
        expect(out.var).toBeGreaterThanOrEqual(0);
    });
});

describe('Hybrid-MIPD timeline', () => {
    it('builds one snapshot per lab prefix plus the prior', () => {
        const events = schedule(8);
        const labs = cleanLabs(events, [3 * 7 * DAY + 2 * DAY, 5 * 7 * DAY + 6.5 * DAY], [0.2, 0, 0]);
        const timeline = fitMipdTimeline(events, labs, MIPD_DEFAULT_PRIOR);
        expect(timeline.length).toBe(labs.length + 1);
        expect(timeline[0].timeH).toBe(-Infinity);
        expect(timeline[0].fit.nPostDose).toBe(0);
        expect(timeline[timeline.length - 1].fit.nPostDose).toBe(2);
    });
});
