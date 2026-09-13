/**
 * Shared helpers for the dose-entry forms (DoseFormModal + BatchDoseModal).
 *
 * Centralizing the route ordering, per-route compound lists, quick-dose presets
 * and the per-drug "last dose" memory keeps the single-add and batch-add modals
 * from drifting apart (they previously diverged on route order and defaults).
 */
import {
    Route, Ester, ExtraKey, GEL_PRODUCTS, GEL_DEFAULT_PRODUCT_ID, GEL_CUSTOM_ID_BASE,
    sanitizeGelProducts,
    type DoseEvent, type GelProductSpec,
} from '../../logic';

/**
 * Display order for the route selector. Decoupled from the `Route` enum
 * declaration order (which is serialized to storage and must stay stable) so we
 * can surface the most-used routes — sublingual then oral — at the top.
 */
export const ROUTE_DISPLAY_ORDER: Route[] = [
    Route.sublingual,
    Route.oral,
    Route.injection,
    Route.patchApply,
    Route.patchRemove,
    Route.gel,
];

/**
 * Compounds available per route. Sublingual lists EV first so estradiol valerate
 * is the default sublingual compound.
 */
export const getAvailableEsters = (route: Route): Ester[] => {
    switch (route) {
        // EU (estradiol undecylate) sits next to EV (valerate) so the two
        // similarly-named depot esters are easy to tell apart at selection time.
        case Route.injection:
            return [Ester.EB, Ester.EV, Ester.EU, Ester.EC, Ester.EN];
        case Route.oral:
            return [Ester.E2, Ester.EV, Ester.CPA, Ester.BICA];
        case Route.sublingual:
            return [Ester.EV, Ester.E2];
        default:
            return [Ester.E2];
    }
};

/**
 * Quick-select dose tiers per compound, expressed in mg of the compound itself
 * (the tablet/dose taken), NOT the estradiol-equivalent. Only surfaced for the
 * oral / sublingual routes.
 */
export const DOSE_QUICK_PRESETS: Partial<Record<Ester, number[]>> = {
    [Ester.E2]: [1, 2, 3, 4],
    [Ester.EV]: [1, 2, 3, 4],
    [Ester.CPA]: [6.25, 12.5, 25],
    [Ester.BICA]: [20, 25, 50],
};

/** True when `mg` matches one of the compound's quick-select presets. */
export const isPresetDose = (ester: Ester, mg: number): boolean => {
    const presets = DOSE_QUICK_PRESETS[ester];
    return !!presets && Number.isFinite(mg) && presets.some(p => Math.abs(p - mg) < 1e-6);
};

/** Whether the quick-dose panel applies to this route+compound combination. */
export const hasQuickDosePanel = (route: Route, ester: Ester): boolean =>
    (route === Route.sublingual || route === Route.oral) && !!DOSE_QUICK_PRESETS[ester];

/**
 * Per-drug remembered dose, keyed by `${route}:${ester}` so one compound's last
 * entered dose never leaks onto another.
 */
export interface DrugMemo {
    rawDose: string;
    e2Dose: string;
    patchMode?: 'dose' | 'rate';
    patchRate?: string;
    slTier?: number;
    useCustomTheta?: boolean;
    customTheta?: string;
    customDose?: boolean; // quick panel: was the manual-input mode active
}

// These two keys are intentionally device-local (not cloud-synced), matching the
// existing `hrt-dose-templates` behavior: they only prefill the form for
// convenience. The medication records themselves (`hrt-events`) are the synced
// source of truth, so a per-device "last dose" preference is acceptable drift.
const DOSE_BY_DRUG_KEY = 'hrt-dose-by-drug';
const DOSE_LAST_DRUG_KEY = 'hrt-dose-last-drug';

export const drugKeyOf = (route: Route, ester: Ester) => `${route}:${ester}`;

// --- Validation helpers so corrupt / stale localStorage can never poison state ---
const isRecord = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);

export const isRoute = (v: unknown): v is Route =>
    typeof v === 'string' && (Object.values(Route) as string[]).includes(v);

export const isEster = (v: unknown): v is Ester =>
    typeof v === 'string' && (Object.values(Ester) as string[]).includes(v);

const isPatchMode = (v: unknown): v is 'dose' | 'rate' => v === 'dose' || v === 'rate';

const asStr = (v: unknown): string => (typeof v === 'string' ? v : '');
const asOptStr = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const asOptBool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);
const asOptNum = (v: unknown): number | undefined =>
    (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

// Normalize one stored entry: every field is coerced to its expected type so a
// hand-edited / older-version blob can't push an illegal value (e.g. a bogus
// patchMode) into React state. Non-object entries are dropped.
const normalizeMemo = (v: unknown): DrugMemo | null => {
    if (!isRecord(v)) return null;
    return {
        rawDose: asStr(v.rawDose),
        e2Dose: asStr(v.e2Dose),
        patchMode: isPatchMode(v.patchMode) ? v.patchMode : undefined,
        patchRate: asOptStr(v.patchRate),
        slTier: asOptNum(v.slTier),
        useCustomTheta: asOptBool(v.useCustomTheta),
        customTheta: asOptStr(v.customTheta),
        customDose: asOptBool(v.customDose),
    };
};

export const readDoseByDrug = (): Record<string, DrugMemo> => {
    try {
        const saved = localStorage.getItem(DOSE_BY_DRUG_KEY);
        if (!saved) return {};
        const parsed = JSON.parse(saved);
        if (!isRecord(parsed)) return {};
        const out: Record<string, DrugMemo> = {};
        for (const [key, val] of Object.entries(parsed)) {
            const memo = normalizeMemo(val);
            if (memo) out[key] = memo;
        }
        return out;
    } catch {
        return {};
    }
};

export const writeDoseMemo = (route: Route, ester: Ester, memo: DrugMemo) => {
    try {
        const byDrug = readDoseByDrug();
        byDrug[drugKeyOf(route, ester)] = memo;
        localStorage.setItem(DOSE_BY_DRUG_KEY, JSON.stringify(byDrug));
        localStorage.setItem(DOSE_LAST_DRUG_KEY, JSON.stringify({ route, ester }));
    } catch {
        /* ignore */
    }
};

export const readLastDrug = (): { route: Route; ester: Ester } | null => {
    try {
        const saved = localStorage.getItem(DOSE_LAST_DRUG_KEY);
        if (!saved) return null;
        const last = JSON.parse(saved);
        // Only accept a real enum route + a compound that is actually valid for it.
        if (isRecord(last) && isRoute(last.route) && isEster(last.ester) &&
            getAvailableEsters(last.route).includes(last.ester)) {
            return { route: last.route, ester: last.ester };
        }
        return null;
    } catch {
        return null;
    }
};

// --- Custom transdermal-gel products ----------------------------------------
//
// Preset gels live in `GEL_PRODUCTS` (code). User-created products are stored
// here and CLOUD-SYNCED via AppDataContext (SYNC_FIELDS 'gelProducts'), so a
// custom gel follows the user across devices. Validation reuses the single
// canonical `sanitizeGelProduct(s)` from pk.ts so every entry point agrees.
export const GEL_PRODUCTS_KEY = 'hrt-gel-products';

const asNum = (v: unknown, fallback: number): number =>
    (typeof v === 'number' && Number.isFinite(v)) ? v : fallback;

/** Re-exported so callers (SettingsPage import) keep a single import surface. */
export { sanitizeGelProducts };

/** Read the user's custom gel products (validated). Presets are NOT included. */
export const readCustomGelProducts = (): GelProductSpec[] => {
    try {
        const saved = localStorage.getItem(GEL_PRODUCTS_KEY);
        if (!saved) return [];
        return sanitizeGelProducts(JSON.parse(saved));
    } catch {
        return [];
    }
};

/** Persist the custom gel products list (caller passes the full custom array). */
export const writeCustomGelProducts = (products: GelProductSpec[]) => {
    try {
        localStorage.setItem(GEL_PRODUCTS_KEY, JSON.stringify(sanitizeGelProducts(products)));
    } catch {
        /* ignore */
    }
};

/** Presets followed by the user's custom products, for the product selector. */
export const getAllGelProducts = (custom: GelProductSpec[] = readCustomGelProducts()): GelProductSpec[] =>
    [...GEL_PRODUCTS, ...custom];

/**
 * Persisted high-water mark for custom gel-product id allocation (F06).
 * Ids are NEVER reused after deletion: a reused id would silently re-point
 * historical gel records (which store only the product id) at whatever new
 * product happens to inherit it. The first allocation on a device also jumps
 * to a random offset so two devices that later merge via cloud sync are
 * extremely unlikely to allocate colliding ids (multi-device safety).
 */
const GEL_ID_SEQ_KEY = 'hrt-gel-id-seq';
// Random start lives in [GEL_CUSTOM_ID_BASE, ID_RANDOM_CEIL): a ~2-billion-wide
// range, so the birthday bound for two devices colliding is negligible.
const ID_RANDOM_CEIL = 2_000_000_000;

// Session-memory fallback of the high-water mark: if localStorage is unusable
// (private mode, quota, Tauri quirks) we still must not hand out the same id
// twice within this session — non-durable, but closed within the session.
let memoryHighWater: number | null = null;

const randomIdStart = (): number =>
    GEL_CUSTOM_ID_BASE + Math.floor(Math.random() * (ID_RANDOM_CEIL - GEL_CUSTOM_ID_BASE));

const isUsableSeq = (v: number): boolean =>
    Number.isSafeInteger(v) && v >= GEL_CUSTOM_ID_BASE && v < Number.MAX_SAFE_INTEGER - 1;

/** Next custom id: monotonic, never reused, collision-safe across devices. */
export const nextGelProductId = (custom: GelProductSpec[]): number => {
    const floor = GEL_CUSTOM_ID_BASE - 1;
    let persisted: number | null = null;
    try {
        const raw = localStorage.getItem(GEL_ID_SEQ_KEY);
        const parsed = raw ? parseInt(raw, 10) : NaN;
        if (isUsableSeq(parsed)) persisted = parsed;
    } catch {
        /* storage unreadable — memory fallback below */
    }
    // Final-review fix (a): combine the persisted high-water with the session
    // memory. When reads work but WRITES have been failing, the memory mark is
    // newer — ignoring it handed out the same id twice.
    const seq = Math.max(persisted ?? floor, memoryHighWater ?? floor);
    if (persisted === null && memoryHighWater === null) {
        // No durable or session history at all: start from a random offset so
        // devices that later merge via cloud sync rarely collide.
        return allocate(randomIdStart(), custom);
    }
    return allocate(seq, custom);
};

const allocate = (seq: number, custom: GelProductSpec[]): number => {
    // Also stay above every live product: the seq may predate an import or a
    // cloud sync that brought in higher ids than this device ever allocated.
    // `seq` is the LAST allocated id, so the next id is at least seq + 1
    // (isUsableSeq keeps seq+1 a safe integer; a corrupt huge live id is
    // ignored rather than allowed to overflow into a duplicate).
    const liveMax = custom.reduce((max, p) => Math.max(max, p.id), GEL_CUSTOM_ID_BASE - 1);
    const liveDerived = Number.isSafeInteger(liveMax + 1) ? liveMax + 1 : GEL_CUSTOM_ID_BASE;
    let next = Math.max(seq + 1, liveDerived);
    if (liveDerived > seq + 1) {
        // Final-review fix (b): the live max came from products every synced
        // device can see — deriving max+1 would give every device the SAME id.
        // Jump by a random jitter to keep cross-device allocation practically
        // unique, then resume monotonically from there.
        next = liveDerived + Math.floor(Math.random() * 1_000_000);
    }
    if (!Number.isSafeInteger(next)) {
        next = randomIdStart();
    }
    memoryHighWater = Math.max(memoryHighWater ?? GEL_CUSTOM_ID_BASE - 1, next);
    try {
        localStorage.setItem(GEL_ID_SEQ_KEY, String(next));
    } catch {
        /* non-durable; the session-memory fallback still prevents reuse here */
    }
    return next;
};

export interface LastGelPrefill {
    productId: number;
    gelSite: number;
    areaCM2: number;
    doseMG: number;
    washAfterH: number;
    coverage: number;   // coverage-template index; -1 if the record predates the feature
    coApplied: number;  // co-applied product index; 0 = none
}

/**
 * Pull the most recent gel administration out of the saved events so the form
 * can pre-fill the same product / site / area / wash. The numeric gel params are
 * read straight from the event's `extras` JSON, matching the per-event storage.
 */
export const readLastGelEvent = (events: DoseEvent[]): LastGelPrefill | null => {
    let latest: DoseEvent | null = null;
    for (const e of events) {
        if (e.route === Route.gel && (!latest || e.timeH > latest.timeH)) latest = e;
    }
    if (!latest) return null;
    const ex = latest.extras ?? {};
    return {
        productId: asNum(ex[ExtraKey.gelProductId], GEL_DEFAULT_PRODUCT_ID),
        gelSite: asNum(ex[ExtraKey.gelSite], 0),
        areaCM2: asNum(ex[ExtraKey.areaCM2], 0),
        doseMG: latest.doseMG,
        washAfterH: asNum(ex[ExtraKey.gelWashAfterH], 0),
        coverage: ex[ExtraKey.gelCoverage] != null ? asNum(ex[ExtraKey.gelCoverage], -1) : -1,
        coApplied: asNum(ex[ExtraKey.gelCoApplied], 0),
    };
};
