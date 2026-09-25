import { forwardRef, useId, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { CircleAlert } from 'lucide-react';
import { cn } from '../lib/cn';

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
}

const fieldClass =
  'w-full rounded-xl border bg-surface px-4 text-[15px] text-ink placeholder:text-[#8f7f74] outline-none ' +
  'transition-[border-color,box-shadow] duration-150 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/20 ' +
  'focus-visible:ring-4 focus-visible:ring-brand-500/20';

function Label({ id, label, hint }: { id: string; label: string; hint?: string }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between">
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
      </label>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  );
}

function FieldError({ id, error }: { id: string; error?: string }) {
  if (!error) return null;
  return (
    <p id={id} role="alert" className="mt-1.5 inline-flex items-center gap-1.5 text-[13px] font-medium text-brand-700 animate-fade-in">
      <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {error}
    </p>
  );
}

export type InputProps = InputHTMLAttributes<HTMLInputElement> & FieldProps;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, className, id: idProp, ...rest },
  ref,
) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const errorId = `${id}-error`;
  return (
    <div className={className}>
      <Label id={id} label={label} hint={hint} />
      <input
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cn(fieldClass, 'h-12', error ? 'border-brand-600' : 'border-line')}
        {...rest}
      />
      <FieldError id={errorId} error={error} />
    </div>
  );
});

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & FieldProps;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, className, id: idProp, rows = 3, ...rest },
  ref,
) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const errorId = `${id}-error`;
  return (
    <div className={className}>
      <Label id={id} label={label} hint={hint} />
      <textarea
        ref={ref}
        id={id}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cn(fieldClass, 'resize-none py-3 leading-relaxed', error ? 'border-brand-600' : 'border-line')}
        {...rest}
      />
      <FieldError id={errorId} error={error} />
    </div>
  );
});
