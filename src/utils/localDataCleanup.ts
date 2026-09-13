/**
 * Unified local medical-data teardown (final review, blocker 1).
 *
 * Both "logout and clear local data" and the cross-account ownership prompt
 * ("清除本地数据") must wipe the SAME set of keys and notify in-memory state
 * holders — divergent lists are exactly how private data survives a "clear".
 */
export function clearAllLocalMedicalData(): void {
    localStorage.removeItem('hrt-events');
    localStorage.removeItem('hrt-weight');
    localStorage.removeItem('hrt-lab-results');
    localStorage.removeItem('hrt-lang');
    localStorage.removeItem('hrt-last-modified');
    localStorage.removeItem('hrt-last-data-updated');
    localStorage.removeItem('hrt-last-sync-time');
    localStorage.removeItem('hrt-last-pull-time');
    localStorage.removeItem('hrt-last-known-cloud-updated');
    localStorage.removeItem('hrt-last-known-cloud-hash');
    localStorage.removeItem('hrt-data-hash');

    // Medical-adjacent stores that must not survive a "clear" either (F01):
    // the learned personal model, custom gel registry, dose templates and
    // per-drug dose memory can all reveal treatment details.
    localStorage.removeItem('hrt-personal-model');
    localStorage.removeItem('hrt-gel-products');
    localStorage.removeItem('hrt-dose-templates');
    localStorage.removeItem('hrt-dose-by-drug');
    localStorage.removeItem('hrt-dose-last-drug');
    // Plaintext pre-import snapshot holds a full copy of the records (F16).
    localStorage.removeItem('hrt-pre-import-snapshot');
    // Account ownership markers (final review, blocker 1).
    localStorage.removeItem('hrt-data-owner');
    localStorage.removeItem('hrt-data-ownership-pending');

    // Storage alone is not enough: in-memory React state (events, labs,
    // gel registry, derived model) would write the old records back on the
    // next edit. Notify state holders so they reset too (F01).
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('hrt-clear-local-data'));
    }
}

/** True when the device holds any medical data that sync could move. */
export function hasLocalMedicalData(): boolean {
    try {
        const nonEmptyArray = (key: string): boolean => {
            const raw = localStorage.getItem(key);
            if (!raw) return false;
            const parsed: unknown = JSON.parse(raw);
            return Array.isArray(parsed) && parsed.length > 0;
        };
        // Final-review follow-up: cover EVERY data-bearing section the sync
        // snapshot moves — not just events/labs. Weight, custom gel products
        // and the learned personal model are all medical data that would
        // otherwise upload into a different account.
        if (nonEmptyArray('hrt-events')) return true;
        if (nonEmptyArray('hrt-lab-results')) return true;
        if (nonEmptyArray('hrt-gel-products')) return true;
        if (localStorage.getItem('hrt-personal-model')) return true;
        const weight = localStorage.getItem('hrt-weight');
        if (weight && Number.isFinite(parseFloat(weight)) && parseFloat(weight) > 0) return true;
        return false;
    } catch {
        return false;
    }
}
