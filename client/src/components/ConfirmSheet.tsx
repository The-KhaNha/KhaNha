import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import { useFocusTrap } from '../lib/useFocusTrap';

interface ConfirmSheetProps {
  title: string;
  text: string;
  confirmLabel: string;
  onConfirm: () => void;
  /** Also Escape and the backdrop. */
  onCancel: () => void;
  busy?: boolean;
}

/** "Are you sure?" for a destructive tap: the ReplaceCartSheet pattern. Mount it only while the question is open. */
export function ConfirmSheet({
  title,
  text,
  confirmLabel,
  onConfirm,
  onCancel,
  busy,
}: ConfirmSheetProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, true);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [onCancel]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6">
      {/* Pointer-only: Keep and Escape are the keyboard and screen-reader ways out. */}
      <div
        aria-hidden="true"
        onClick={onCancel}
        className="absolute inset-0 animate-fade-in bg-overlay/45 backdrop-blur-[2px]"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-text"
        tabIndex={-1}
        className="relative w-full animate-sheet-up rounded-t-card bg-surface p-5 pb-safe shadow-float outline-none md:max-w-[420px] md:animate-scale-in md:rounded-card"
      >
        <h2 id="confirm-title" className="text-title font-extrabold leading-tight">
          {title}
        </h2>
        <p id="confirm-text" className="mt-2 wrap-anywhere text-body leading-relaxed text-muted">
          {text}
        </p>
        <div className="mt-5 space-y-2 pb-2">
          <Button size="lg" fullWidth data-autofocus variant="secondary" onClick={onCancel}>
            Keep
          </Button>
          <Button size="lg" fullWidth variant="danger" loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
