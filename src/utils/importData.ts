/**
 * Pure parsing/merge logic for the Settings "import JSON" flow, extracted from
 * the React component so it can be unit-tested in the node environment.
 *
 * Key rule: a section that is ABSENT from the file is returned as `null`, meaning
 * "keep the existing data". A section present but EMPTY (`events: []`,
 * `labResults: []`, `gelProducts: []`) is returned as `[]`, meaning "clear it".
 * This is what lets a gel-only / events-only backup avoid wiping unrelated
 * sections — and lets an explicit empty section clear it deliberately.
 *
 * The precheck (`precheckImportedBackup`) validates the whole file BEFORE
 * anything is written: it reports per-row rejections with reasons, reassigned
 * duplicate ids, unknown lab units (never guessed), missing gel product
 * references, and — critically — flags any non-empty section whose rows were
 * ALL rejected as a fatal error so the caller aborts and keeps original data.
 */
import { v4 as uuidv4 } from 'uuid';
import { Ester, Route, type DoseEvent, type LabResult } from '../../types';
import { GEL_PRODUCTS, sanitizeGelProducts, type GelProductSpec } from '../../pk';

export type JsonRecord = Record<string, unknown>;

export const isRecord = (value: unknown): value is JsonRecord =>
    typeof value === 'object' && value !== null;

export const toNumber = (value: unknown): number | null => {
    const next = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(next) ? next : null;
};

/**
 * STRICT time parser for event/lab `timeH`. null / undefined / boolean / ''
 * must never silently become epoch time 0 (a corrupt `timeH: null` would
 * otherwise import as 1970 and poison the whole timeline). Numeric strings
 * are accepted for legacy compatibility.
 */
export const toFiniteTimeH = (value: unknown): number | null => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string' && value.trim() !== '') {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }
    return null; // null/undefined/boolean/'' must never become time 0
};

export const isRoute = (value: unknown): value is Route =>
    typeof value === 'string' && (Object.values(Route) as string[]).includes(value);

export const isEster = (value: unknown): value is Ester =>
    typeof value === 'string' && (Object.values(Ester) as string[]).includes(value);

export interface RejectedRow { index: number; reason: string; }

export interface SanitizedEvents {
    events: DoseEvent[];
    migratedCount: number;
    rejected: RejectedRow[];
    /** Ids that appeared more than once: later duplicates got a fresh uuid. */
    duplicateIdCount: number;
}

export const sanitizeImportedEvents = (raw: unknown, fallbackWeight: number): SanitizedEvents => {
    if (!Array.isArray(raw)) throw new Error('Invalid format');
    let migratedCount = 0;
    let duplicateIdCount = 0;
    const rejected: RejectedRow[] = [];
    const seenIds = new Set<string>();
    const events: DoseEvent[] = [];
    raw.forEach((entry, index) => {
        if (!isRecord(entry)) { rejected.push({ index, reason: 'not an object' }); return; }
        // Validate that route/ester are real enum members (replacing a blind
        // `as` cast) so a corrupt backup can't smuggle in an unknown compound.
        // We deliberately do NOT enforce a route+ester whitelist here: import
        // validity should track "is this well-formed data", not the current
        // dose-entry dropdown — otherwise tightening a UI list later would
        // silently reject older, legitimately-stored backups.
        if (!isRoute(entry.route)) { rejected.push({ index, reason: 'unknown route' }); return; }
        if (!isEster(entry.ester)) { rejected.push({ index, reason: 'unknown ester' }); return; }
        const timeNum = toFiniteTimeH(entry.timeH);
        if (timeNum === null) { rejected.push({ index, reason: 'invalid time' }); return; }
        const doseNum = toNumber(entry.doseMG);
        // Dose must be present and finite; negative is meaningless, and 0 is
        // only well-formed for patchRemove (removing a patch administers 0 mg).
        if (doseNum === null || doseNum < 0 || (doseNum === 0 && entry.route !== Route.patchRemove)) {
            rejected.push({ index, reason: 'invalid dose' });
            return;
        }
        const extras = isRecord(entry.extras) ? entry.extras : {};
        const weightNum = toNumber((entry as { weightKG?: unknown }).weightKG);
        let weightKG: number;
        if (weightNum !== null && weightNum > 0) {
            weightKG = weightNum;
        } else {
            weightKG = fallbackWeight;
            migratedCount += 1;
        }
        let id = typeof entry.id === 'string' ? entry.id : uuidv4();
        // Duplicate ids would make a later edit/delete by id hit multiple
        // rows. Reassign a fresh uuid to later duplicates (keep the data,
        // restore uniqueness) and surface the count instead of rejecting.
        if (seenIds.has(id)) {
            id = uuidv4();
            duplicateIdCount += 1;
        }
        seenIds.add(id);
        events.push({
            id,
            route: entry.route,
            timeH: timeNum,
            doseMG: doseNum,
            ester: entry.ester,
            weightKG,
            extras: extras as DoseEvent['extras'],
        });
    });
    return { events, migratedCount, rejected, duplicateIdCount };
};

export interface SanitizedLabResults {
    labs: LabResult[];
    rejected: RejectedRow[];
    /** Units that were neither 'pg/ml' nor 'pmol/l' — rejected, never guessed. */
    unknownUnitCount: number;
}

export const sanitizeImportedLabResults = (raw: unknown): SanitizedLabResults => {
    if (!Array.isArray(raw)) return { labs: [], rejected: [], unknownUnitCount: 0 };
    const rejected: RejectedRow[] = [];
    let unknownUnitCount = 0;
    const labs: LabResult[] = [];
    raw.forEach((entry, index) => {
        if (!isRecord(entry)) { rejected.push({ index, reason: 'not an object' }); return; }
        const timeNum = toFiniteTimeH(entry.timeH);
        if (timeNum === null) { rejected.push({ index, reason: 'invalid time' }); return; }
        const valueNum = toNumber(entry.concValue);
        if (valueNum === null) { rejected.push({ index, reason: 'invalid value' }); return; }
        // Accept ONLY the two real units. Silently coercing an unknown unit
        // to 'pmol/l' would fabricate a wrong concentration scale.
        if (entry.unit !== 'pg/ml' && entry.unit !== 'pmol/l') {
            rejected.push({ index, reason: 'unknown unit' });
            unknownUnitCount += 1;
            return;
        }
        labs.push({ id: typeof entry.id === 'string' ? entry.id : uuidv4(), timeH: timeNum, concValue: valueNum, unit: entry.unit });
    });
    return { labs, rejected, unknownUnitCount };
};

export interface ParsedImport {
    events: DoseEvent[] | null;            // null = section absent → keep existing
    labResults: LabResult[] | null;        // null = section absent → keep existing
    gelProducts: GelProductSpec[] | null;
    migratedCount: number;
}

/** Pick the fallback weight (for legacy rows missing per-dose weight). */
export const importFallbackWeight = (parsed: unknown, dflt: number): number => {
    if (isRecord(parsed)) {
        const w = toNumber(parsed.weight);
        if (w !== null && w > 0) return w;
    }
    return dflt;
};

export interface ImportPrecheck extends ParsedImport {
    stats: {
        eventsTotal: number;
        eventsAccepted: number;
        eventsRejected: RejectedRow[];
        labsTotal: number;
        labsAccepted: number;
        labsRejected: RejectedRow[];
        gelsTotal: number;
        gelsAccepted: number;
        gelsRejected: number;
        duplicateIdCount: number;
        unknownUnitCount: number;
        /** gelProductIds referenced by accepted gel events but found neither in the imported gel list nor among built-in presets. */
        missingGelRefs: number[];
    };
    /** Non-empty when a section carried rows but none were importable — caller must abort. */
    fatalErrors: string[];
    /** Non-fatal issues the user must acknowledge before applying. */
    warnings: string[];
}

/**
 * Full pre-import validation. Writes NOTHING; returns everything the caller
 * needs to decide: totals, per-row rejections with reasons, duplicate ids
 * reassigned to fresh uuids, unknown units, missing gel references, and
 * fatalErrors when a non-empty section lost ALL its rows (ambiguous corruption
 * — must abort and keep original data rather than wipe a section "successfully").
 */
export const precheckImportedBackup = (parsed: unknown, fallbackWeight: number): ImportPrecheck => {
    let events: DoseEvent[] | null = null;
    let labResults: LabResult[] | null = null;
    let gelProducts: GelProductSpec[] | null = null;
    let migratedCount = 0;
    let eventsRejected: RejectedRow[] = [];
    let labsRejected: RejectedRow[] = [];
    let duplicateIdCount = 0;
    let unknownUnitCount = 0;
    let gelsTotal = 0;
    let gelsRejected = 0;

    if (Array.isArray(parsed)) {
        // Legacy top-level-array format IS an events list: the section is
        // present by definition, so events is non-null even when empty.
        const r = sanitizeImportedEvents(parsed, fallbackWeight);
        events = r.events;
        migratedCount = r.migratedCount;
        eventsRejected = r.rejected;
        duplicateIdCount = r.duplicateIdCount;
    } else if (isRecord(parsed)) {
        if (Array.isArray(parsed.events)) {
            const r = sanitizeImportedEvents(parsed.events, fallbackWeight);
            events = r.events;
            migratedCount = r.migratedCount;
            eventsRejected = r.rejected;
            duplicateIdCount = r.duplicateIdCount;
        }
        if (Array.isArray(parsed.labResults)) {
            const r = sanitizeImportedLabResults(parsed.labResults);
            labResults = r.labs;
            labsRejected = r.rejected;
            unknownUnitCount = r.unknownUnitCount;
        }
        if (Array.isArray(parsed.gelProducts)) {
            gelsTotal = parsed.gelProducts.length;
            gelProducts = sanitizeGelProducts(parsed.gelProducts);
            gelsRejected = gelsTotal - gelProducts.length;
        }
    }

    // Gel reference integrity: accepted gel events pointing at a product id
    // that is neither imported nor a built-in preset would silently simulate
    // with fallback kinetics. Surface the ids; do NOT reject the events.
    const knownGelIds = new Set<number>(GEL_PRODUCTS.map(p => p.id));
    if (gelProducts) for (const g of gelProducts) knownGelIds.add(g.id);
    const missingGelRefs: number[] = [];
    if (events) {
        for (const ev of events) {
            const ref = ev.extras?.gelProductId;
            if (typeof ref === 'number' && Number.isFinite(ref) && !knownGelIds.has(ref) && !missingGelRefs.includes(ref)) {
                missingGelRefs.push(ref);
            }
        }
    }

    const fatalErrors: string[] = [];
    if (events !== null && eventsRejected.length > 0 && events.length === 0) {
        fatalErrors.push(`events: ${eventsRejected.length} rows, all rejected`);
    }
    if (labResults !== null && labsRejected.length > 0 && labResults.length === 0) {
        fatalErrors.push(`labResults: ${labsRejected.length} rows, all rejected`);
    }
    if (gelProducts !== null && gelsRejected > 0 && gelsRejected === gelsTotal) {
        fatalErrors.push(`gelProducts: ${gelsTotal} rows, all rejected`);
    }

    const warnings: string[] = [];
    if (eventsRejected.length > 0) warnings.push(`events: ${eventsRejected.length} row(s) rejected`);
    if (labsRejected.length > 0) warnings.push(`labResults: ${labsRejected.length} row(s) rejected`);
    if (unknownUnitCount > 0) warnings.push(`labResults: ${unknownUnitCount} unknown unit(s) rejected`);
    if (duplicateIdCount > 0) warnings.push(`events: ${duplicateIdCount} duplicate id(s) reassigned`);
    if (migratedCount > 0) warnings.push(`events: ${migratedCount} row(s) migrated to fallback weight`);
    if (missingGelRefs.length > 0) warnings.push(`events reference missing gelProductId: ${missingGelRefs.join(', ')}`);

    return {
        events,
        labResults,
        gelProducts,
        migratedCount,
        stats: {
            eventsTotal: events !== null ? events.length + eventsRejected.length : 0,
            eventsAccepted: events?.length ?? 0,
            eventsRejected,
            labsTotal: labResults !== null ? labResults.length + labsRejected.length : 0,
            labsAccepted: labResults?.length ?? 0,
            labsRejected,
            gelsTotal,
            gelsAccepted: gelProducts?.length ?? 0,
            gelsRejected,
            duplicateIdCount,
            unknownUnitCount,
            missingGelRefs,
        },
        fatalErrors,
        warnings,
    };
};

export const parseImportedBackup = (parsed: unknown, fallbackWeight: number): ParsedImport => {
    const pre = precheckImportedBackup(parsed, fallbackWeight);
    return {
        events: pre.events,
        labResults: pre.labResults,
        gelProducts: pre.gelProducts,
        migratedCount: pre.migratedCount,
    };
};

/**
 * Valid when the file carried ANY recognized section — including an empty
 * `events: []` / `labResults: []` / `gelProducts: []` whose intent is to
 * clear that section. Absent sections (null) carry no intent and don't count.
 */
export const importHasContent = (p: ParsedImport): boolean =>
    p.events !== null || p.labResults !== null || p.gelProducts !== null;
