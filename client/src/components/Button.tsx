import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { LoaderCircle } from 'lucide-react';
import { cn } from '../lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'tint' | 'danger' | 'success';
export type ButtonSize = 'md' | 'lg';

interface StyleProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

const base =
  'inline-flex items-center justify-center gap-2 rounded-[14px] font-semibold select-none whitespace-nowrap ' +
  'transition-[background-color,color,translate,scale,box-shadow,opacity] duration-[120ms] ease-out active:scale-[0.97] ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg ' +
  'disabled:pointer-events-none disabled:opacity-50';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-brand-500 text-white shadow-brand hover:bg-brand-600 hover:shadow-brand-hover',
  secondary: 'bg-surface text-ink border border-line shadow-[0_1px_2px_rgba(27,20,16,0.05)] hover:bg-surface-2',
  ghost: 'bg-transparent text-muted hover:text-ink hover:bg-surface-2',
  /** Tinted paprika pill for secondary brand actions ("Order Again"). */
  tint: 'bg-brand-50 text-brand-700 hover:bg-brand-100',
  danger: 'bg-cancel-50 text-cancel-700 hover:bg-cancel-500/20',
  /** Transient confirmation state ("Added", "Paid"). Not for resting CTAs. */
  success: 'bg-success-500 text-white shadow-[0_10px_24px_-10px_rgba(21,128,61,0.55)]',
};

const sizes: Record<ButtonSize, string> = {
  md: 'h-11 px-4 text-[15px]',
  lg: 'h-14 px-6 text-base',
};

export function buttonClasses({ variant = 'primary', size = 'md', fullWidth = false }: StyleProps, extra?: string) {
  return cn(base, variants[variant], sizes[size], fullWidth && 'w-full', extra);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, StyleProps {
  loading?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
}

export function Button({
  variant,
  size,
  fullWidth,
  loading = false,
  iconLeft,
  iconRight,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses({ variant, size, fullWidth }, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <LoaderCircle className="h-[1.15em] w-[1.15em] animate-spin" aria-hidden /> : iconLeft}
      {children}
      {iconRight}
    </button>
  );
}

export interface ButtonLinkProps extends LinkProps, StyleProps {
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
}

/** A router Link styled exactly like a Button. */
export function ButtonLink({ variant, size, fullWidth, iconLeft, iconRight, className, children, ...rest }: ButtonLinkProps) {
  return (
    <Link className={buttonClasses({ variant, size, fullWidth }, className)} {...rest}>
      {iconLeft}
      {children}
      {iconRight}
    </Link>
  );
}
