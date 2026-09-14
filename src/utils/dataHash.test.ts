import { describe, it, expect } from 'vitest';
import { computeDataHash, projectForSync, SYNC_HASH_SCHEMA } from './dataHash';

const base = { events: [], weight: 70, labResults: [] };

describe('computeDataHash schema versioning', () => {
    it('prefixes the hash with the current schema tag', () => {
        const h = computeDataHash(base);
        expect(h.startsWith(SYNC_HASH_SCHEMA + ':')).toBe(true);
    });

    it('treats an absent gelProducts as equal to an empty list (projection normalization)', () => {
        const absent = computeDataHash(base);
        const empty = computeDataHash({ ...base, gelProducts: [] });
        expect(absent).toBe(empty);
    });

    it('changes when a synced field actually changes', () => {
        const a = computeDataHash(base);
        const b = computeDataHash({ ...base, gelProducts: [{ id: 1000 }] });
        expect(a).not.toBe(b);
    });

    it('projectForSync fills every synced field with a default', () => {
        const p = projectForSync({});
        expect(p.gelProducts).toEqual([]);
        expect(p.themeColor).toBe('');
        expect(p.weight).toBe(0);
    });
    it('ignores local-only theme mode and legacy dark mode', () => {
        const light = computeDataHash({ ...base, themeMode: 'light', darkMode: false });
        const dark = computeDataHash({ ...base, themeMode: 'dark', darkMode: true });
        expect(light).toBe(dark);
    });
});
