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
import { GEL_CUSTOM_ID_BASE, GEL_PRODUCTS, sanitizeGelProducts, type GelProductSpec } from '../../pk';

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

/**
 * STRICT numeric parser: a finite number, or a string with non-empty trim that
 * parses finite. null/undefined/boolean/'' → null (booleans are NOT numbers:
 * `Number(true) === 1` would silently turn a corrupt flag into a dose/weight).
 */
export const toStrictNumber = (value: unknown): number | null => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string' && value.trim() !== '') {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }
    return null;
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
        // Dose is strict: null/''/boolean are rejected, never coerced (Number(true)
        // is 1). Negative is meaningless; 0 is only well-formed for patchRemove.
        // A MISSING dose on patchRemove means "removed a patch" → 0 mg.
        let doseNum: number;
        if (entry.route === Route.patchRemove && entry.doseMG === undefined) {
            doseNum = 0;
        } else {
            const strictDose = toStrictNumber(entry.doseMG);
            if (strictDose === null || strictDose < 0 || (strictDose === 0 && entry.route !== Route.patchRemove)) {
                rejected.push({ index, reason: 'invalid dose' });
                return;
            }
            doseNum = strictDose;
        }
        const extras = isRecord(entry.extras) ? entry.extras : {};
        // Invalid/missing weight (including booleans) falls back + counts as migrated.
        const weightNum = toStrictNumber((entry as { weightKG?: unknown }).weightKG);
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
    /** Lab ids that appeared more than once: later duplicates got a fresh uuid. */
    duplicateIdCount: number;
}

export const sanitizeImportedLabResults = (raw: unknown): SanitizedLabResults => {
    if (!Array.isArray(raw)) return { labs: [], rejected: [], unknownUnitCount: 0, duplicateIdCount: 0 };
    const rejected: RejectedRow[] = [];
    let unknownUnitCount = 0;
    let duplicateIdCount = 0;
    const seenIds = new Set<string>();
    const labs: LabResult[] = [];
    raw.forEach((entry, index) => {
        if (!isRecord(entry)) { rejected.push({ index, reason: 'not an object' }); return; }
        const timeNum = toFiniteTimeH(entry.timeH);
        if (timeNum === null) { rejected.push({ index, reason: 'invalid time' }); return; }
        // Strict value: null/''/boolean are rejected, never coerced.
        const valueNum = toStrictNumber(entry.concValue);
        if (valueNum === null) { rejected.push({ index, reason: 'invalid value' }); return; }
        // Accept ONLY the two real units. Silently coercing an unknown unit
        // to 'pmol/l' would fabricate a wrong concentration scale.
        if (entry.unit !== 'pg/ml' && entry.unit !== 'pmol/l') {
            rejected.push({ index, reason: 'unknown unit' });
            unknownUnitCount += 1;
            return;
        }
        // Duplicate lab ids would make an edit-by-id hit multiple rows; keep the
        // first occurrence and reassign later duplicates a fresh uuid (same
        // policy as events).
        let id = typeof entry.id === 'string' ? entry.id : uuidv4();
        if (seenIds.has(id)) {
            id = uuidv4();
            duplicateIdCount += 1;
        }
        seenIds.add(id);
        labs.push({ id, timeH: timeNum, concValue: valueNum, unit: entry.unit });
    });
    return { labs, rejected, unknownUnitCount, duplicateIdCount };
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
        const w = toStrictNumber(parsed.weight);
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
        /** Per-row gel rejections with reasons (mirror of events/labs). */
        gelsRejected: RejectedRow[];
        /** Numeric count of rejected gel rows (=== gelsRejected.length). */
        gelsRejectedCount: number;
        /** EVENT duplicate ids reassigned to fresh uuids. */
        duplicateIdCount: number;
        /** LAB duplicate ids reassigned to fresh uuids. */
        labDuplicateIdCount: number;
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
 * Best-effort reason for a gel row that failed the real per-row sanitizer.
 * Mirrors the hard requirements in pk.ts `sanitizeGelProduct`: numeric id
 * ≥ GEL_CUSTOM_ID_BASE, then the three non-defaultable rate constants; name
 * is only a last-resort hint (the sanitizer itself defaults display fields).
 */
const gelRejectReason = (row: unknown): string => {
    if (!isRecord(row)) return 'not an object';
    if (typeof row.id !== 'number' || !Number.isFinite(row.id)) return 'id not a number';
    if (row.id < GEL_CUSTOM_ID_BASE) return `id below ${GEL_CUSTOM_ID_BASE}`;
    if (typeof row.kPenBase !== 'number' || !Number.isFinite(row.kPenBase)) return 'missing kPenBase';
    if (typeof row.kLoss !== 'number' || !Number.isFinite(row.kLoss)) return 'missing kLoss';
    if (typeof row.kRel !== 'number' || !Number.isFinite(row.kRel)) return 'missing kRel';
    if (typeof row.name !== 'string' || row.name.trim() === '') return 'missing name';
    return 'invalid gel product';
};

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
    let gelsRejected: RejectedRow[] = [];
    let duplicateIdCount = 0;
    let labDuplicateIdCount = 0;
    let unknownUnitCount = 0;
    let gelsTotal = 0;
    // Sections whose key is present but whose value is not an array (and not
    // null — null counts as deliberately absent). Treated as absent for data
    // purposes, but surfaced so a corrupt export doesn't pass silently.
    const malformed: string[] = [];
    const typeName = (v: unknown): string => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);
    const noteMalformed = (key: 'events' | 'labResults' | 'gelProducts', value: unknown) => {
        // undefined = key absent (JSON never produces it); null = deliberately absent.
        if (value !== undefined && value !== null && !Array.isArray(value)) {
            malformed.push(`${key}: present but not an array (got ${typeName(value)}); section ignored`);
        }
    };

    if (Array.isArray(parsed)) {
        // Legacy top-level-array format IS an events list: the section is
        // present by definition, so events is non-null even when empty.
        const r = sanitizeImportedEvents(parsed, fallbackWeight);
        events = r.events;
        migratedCount = r.migratedCount;
        eventsRejected = r.rejected;
        duplicateIdCount = r.duplicateIdCount;
    } else if (isRecord(parsed)) {
        noteMalformed('events', parsed.events);
        noteMalformed('labResults', parsed.labResults);
        noteMalformed('gelProducts', parsed.gelProducts);
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
            labDuplicateIdCount = r.duplicateIdCount;
        }
        if (Array.isArray(parsed.gelProducts)) {
            gelsTotal = parsed.gelProducts.length;
            // Accepted list stays the FULL-LIST sanitize result (identical to
            // before, including its dup-id drop); rejections are derived by
            // running the real sanitizer on each row individually so every
            // dropped row gets a concrete reason.
            gelProducts = sanitizeGelProducts(parsed.gelProducts);
            const seenGelIds = new Set<number>();
            parsed.gelProducts.forEach((row, index) => {
                if (sanitizeGelProducts([row]).length !== 1) {
                    gelsRejected.push({ index, reason: gelRejectReason(row) });
                    return;
                }
                // Individually valid but dropped from the full list → duplicate id.
                // Product ids are registry keys referenced by events, so unlike
                // events/labs the duplicate row is dropped, NOT reassigned.
                const id = Math.round((row as { id: unknown }).id as number);
                if (seenGelIds.has(id)) {
                    gelsRejected.push({ index, reason: 'duplicate id' });
                    return;
                }
                seenGelIds.add(id);
            });
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

    const gelsRejectedCount = gelsRejected.length;
    const fatalErrors: string[] = [];
    if (events !== null && eventsRejected.length > 0 && events.length === 0) {
        fatalErrors.push(`events: ${eventsRejected.length} rows, all rejected`);
    }
    if (labResults !== null && labsRejected.length > 0 && labResults.length === 0) {
        fatalErrors.push(`labResults: ${labsRejected.length} rows, all rejected`);
    }
    if (gelProducts !== null && gelsRejectedCount > 0 && gelsRejectedCount === gelsTotal) {
        fatalErrors.push(`gelProducts: ${gelsTotal} rows, all rejected`);
    }

    const warnings: string[] = [...malformed];
    if (eventsRejected.length > 0) warnings.push(`events: ${eventsRejected.length} row(s) rejected`);
    if (labsRejected.length > 0) warnings.push(`labResults: ${labsRejected.length} row(s) rejected`);
    if (unknownUnitCount > 0) warnings.push(`labResults: ${unknownUnitCount} unknown unit(s) rejected`);
    if (gelsRejectedCount > 0) warnings.push(`gelProducts: ${gelsRejectedCount} row(s) rejected`);
    if (duplicateIdCount > 0) warnings.push(`events: ${duplicateIdCount} duplicate id(s) reassigned`);
    if (labDuplicateIdCount > 0) warnings.push(`labResults: ${labDuplicateIdCount} duplicate id(s) reassigned`);
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
            gelsRejectedCount,
            duplicateIdCount,
            labDuplicateIdCount,
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

/**
 * Build a salvage ("repaired") copy of a rejected import: ONLY sections that
 * kept at least one accepted row are included. All-rejected and absent
 * sections are omitted entirely — never written as explicit empty arrays — so
 * re-importing the result keeps existing data instead of wiping a section.
 */
export const buildRepairedBackup = (precheck: ImportPrecheck): JsonRecord => {
    const repaired: JsonRecord = {
        meta: { version: 2, exportedAt: new Date().toISOString(), repaired: true },
    };
    if (precheck.events !== null && precheck.stats.eventsAccepted > 0) {
        repaired.events = precheck.events;
    }
    if (precheck.labResults !== null && precheck.stats.labsAccepted > 0) {
        repaired.labResults = precheck.labResults;
    }
    if (precheck.gelProducts !== null && precheck.stats.gelsAccepted > 0) {
        repaired.gelProducts = precheck.gelProducts;
    }
    return repaired;
};
