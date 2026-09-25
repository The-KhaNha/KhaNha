import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusablesIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('aria-hidden') && el.getClientRects().length > 0,
  );
}

/**
 * Modal focus management for a dialog that is mounted while `active` is true:
 * - moves focus into it on open ([data-autofocus] first, else the first focusable, else the container),
 * - keeps Tab / Shift+Tab cycling inside it,
 * - hands focus back to whatever opened it when it closes.
 * Escape handling and body scroll locking stay with the caller.
 */
export function useFocusTrap(ref: RefObject<HTMLElement>, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (!container) return;

    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const initial = container.querySelector<HTMLElement>('[data-autofocus]') ?? focusablesIn(container)[0] ?? container;
    // Next frame, so the portal has painted and focusing doesn't fight the entrance animation.
    const frame = window.requestAnimationFrame(() => initial.focus({ preventScroll: true }));

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = focusablesIn(container);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        event.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }
      const current = document.activeElement;
      const outside = !(current instanceof Node && container.contains(current));
      if (event.shiftKey) {
        if (outside || current === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (outside || current === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
      opener?.focus({ preventScroll: true });
    };
  }, [ref, active]);
}
