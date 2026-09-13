import { describe, it, expect, vi } from 'vitest';
import { ExtraKey } from '../../types';
import type { GelProductSpec } from '../../pk';
import { GEL_COVERAGE_TEMPLATES } from '../../pk';
import {
    productToForm, validateGelForm, gelFormsEqual, buildGelExtras, resolveGelAreaToStore, parseField, LAMBDA_SURFACE,
} from './gelForm';

const product = (over: Partial<GelProductSpec> = {}): GelProductSpec => ({
    id: 1000, nameKey: '', name: 'Test', concentrationMGmL: 1, defaultAreaCM2: 400,
    refDoseMG: 0.8, kPenBase: 0.14, kLoss: 1.26, kRel: 0.022, ...over,
});

describe('custom-gel form math', () => {
    it('productToForm is idempotent → "open + save unchanged" is a no-op', () => {
        const f = productToForm(product());
        expect(gelFormsEqual(f, productToForm(product()))).toBe(true);
    });

    it('changing a field is detected (the dual of the no-op) and recomputes kinetics', () => {
        const orig = product();
        const loaded = productToForm(orig);
        const edited = { ...loaded, bio: '20' };            // user changes bioavailability
        expect(gelFormsEqual(edited, productToForm(orig))).toBe(false); // → not a no-op
        const r = validateGelForm(edited, orig.id);
        expect('product' in r && r.product.kPenBase).toBeCloseTo(0.20 * LAMBDA_SURFACE, 6);
    });

    it('productToForm stays finite for a corrupt spec (kPen+kLoss=0, kRel=0)', () => {
        const f = productToForm(product({ kPenBase: 0, kLoss: 0, kRel: 0 }));
        expect(f.bio).not.toContain('NaN');
        expect(f.halflife).not.toContain('NaN');
        expect(Number.isFinite(parseFloat(f.bio))).toBe(true);
        expect(Number.isFinite(parseFloat(f.halflife))).toBe(true);
    });

    it('parseField accepts only plain decimals', () => {
        expect(parseField('  12 ', 1, 100)).toBe(12);   // trimmed
        expect(parseField('1.5', 0.01, 100)).toBe(1.5);
        expect(parseField('1e3', 1, 5000)).toBeNull();  // scientific rejected
        expect(parseField('0x10', 1, 5000)).toBeNull(); // hex rejected
        expect(parseField('Infinity', 1, 5000)).toBeNull();
        expect(parseField('1abc', 1, 100)).toBeNull();
        expect(parseField('', 1, 100)).toBeNull();
    });

    it('validateGelForm derives the expected kinetics from a normal form', () => {
        const r = validateGelForm({ name: 'X', conc: '1', area: '400', bio: '10', halflife: '31' }, 1000);
        expect('product' in r).toBe(true);
        if ('product' in r) {
            expect(r.product.kPenBase).toBeCloseTo(0.10 * LAMBDA_SURFACE, 6);
            expect(r.product.kLoss).toBeCloseTo(LAMBDA_SURFACE - 0.10 * LAMBDA_SURFACE, 6);
            expect(r.product.kRel).toBeCloseTo(Math.log(2) / 31, 6);
        }
    });

    it('validateGelForm rejects empty name / trailing chars / out-of-range', () => {
        expect(validateGelForm({ name: '', conc: '1', area: '400', bio: '10', halflife: '31' }, 1000)).toEqual({ error: 'gel.custom.name_required' });
        expect(validateGelForm({ name: 'X', conc: '1abc', area: '400', bio: '10', halflife: '31' }, 1000)).toEqual({ error: 'gel.custom.invalid' });
        expect(validateGelForm({ name: 'X', conc: '1', area: '400', bio: '-5', halflife: '31' }, 1000)).toEqual({ error: 'gel.custom.invalid' });
        expect(validateGelForm({ name: 'X', conc: '1', area: '400', bio: '10', halflife: '9999' }, 1000)).toEqual({ error: 'gel.custom.invalid' });
    });

    it('productToForm clamps an extreme imported product into the UI-editable range', () => {
        const f = productToForm(product({ kPenBase: 5, kLoss: 0, kRel: 0.0001 }));
        expect(parseFloat(f.bio)).toBeLessThanOrEqual(95);   // F=100% → 95
        expect(parseFloat(f.halflife)).toBeLessThanOrEqual(240); // t½ huge → 240
        // …and the clamped form still validates (no save dead-end).
        expect('product' in validateGelForm({ ...f, name: 'x' }, 1000)).toBe(true);
    });
});

describe('buildGelExtras', () => {
    it('stores the selected product id VERBATIM (even a missing/deleted id)', () => {
        const ex = buildGelExtras({ productId: 1000, gelSite: 0, areaCM2: 400 });
        expect(ex[ExtraKey.gelProductId]).toBe(1000);
        expect(ex[ExtraKey.areaCM2]).toBe(400);
        expect(ex[ExtraKey.gelWashAfterH]).toBeUndefined();
    });

    it('clamps the site index (99→3, -1→0, NaN→0)', () => {
        expect(buildGelExtras({ productId: 1000, gelSite: 99, areaCM2: 400 })[ExtraKey.gelSite]).toBe(3);
        expect(buildGelExtras({ productId: 1000, gelSite: -1, areaCM2: 400 })[ExtraKey.gelSite]).toBe(0);
        expect(buildGelExtras({ productId: 1000, gelSite: NaN, areaCM2: 400 })[ExtraKey.gelSite]).toBe(0);
        expect(buildGelExtras({ productId: 1000, gelSite: 2, areaCM2: 400 })[ExtraKey.gelSite]).toBe(2);
    });

    it('includes wash only when positive and finite', () => {
        expect(buildGelExtras({ productId: 1000, gelSite: 0, areaCM2: 400, washAfterH: 1 })[ExtraKey.gelWashAfterH]).toBe(1);
        expect(buildGelExtras({ productId: 1000, gelSite: 0, areaCM2: 400, washAfterH: 0 })[ExtraKey.gelWashAfterH]).toBeUndefined();
        expect(buildGelExtras({ productId: 1000, gelSite: 0, areaCM2: 400, washAfterH: NaN })[ExtraKey.gelWashAfterH]).toBeUndefined();
    });

    it('persists area only when a positive value is supplied (omit = follow product default)', () => {
        expect(buildGelExtras({ productId: 1000, gelSite: 0, areaCM2: 350 })[ExtraKey.areaCM2]).toBe(350);
        expect(buildGelExtras({ productId: 1000, gelSite: 0, areaCM2: undefined })[ExtraKey.areaCM2]).toBeUndefined();
        expect(buildGelExtras({ productId: 1000, gelSite: 0, areaCM2: 0 })[ExtraKey.areaCM2]).toBeUndefined();
    });

    it('persists coverage when >= 0 (incl. 0) and co-applied only when > 0', () => {
        const ex = buildGelExtras({ productId: 1000, gelSite: 0, areaCM2: 400, coverage: 0, coApplied: 0 });
        expect(ex[ExtraKey.gelCoverage]).toBe(0);          // product-default coverage is recorded
        expect(ex[ExtraKey.gelCoApplied]).toBeUndefined(); // "none" stays absent
        const ex2 = buildGelExtras({ productId: 1000, gelSite: 0, areaCM2: 400, coverage: 5, coApplied: 2 });
        expect(ex2[ExtraKey.gelCoverage]).toBe(5);
        expect(ex2[ExtraKey.gelCoApplied]).toBe(2);
        // A legacy-style omission keeps both absent.
        const ex3 = buildGelExtras({ productId: 1000, gelSite: 0, areaCM2: 400 });
        expect(ex3[ExtraKey.gelCoverage]).toBeUndefined();
        expect(ex3[ExtraKey.gelCoApplied]).toBeUndefined();
    });
});

describe('resolveGelAreaToStore (anti-drift area persistence)', () => {
    const idxOf = (kind: string) => GEL_COVERAGE_TEMPLATES.findIndex(t => t.kind === kind);

    it('omits area for the "product" template (follow product default → no silent rewrite)', () => {
        expect(resolveGelAreaToStore(idxOf('product'), false, 123)).toBeUndefined();
    });

    it('stores the constant for a fixed template regardless of manual/product', () => {
        const fixedIdx = GEL_COVERAGE_TEMPLATES.findIndex(t => t.kind === 'fixed');
        expect(resolveGelAreaToStore(fixedIdx, false, 999)).toBe(GEL_COVERAGE_TEMPLATES[fixedIdx].areaCM2);
    });

    it('stores the manual value, or omits it when blank/non-positive', () => {
        expect(resolveGelAreaToStore(idxOf('manual'), false, 333)).toBe(333);
        expect(resolveGelAreaToStore(idxOf('manual'), false, NaN)).toBeUndefined();
        expect(resolveGelAreaToStore(idxOf('manual'), false, 0)).toBeUndefined();
    });

    it('omits area for scrotal regardless of coverage (area-invariant)', () => {
        expect(resolveGelAreaToStore(idxOf('manual'), true, 333)).toBeUndefined();
        expect(resolveGelAreaToStore(idxOf('product'), true, 333)).toBeUndefined();
    });
});

describe('nextGelProductId — ids are never reused after deletion (F06)', () => {
    it('allocates monotonically even after the highest product is deleted', async () => {
        const store = new Map<string, string>();
        vi.stubGlobal('localStorage', {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => { store.set(k, v); },
            removeItem: (k: string) => { store.delete(k); },
        });
        const { nextGelProductId } = await import('./doseForm');
        const make = (id: number): GelProductSpec => product({ id });

        const first = nextGelProductId([]);
        const second = nextGelProductId([make(first)]);
        // Simulate deleting ALL products, then creating a new one: the id must
        // NOT be reused (historical records reference ids permanently).
        const third = nextGelProductId([]);
        expect(second).toBeGreaterThan(first);
        expect(third).toBeGreaterThan(second);
        vi.unstubAllGlobals();
    });
});

describe('nextGelProductId — failing writes still advance (final review)', () => {
    it('combines persisted seq with session memory when setItem throws', async () => {
        const store = new Map<string, string>([['hrt-gel-id-seq', '1200000000']]);
        vi.stubGlobal('localStorage', {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: () => { throw new Error('quota'); },
            removeItem: (k: string) => { store.delete(k); },
        });
        const { nextGelProductId } = await import('./doseForm');
        const first = nextGelProductId([]);
        const second = nextGelProductId([]);
        const third = nextGelProductId([]);
        expect(second).toBeGreaterThan(first);
        expect(third).toBeGreaterThan(second);
        vi.unstubAllGlobals();
    });
});
