import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../../components/Button';
import { useFocusTrap } from '../../lib/useFocusTrap';

interface ReplaceCartSheetProps {
  /** The store the cart holds now, and the one the customer is adding from. */
  fromName: string;
  toName: string;
  onReplace: () => void;
  /** Keep the current cart: also Escape and the backdrop. */
  onKeep: () => void;
}

/**
 * "Start a new cart?": adding from another store asks first. The ItemDetailSheet pattern; mount it only while the
 * question is open. Keep is the safe default and takes the first focus.
 */
export function ReplaceCartSheet({ fromName, toName, onReplace, onKeep }: ReplaceCartSheetProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, true);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onKeep();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [onKeep]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6">
      <button
        type="button"
        aria-label="Close"
        onClick={onKeep}
        tabIndex={-1}
        className="absolute inset-0 animate-fade-in bg-overlay/45 backdrop-blur-[2px]"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="replace-cart-title"
        aria-describedby="replace-cart-text"
        tabIndex={-1}
        className="relative w-full animate-sheet-up rounded-t-card bg-surface p-5 pb-safe shadow-float outline-none md:max-w-[420px] md:animate-scale-in md:rounded-card"
      >
        <h2 id="replace-cart-title" className="text-title font-extrabold leading-tight">
          Start a new cart?
        </h2>
        <p
          id="replace-cart-text"
          className="mt-2 wrap-anywhere text-body leading-relaxed text-muted"
        >
          Your cart has items from {fromName}. Adding from {toName} replaces them.
        </p>
        <div className="mt-5 space-y-2 pb-2">
          <Button size="lg" fullWidth data-autofocus onClick={onKeep}>
            Keep my cart
          </Button>
          <Button size="lg" fullWidth variant="secondary" onClick={onReplace}>
            Replace with {toName}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
