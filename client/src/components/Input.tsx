import { forwardRef, useId, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { CircleAlert } from 'lucide-react';
import { cn } from '../lib/cn';

interface FieldProps {
  label: string;
  hint?: string;
  /**
   * `inline` (default): a short tag ("Optional", "3/200") right-aligned on the label's line. `below`: a sentence on
   * its own line under the label, for hints too long to share a 360px line with it (the admin settings form).
   */
  hintPlacement?: 'inline' | 'below';
  error?: string;
}

/** The ids the field is described by: its hint, then its error, whichever are shown. */
function describedBy(id: string, hint?: string, error?: string): string | undefined {
  const ids = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean);
  return ids.length > 0 ? ids.join(' ') : undefined;
}

const fieldClass =
  'w-full rounded-xl border bg-surface px-4 text-body text-ink placeholder:text-hint outline-none ' +
  'transition-[border-color,box-shadow] duration-150 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/20 ' +
  'focus-visible:ring-4 focus-visible:ring-brand-500/20';

function Label({
  id,
  label,
  hint,
  hintPlacement = 'inline',
}: {
  id: string;
  label: string;
  hint?: string;
  hintPlacement?: FieldProps['hintPlacement'];
}) {
  if (hintPlacement === 'below') {
    return (
      <div className="mb-1.5">
        <label htmlFor={id} className="block text-sm font-semibold text-ink">
          {label}
        </label>
        {hint && (
          <p id={`${id}-hint`} className="mt-0.5 text-xs leading-snug text-muted">
            {hint}
          </p>
        )}
      </div>
    );
  }
  return (
    // Wraps so a long hint drops under the label at large text instead of running off the screen.
    <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3">
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
      </label>
      {hint && (
        <span id={`${id}-hint`} className="min-w-0 text-xs text-muted">
          {hint}
        </span>
      )}
    </div>
  );
}

function FieldError({ id, error }: { id: string; error?: string }) {
  if (!error) return null;
  return (
    <p
      id={id}
      role="alert"
      className="mt-1.5 inline-flex items-center gap-1.5 text-caption font-medium text-brand-700 animate-fade-in"
    >
      <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {error}
    </p>
  );
}

export type InputProps = InputHTMLAttributes<HTMLInputElement> & FieldProps;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, hintPlacement, error, className, id: idProp, ...rest },
  ref,
) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const errorId = `${id}-error`;
  return (
    <div className={className}>
      <Label id={id} label={label} hint={hint} hintPlacement={hintPlacement} />
      <input
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cn(fieldClass, 'h-12', error ? 'border-brand-600' : 'border-line')}
        {...rest}
      />
      <FieldError id={errorId} error={error} />
    </div>
  );
});

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & FieldProps;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, hintPlacement, error, className, id: idProp, rows = 3, ...rest },
  ref,
) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const errorId = `${id}-error`;
  return (
    <div className={className}>
      <Label id={id} label={label} hint={hint} hintPlacement={hintPlacement} />
      <textarea
        ref={ref}
        id={id}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cn(
          fieldClass,
          'resize-none py-3 leading-relaxed',
          error ? 'border-brand-600' : 'border-line',
        )}
        {...rest}
      />
      <FieldError id={errorId} error={error} />
    </div>
  );
});
