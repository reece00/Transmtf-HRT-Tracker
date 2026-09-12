import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTORS = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(', ');

// Module-level stack of currently-open focus traps. Only the topmost trap
// responds to Escape / Tab — prevents Escape from cascading through stacked
// modals (e.g. an alert opened on top of an edit dialog).
const modalStack: symbol[] = [];

/**
 * Accessibility focus trap for modal dialogs.
 * - Moves focus into the dialog when it opens
 * - Traps Tab / Shift+Tab within the dialog (only when topmost)
 * - Closes the dialog on Escape (only when topmost)
 * - Restores focus to the previously focused element when closed
 */
export function useFocusTrap(isOpen: boolean, onClose?: () => void, opts?: { initialFocus?: 'first' | 'last' }) {
    const ref = useRef<HTMLDivElement>(null);
    const previousFocusRef = useRef<Element | null>(null);
    const idRef = useRef<symbol | null>(null);

    // Maintain a stable id per mounted trap so stack ordering matches mount order.
    if (idRef.current === null) {
        idRef.current = Symbol('focus-trap');
    }

    // Save previous focus & move focus into dialog on open; restore on close.
    // Also register/unregister in the modal stack so Escape/Tab only fire on top.
    useEffect(() => {
        if (!isOpen) return;
        const id = idRef.current!;
        modalStack.push(id);

        previousFocusRef.current = document.activeElement;

        const timer = setTimeout(() => {
            const focusable = ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS);
            if (!focusable || focusable.length === 0) return;
            const target = opts?.initialFocus === 'last' ? focusable[focusable.length - 1] : focusable[0];
            target?.focus();
        }, 50);

        return () => {
            clearTimeout(timer);
            const idx = modalStack.indexOf(id);
            if (idx >= 0) modalStack.splice(idx, 1);
            if (previousFocusRef.current instanceof HTMLElement) {
                previousFocusRef.current.focus();
            }
        };
    }, [isOpen, opts?.initialFocus]);

    // Trap Tab and handle Escape — only when this trap is topmost.
    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            // Only the topmost open trap should react to keyboard.
            if (modalStack[modalStack.length - 1] !== idRef.current) return;

            if (e.key === 'Escape') {
                onClose?.();
                return;
            }

            if (e.key !== 'Tab') return;

            const el = ref.current;
            if (!el) return;

            const focusable = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS));
            if (focusable.length === 0) return;

            const first = focusable[0];
            const last = focusable[focusable.length - 1];

            if (e.shiftKey) {
                if (document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                }
            } else {
                if (document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    return ref;
}
