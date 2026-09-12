import { describe, it, expect } from 'vitest';
import { parseImportedBackup, precheckImportedBackup, importHasContent, importFallbackWeight, buildRepairedBackup } from './importData';
import { Ester, Route } from '../../types';

const ev = { timeH: 100, doseMG: 1.5, route: 'gel', ester: 'E2', weightKG: 70, extras: {} };
const lab = { timeH: 50, concValue: 120, unit: 'pmol/l' };
const gel = { id: 1000, name: 'X', kPenBase: 0.14, kLoss: 1.26, kRel: 0.022, concentrationMGmL: 1, defaultAreaCM2: 400 };

describe('parseImportedBackup — partial sections use null = "keep existing"', () => {
    it('gel-only backup: labResults and events sections are absent → null', () => {
        const r = parseImportedBackup({ gelProducts: [gel] }, 70);
        expect(r.events).toBeNull();          // absent → keep existing
        expect(r.labResults).toBeNull();       // absent → keep existing
        expect(r.gelProducts).toHaveLength(1); // present
        expect(importHasContent(r)).toBe(true);
    });

    it('events-only legacy top-level array: labs/gel absent → null (labs preserved)', () => {
        const r = parseImportedBackup([ev], 70);
        expect(r.events).toHaveLength(1);
        expect(r.labResults).toBeNull();
        expect(r.gelProducts).toBeNull();
    });

    it('labResults: [] is PRESENT-but-empty → [] (clears), not null', () => {
        const r = parseImportedBackup({ labResults: [] }, 70);
        expect(r.labResults).toEqual([]);      // present → clear
        expect(importHasContent(r)).toBe(true); // valid import (intent: clear labs)
    });

    it('full backup overwrites all three sections', () => {
        const r = parseImportedBackup({ events: [ev], labResults: [lab], gelProducts: [gel] }, 70);
        expect(r.events).toHaveLength(1);
        expect(r.labResults).toHaveLength(1);
        expect(r.gelProducts).toHaveLength(1);
    });

    it('empty object / garbage is not valid content', () => {
        expect(importHasContent(parseImportedBackup({}, 70))).toBe(false);
        expect(importHasContent(parseImportedBackup(42, 70))).toBe(false);
    });

    it('counts rows migrated for missing per-dose weight, using fallback', () => {
        const r = parseImportedBackup({ events: [{ timeH: 1, doseMG: 1, route: 'gel', ester: 'E2', extras: {} }] }, 65);
        expect(r.events[0].weightKG).toBe(65);
        expect(r.migratedCount).toBe(1);
    });

    it('accepts EU injection rows through the enum validator', () => {
        const r = parseImportedBackup({
            events: [{ timeH: 1, doseMG: 100, route: Route.injection, ester: Ester.EU, weightKG: 70, extras: {} }],
        }, 70);
        expect(r.events).toHaveLength(1);
        expect(r.events[0].route).toBe(Route.injection);
        expect(r.events[0].ester).toBe(Ester.EU);
    });

    it('drops rows with unknown route or ester instead of force-casting them', () => {
        const r = parseImportedBackup({
            events: [
                ev,
                { timeH: 1, doseMG: 100, route: 'injection', ester: 'EUU', weightKG: 70, extras: {} },
                { timeH: 2, doseMG: 100, route: 'implant', ester: 'EU', weightKG: 70, extras: {} },
            ],
        }, 70);
        expect(r.events).toHaveLength(1);
        expect(r.events[0].ester).toBe(Ester.E2);
    });

    it('drops corrupt gel products via the shared sanitizer (id<1000, NaN rate)', () => {
        const r = parseImportedBackup({ gelProducts: [gel, { id: 1, ...gel, id2: 0 }, { id: 1001, name: 'bad', kPenBase: NaN, kLoss: 1, kRel: 1 }] }, 70);
        expect(r.gelProducts).toHaveLength(1);
        expect(r.gelProducts![0].id).toBe(1000);
    });
});

describe('importFallbackWeight', () => {
    it('uses top-level weight when valid, else the default', () => {
        expect(importFallbackWeight({ weight: 80 }, 70)).toBe(80);
        expect(importFallbackWeight({ weight: -5 }, 70)).toBe(70);
        expect(importFallbackWeight([], 70)).toBe(70);
    });
});

describe('precheckImportedBackup — corrupt rows are rejected, never coerced', () => {
    it('rejects null / empty-string / boolean timeH instead of importing them as time 0', () => {
        const pre = precheckImportedBackup({
            events: [
                { timeH: null, doseMG: 1, route: 'gel', ester: 'E2', weightKG: 70, extras: {} },
                { timeH: '', doseMG: 1, route: 'gel', ester: 'E2', weightKG: 70, extras: {} },
                { timeH: false, doseMG: 1, route: 'gel', ester: 'E2', weightKG: 70, extras: {} },
                ev,
            ],
        }, 70);
        expect(pre.events).toHaveLength(1);
        expect(pre.events![0].timeH).toBe(100);
        expect(pre.events!.every(e => e.timeH !== 0)).toBe(true);
        expect(pre.stats.eventsRejected).toHaveLength(3);
        expect(pre.stats.eventsRejected.every(r => r.reason === 'invalid time')).toBe(true);
    });

    it('rejects negative doses and dose 0, except patchRemove where 0 is valid', () => {
        const pre = precheckImportedBackup({
            events: [
                { timeH: 1, doseMG: -5, route: 'gel', ester: 'E2', weightKG: 70, extras: {} },
                { timeH: 2, doseMG: 0, route: 'gel', ester: 'E2', weightKG: 70, extras: {} },
                { timeH: 3, doseMG: 0, route: Route.patchRemove, ester: 'E2', weightKG: 70, extras: {} },
            ],
        }, 70);
        expect(pre.events).toHaveLength(1);
        expect(pre.events![0].route).toBe(Route.patchRemove);
        expect(pre.stats.eventsRejected.map(r => r.index)).toEqual([0, 1]);
        expect(pre.stats.eventsRejected.every(r => r.reason === 'invalid dose')).toBe(true);
    });

    it('reassigns duplicate ids to fresh uuids (data kept, uniqueness restored)', () => {
        const pre = precheckImportedBackup({
            events: [
                { id: 'dup', timeH: 1, doseMG: 1, route: 'gel', ester: 'E2', weightKG: 70, extras: {} },
                { id: 'dup', timeH: 2, doseMG: 1, route: 'gel', ester: 'E2', weightKG: 70, extras: {} },
            ],
        }, 70);
        expect(pre.events).toHaveLength(2);
        expect(pre.events![0].id).toBe('dup');
        expect(pre.events![1].id).not.toBe('dup');
        expect(new Set(pre.events!.map(e => e.id)).size).toBe(2);
        expect(pre.stats.duplicateIdCount).toBe(1);
    });

    it('rejects unknown lab units instead of guessing pmol/l', () => {
        const pre = precheckImportedBackup({
            labResults: [
                { timeH: 1, concValue: 100, unit: 'ng/ml' },
                { timeH: 2, concValue: 50, unit: 'pmol/l' },
            ],
        }, 70);
        expect(pre.labResults).toHaveLength(1);
        expect(pre.labResults![0].unit).toBe('pmol/l');
        expect(pre.stats.labsRejected).toEqual([{ index: 0, reason: 'unknown unit' }]);
        expect(pre.stats.unknownUnitCount).toBe(1);
    });
});

describe('precheckImportedBackup — fatal errors and section presence', () => {
    it('flags a non-empty all-rejected labResults section as fatal, but not explicit []', () => {
        const fatal = precheckImportedBackup({
            labResults: [
                { timeH: null, concValue: 100, unit: 'pmol/l' },
                { timeH: 2, concValue: 'x', unit: 'pmol/l' },
            ],
        }, 70);
        expect(fatal.labResults).toEqual([]);
        expect(fatal.fatalErrors).toHaveLength(1);
        expect(fatal.fatalErrors[0]).toContain('labResults: 2 rows, all rejected');

        const empty = precheckImportedBackup({ labResults: [] }, 70);
        expect(empty.labResults).toEqual([]);
        expect(empty.stats.labsTotal).toBe(0);
        expect(empty.fatalErrors).toEqual([]);
    });

    it('flags an all-rejected non-empty events section as fatal (legacy array format too)', () => {
        const pre = precheckImportedBackup([{ timeH: null, doseMG: 1, route: 'gel', ester: 'E2', extras: {} }], 70);
        expect(pre.events).toEqual([]);
        expect(pre.fatalErrors).toHaveLength(1);
        expect(pre.fatalErrors[0]).toContain('events: 1 rows, all rejected');
    });

    it('absent events section → null (keep existing); explicit events: [] → [] (clear)', () => {
        expect(precheckImportedBackup({ labResults: [lab] }, 70).events).toBeNull();
        const pre = precheckImportedBackup({ events: [], labResults: [lab] }, 70);
        expect(pre.events).toEqual([]);
        expect(importHasContent(pre)).toBe(true);
    });

    it('reports stats counts and missing gel product references', () => {
        const pre = precheckImportedBackup({
            events: [
                { timeH: 1, doseMG: 1, route: 'gel', ester: 'E2', weightKG: 70, extras: { gelProductId: 2000 } },
                { timeH: null, doseMG: 1, route: 'gel', ester: 'E2', weightKG: 70, extras: {} },
            ],
            gelProducts: [gel],
        }, 70);
        expect(pre.stats.eventsTotal).toBe(2);
        expect(pre.stats.eventsAccepted).toBe(1);
        expect(pre.stats.eventsRejected).toEqual([{ index: 1, reason: 'invalid time' }]);
        expect(pre.stats.gelsTotal).toBe(1);
        expect(pre.stats.gelsAccepted).toBe(1);
        expect(pre.stats.gelsRejectedCount).toBe(0);
        expect(pre.stats.missingGelRefs).toEqual([2000]);
        expect(pre.warnings.some(w => w.includes('gelProductId: 2000'))).toBe(true);
        expect(pre.fatalErrors).toEqual([]);
    });

    it('built-in preset gel ids are never reported missing', () => {
        const pre = precheckImportedBackup({
            events: [{ timeH: 1, doseMG: 1, route: 'gel', ester: 'E2', weightKG: 70, extras: { gelProductId: 1 } }],
        }, 70);
        expect(pre.stats.missingGelRefs).toEqual([]);
    });
});

describe('precheckImportedBackup — per-row gel validation', () => {
    it('reports a concrete reason for every rejected gel row', () => {
        const pre = precheckImportedBackup({
            gelProducts: [
                gel,
                { id: 1, name: 'preset-shadow', kPenBase: 0.1, kLoss: 1, kRel: 0.02 },
                { id: 1002, name: 'bad', kPenBase: NaN, kLoss: 1, kRel: 1 },
            ],
        }, 70);
        expect(pre.gelProducts).toHaveLength(1);
        expect(pre.stats.gelsRejected).toEqual([
            { index: 1, reason: 'id below 1000' },
            { index: 2, reason: 'missing kPenBase' },
        ]);
        expect(pre.stats.gelsRejectedCount).toBe(2);
        expect(pre.warnings.some(w => w.includes('gelProducts: 2 row(s) rejected'))).toBe(true);
        expect(pre.fatalErrors).toEqual([]);
    });

    it('flags a non-empty all-rejected gelProducts section as fatal', () => {
        const pre = precheckImportedBackup({
            gelProducts: [{ id: 1, name: 'x', kPenBase: 0.1, kLoss: 1, kRel: 0.02 }],
        }, 70);
        expect(pre.gelProducts).toEqual([]);
        expect(pre.fatalErrors).toHaveLength(1);
        expect(pre.fatalErrors[0]).toContain('gelProducts: 1 rows, all rejected');
    });

    it('duplicate gel ids keep the first row and reject the later one (ids are registry keys, not reassigned)', () => {
        const pre = precheckImportedBackup({ gelProducts: [gel, { ...gel }] }, 70);
        expect(pre.gelProducts).toHaveLength(1);
        expect(pre.gelProducts![0].id).toBe(1000);
        expect(pre.stats.gelsRejected).toEqual([{ index: 1, reason: 'duplicate id' }]);
    });
});

describe('precheckImportedBackup — malformed sections', () => {
    it('present-but-not-array sections warn with the received type and are treated as absent', () => {
        const pre = precheckImportedBackup({ events: 'foo', labResults: 42, gelProducts: [gel] }, 70);
        expect(pre.events).toBeNull();
        expect(pre.labResults).toBeNull();
        expect(pre.gelProducts).toHaveLength(1);
        expect(pre.warnings.some(w => w.includes('events') && w.includes('string'))).toBe(true);
        expect(pre.warnings.some(w => w.includes('labResults') && w.includes('number'))).toBe(true);
        expect(pre.fatalErrors).toEqual([]);
    });

    it('events: null counts as absent, not malformed', () => {
        const pre = precheckImportedBackup({ events: null, labResults: [lab] }, 70);
        expect(pre.events).toBeNull();
        expect(pre.warnings.every(w => !w.includes('not an array'))).toBe(true);
    });
});

describe('precheckImportedBackup — strict numerics and lab id dedup', () => {
    it('rejects null/\'\'/false doses; missing dose on patchRemove → 0; numeric strings accepted', () => {
        const pre = precheckImportedBackup({
            events: [
                { timeH: 1, doseMG: null, route: 'gel', ester: 'E2', weightKG: 70, extras: {} },
                { timeH: 2, doseMG: '', route: 'gel', ester: 'E2', weightKG: 70, extras: {} },
                { timeH: 3, doseMG: false, route: 'gel', ester: 'E2', weightKG: 70, extras: {} },
                { timeH: 4, route: Route.patchRemove, ester: 'E2', weightKG: 70, extras: {} },
                { timeH: 5, doseMG: '2.5', route: 'gel', ester: 'E2', weightKG: 70, extras: {} },
            ],
        }, 70);
        expect(pre.events).toHaveLength(2);
        expect(pre.events![0].route).toBe(Route.patchRemove);
        expect(pre.events![0].doseMG).toBe(0);
        expect(pre.events![1].doseMG).toBe(2.5);
        expect(pre.stats.eventsRejected.map(r => r.index)).toEqual([0, 1, 2]);
        expect(pre.stats.eventsRejected.every(r => r.reason === 'invalid dose')).toBe(true);
    });

    it('rejects null/\'\'/false lab concValue; numeric strings accepted', () => {
        const pre = precheckImportedBackup({
            labResults: [
                { timeH: 1, concValue: null, unit: 'pmol/l' },
                { timeH: 2, concValue: '', unit: 'pmol/l' },
                { timeH: 3, concValue: false, unit: 'pmol/l' },
                { timeH: 4, concValue: '120', unit: 'pg/ml' },
            ],
        }, 70);
        expect(pre.labResults).toHaveLength(1);
        expect(pre.labResults![0].concValue).toBe(120);
        expect(pre.stats.labsRejected.map(r => r.index)).toEqual([0, 1, 2]);
    });

    it('boolean/empty per-dose weight falls back to the fallback weight and counts as migrated', () => {
        const pre = precheckImportedBackup({
            events: [
                { timeH: 1, doseMG: 1, route: 'gel', ester: 'E2', weightKG: true, extras: {} },
                { timeH: 2, doseMG: 1, route: 'gel', ester: 'E2', weightKG: false, extras: {} },
                { timeH: 3, doseMG: 1, route: 'gel', ester: 'E2', weightKG: '', extras: {} },
            ],
        }, 65);
        expect(pre.events!.every(e => e.weightKG === 65)).toBe(true);
        expect(pre.migratedCount).toBe(3);
    });

    it('reassigns duplicate lab ids to fresh uuids (data kept, uniqueness restored)', () => {
        const pre = precheckImportedBackup({
            labResults: [
                { id: 'dup', timeH: 1, concValue: 100, unit: 'pmol/l' },
                { id: 'dup', timeH: 2, concValue: 200, unit: 'pmol/l' },
            ],
        }, 70);
        expect(pre.labResults).toHaveLength(2);
        expect(pre.labResults![0].id).toBe('dup');
        expect(pre.labResults![1].id).not.toBe('dup');
        expect(new Set(pre.labResults!.map(l => l.id)).size).toBe(2);
        expect(pre.stats.labDuplicateIdCount).toBe(1);
        expect(pre.warnings.some(w => w.includes('labResults: 1 duplicate id(s) reassigned'))).toBe(true);
    });
});

describe('buildRepairedBackup', () => {
    it('keeps sections with at least one accepted row and omits all-rejected ones', () => {
        const pre = precheckImportedBackup({
            events: [ev],
            labResults: [{ timeH: null, concValue: 1, unit: 'pmol/l' }],
        }, 70);
        const repaired = buildRepairedBackup(pre);
        expect(repaired.meta).toBeDefined();
        expect(Array.isArray(repaired.events)).toBe(true);
        expect(repaired.events).toHaveLength(1);
        expect('labResults' in repaired).toBe(false);
    });

    it('returns only meta when no section has an accepted row', () => {
        const pre = precheckImportedBackup({
            events: [{ timeH: null, doseMG: 1, route: 'gel', ester: 'E2', extras: {} }],
            labResults: [],
        }, 70);
        const repaired = buildRepairedBackup(pre);
        expect(Object.keys(repaired).sort()).toEqual(['meta']);
    });
});
