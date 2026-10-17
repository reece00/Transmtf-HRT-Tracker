import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    effects: [] as (() => void)[],
    showDialog: vi.fn(async () => 'third'),
    clearData: vi.fn(),
}));
vi.mock('react', async importOriginal => ({
    ...await importOriginal<typeof import('react')>(),
    useState: (value: unknown) => [value, vi.fn()],
    useRef: (value: unknown) => ({ current: value }),
    useMemo: (factory: () => unknown) => factory(),
    useEffect: (effect: () => void) => { mocks.effects.push(effect); },
}));
vi.mock('react-router-dom', () => ({
    useLocation: () => ({ pathname: '/' }), useNavigate: () => vi.fn(), Outlet: () => null,
}));
vi.mock('../contexts/LanguageContext', () => ({ useTranslation: () => ({ t: (key: string) => key, lang: 'en' }) }));
vi.mock('../contexts/DialogContext', () => ({ useDialog: () => ({ showDialog: mocks.showDialog }) }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: true, user: null }) }));
vi.mock('../contexts/AppDataContext', () => ({
    useAppData: () => ({ events: [], labResults: [], currentTime: new Date(0), setEvents: vi.fn(), setLabResults: vi.fn() }),
    PER_DOSE_WEIGHT_MIGRATION_EVENT: 'migration',
}));
vi.mock('../utils/localDataCleanup', () => ({ clearAllLocalMedicalData: mocks.clearData }));
vi.mock('./DoseFormModal', () => ({ default: () => null }));
vi.mock('./BatchDoseModal', () => ({ default: () => null }));
vi.mock('./LabResultModal', () => ({ default: () => null }));
import MainLayout from './MainLayout';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('restored-session ownership prompt', () => {
    it('defaults dismissal and initial focus to Decide later, preserving local data', async () => {
        vi.useFakeTimers();
        const removeItem = vi.fn();
        vi.stubGlobal('localStorage', { getItem: () => '1', removeItem });
        vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
        vi.stubGlobal('document', { body: { style: {} } });
        vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
        MainLayout({});
        mocks.effects.forEach(effect => effect());
        await Promise.resolve();
        expect(mocks.showDialog).toHaveBeenCalledWith('confirm', 'sync.ownership_prompt', {
            confirmText: 'sync.ownership_upload',
            cancelText: 'sync.ownership_clear',
            thirdOption: 'sync.ownership_later',
            dismissValue: 'third',
            initialFocus: 'last',
        });
        expect(mocks.clearData).not.toHaveBeenCalled();
        expect(removeItem).not.toHaveBeenCalled();
    });
});
