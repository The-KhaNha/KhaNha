import { useState, type CSSProperties } from 'react';
import { Check, CircleX } from 'lucide-react';
import type { OrderStatus } from '../types/api';
import { ORDER_STEPS, STATUS_META, stepIndex } from '../features/orders/orderStatus';
import { cn } from '../lib/cn';

interface StatusTrackerProps {
  status: OrderStatus;
  className?: string;
}

/**
 * Four-step progress. Done = green with a white check, active = the status's own colour pulsing softly,
 * upcoming = quiet outline. Connectors fill green as steps complete ("done" always means green).
 */
export function StatusTracker({ status, className }: StatusTrackerProps) {
  if (status === 'CANCELLED') return <CancelledTracker className={className} />;
  return <StepTracker status={status} className={className} />;
}

function StepTracker({ status, className }: { status: OrderStatus; className?: string }) {
  const current = stepIndex(status);
  // COMPLETED is the end of the road: every step reads as done and nothing pulses any more.
  const finished = status === 'COMPLETED';
  // Only pop the active disc when the status changes while the tracker is on screen (a poll transition).
  const [initialStatus] = useState(status);
  const transitioned = initialStatus !== status;

  return (
    <ol className={cn('flex items-start', className)} aria-label="Order progress">
      {ORDER_STEPS.map((step, index) => {
        const meta = STATUS_META[step];
        const done = finished || index < current;
        const active = !finished && index === current;
        const last = index === ORDER_STEPS.length - 1;
        const Icon = meta.icon;

        return (
          <li key={step} className={cn('flex min-w-0', last ? 'flex-none' : 'flex-1')}>
            <div className="flex w-16 flex-col items-center">
              <span
                key={active && transitioned ? `${step}-active` : step}
                aria-current={active ? 'step' : undefined}
                style={{ '--pulse-rgb': meta.pulseRgb } as CSSProperties}
                className={cn(
                  'grid h-10 w-10 place-items-center rounded-full transition-colors duration-300',
                  done && 'bg-success-500 text-white',
                  active && cn(meta.fillClass, meta.onFillClass),
                  // One animation utility only: two `animate-*` classes on the same element would fight.
                  active &&
                    (transitioned
                      ? 'animate-[pop_320ms_var(--ease-spring),pulse-soft_1.8s_ease-in-out_infinite]'
                      : 'animate-pulse-soft'),
                  !done && !active && 'border-2 border-line bg-surface text-muted',
                )}
              >
                {done ? (
                  <Check className="h-5 w-5" strokeWidth={2.75} aria-hidden />
                ) : (
                  <Icon className="h-[18px] w-[18px]" strokeWidth={2.25} aria-hidden />
                )}
              </span>
              <span
                className={cn(
                  'mt-2 text-center text-[11px] font-semibold leading-tight transition-colors duration-300',
                  active ? 'text-ink' : done ? 'text-success-700' : 'text-muted',
                )}
              >
                {meta.label}
              </span>
            </div>
            {!last && (
              <div
                className="relative mt-5 h-0.5 flex-1 -mx-3 overflow-hidden rounded-full bg-line"
                aria-hidden
              >
                <div
                  className={cn(
                    'h-full rounded-full bg-success-500 transition-[width] duration-500 ease-out',
                    done ? 'w-full' : 'w-0',
                  )}
                />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function CancelledTracker({ className }: { className?: string }) {
  const meta = STATUS_META.CANCELLED;
  return (
    <div className={cn('flex items-center gap-3 rounded-2xl bg-cancel-50 px-4 py-3', className)}>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface text-cancel-700">
        <CircleX className="h-5 w-5" aria-hidden />
      </span>
      <div>
        <p className="text-[15px] font-bold">{meta.customerTitle}</p>
        <p className="text-[13px] text-muted">This order won't move forward.</p>
      </div>
    </div>
  );
}
