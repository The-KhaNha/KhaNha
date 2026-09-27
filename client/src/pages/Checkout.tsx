import { useEffect, useRef, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Check, CircleAlert, LockKeyhole, ShoppingBag } from 'lucide-react';
import { Button, ButtonLink } from '../components/Button';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { Input, Textarea } from '../components/Input';
import { Price } from '../components/Price';
import { selectUser, useAuthStore } from '../features/auth/authStore';
import {
  NAME_MAX_LENGTH,
  NOTE_MAX_LENGTH,
  validateName,
  validateNote,
  validatePhone,
} from '../features/auth/validation';
import {
  describeProblems,
  isItemErrorCode,
  lineProblem,
  problemLabel,
} from '../features/cart/cartRules';
import { selectLines, selectTotal, useCartStore, type CartLine } from '../features/cart/cartStore';
import { useMenu } from '../features/menu/useMenu';
import { ApiError } from '../services/api';
import { createOrder } from '../services/orders';
import { cn } from '../lib/cn';
import { formatPrice } from '../lib/format';

/** How long the green "Paid" state shows before the success screen takes over. */
const PAID_HOLD_MS = 500;

/** What was just paid for: shown during the "Paid" hold after the cart has already been emptied. */
interface Receipt {
  lines: CartLine[];
  total: number;
}

export function CheckoutPage() {
  const lines = useCartStore(selectLines);
  const total = useCartStore(selectTotal);
  const clear = useCartStore((s) => s.clear);
  const fix = useCartStore((s) => s.fix);
  const setAvailability = useCartStore((s) => s.setAvailability);
  const user = useAuthStore(selectUser);
  const navigate = useNavigate();
  // Refreshes each line's stock limit from the live menu on arrival (prices are never touched).
  useMenu();

  const [name, setName] = useState(user?.name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<{ name?: string; phone?: string; note?: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const [paid, setPaid] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const holdTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(holdTimer.current), []);

  const shownLines = receipt?.lines ?? lines;
  const shownTotal = receipt?.total ?? total;

  // Lines the shop can't fulfil as they stand: flagged by the menu refresh or by the server's refusal.
  const flagged = paid ? [] : lines.filter((line) => lineProblem(line) !== null);
  const blocked = flagged.length > 0;
  // An error about one specific line; anything else gets the plain retry block.
  const itemError = error && isItemErrorCode(error.code) ? error : null;

  if (lines.length === 0 && !paid) {
    return (
      <EmptyState
        icon={ShoppingBag}
        title="Your cart is empty."
        description="Add a few items before checking out."
        action={
          <ButtonLink to="/menu" size="lg">
            Browse Menu
          </ButtonLink>
        }
      />
    );
  }

  async function placeOrder() {
    const nextErrors = {
      name: validateName(name),
      phone: validatePhone(phone),
      note: validateNote(note),
    };
    setErrors(nextErrors);
    if (nextErrors.name || nextErrors.phone || nextErrors.note) return;

    setSubmitting(true);
    setError(null);
    try {
      const trimmedPhone = phone.trim();
      const trimmedNote = note.trim();
      const order = await createOrder({
        items: lines.map((line) => ({ menuItemId: line.menuItemId, quantity: line.quantity })),
        customerName: name.trim(),
        ...(trimmedPhone ? { customerPhone: trimmedPhone } : {}),
        ...(trimmedNote ? { note: trimmedNote } : {}),
      });
      // Commit the green "Paid" state and the receipt first, then empty the cart right away: the
      // summary keeps showing what was paid for, and leaving early can't strand paid items in the cart.
      flushSync(() => {
        setSubmitting(false);
        setPaid(true);
        setReceipt({ lines, total });
      });
      clear();
      holdTimer.current = window.setTimeout(() => {
        navigate(`/orders/${order.id}/success`, { replace: true, state: { order } });
      }, PAID_HOLD_MS);
    } catch (err) {
      const apiError =
        err instanceof ApiError ? err : new ApiError(0, 'UNKNOWN', 'Something went wrong.');
      // The server names the line it refused and how many are left: record that so the summary highlights it.
      if (isItemErrorCode(apiError.code) && apiError.details?.menuItemId) {
        setAvailability(apiError.details.menuItemId, apiError.details.available ?? 0);
      }
      setError(apiError);
      setSubmitting(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting || paid || blocked) return;
    void placeOrder();
  }

  /** Trims every flagged line to what is left (or drops it), so the customer can pay again right here. */
  function fixCart() {
    for (const line of flagged) fix(line.menuItemId);
    setError(null);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="pt-4 animate-fade-up">
      {(blocked || itemError) && (
        <ErrorState
          compact
          className="mb-4"
          title={itemError ? itemErrorMessage(itemError, lines) : describeProblems(flagged)}
          message={blocked ? "We've highlighted it below." : 'Go back to your cart to change it.'}
          actions={
            <>
              {blocked && (
                <Button size="lg" onClick={fixCart}>
                  Fix cart
                </Button>
              )}
              <Button variant="secondary" onClick={() => navigate('/cart')}>
                Back to cart
              </Button>
            </>
          }
        />
      )}

      <Card padding="lg">
        <h2 className="eyebrow text-muted">Your order</h2>
        <ul className="mt-3 space-y-2.5 text-[15px] font-medium">
          {shownLines.map((line) => {
            const problem = paid ? null : lineProblem(line);
            return (
              <li
                key={line.menuItemId}
                data-flagged={problem ? true : undefined}
                className={cn(
                  'flex items-baseline justify-between gap-3',
                  problem && '-mx-2.5 rounded-xl px-2.5 py-2 ring-2 ring-brand-500',
                )}
              >
                <span className="min-w-0">
                  <span className="line-clamp-2 wrap-anywhere">
                    <span className="font-extrabold tabular-nums">{line.quantity} ×</span>{' '}
                    {line.name}
                  </span>
                  {problem && (
                    <span className="mt-0.5 inline-flex items-center gap-1 text-[12px] font-bold text-brand-700">
                      <CircleAlert className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
                      {problemLabel(problem)}
                    </span>
                  )}
                </span>
                <Price value={line.unitPrice * line.quantity} className="shrink-0 font-bold" />
              </li>
            );
          })}
        </ul>
      </Card>

      <Card padding="lg" className="mt-4 space-y-4">
        <h2 className="eyebrow text-muted">Pickup details</h2>
        <Input
          label="Name"
          name="customerName"
          autoComplete="name"
          placeholder="Who's picking up?"
          maxLength={NAME_MAX_LENGTH}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setErrors((prev) => ({ ...prev, name: validateName(name) }))}
          error={errors.name}
        />
        <Input
          label="Phone"
          hint="Optional"
          type="tel"
          name="customerPhone"
          autoComplete="tel"
          inputMode="tel"
          placeholder="98765 43210"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onBlur={() => setErrors((prev) => ({ ...prev, phone: validatePhone(phone) }))}
          error={errors.phone}
        />
        <Textarea
          label="Note for the kitchen"
          hint={`Optional · ${note.length}/${NOTE_MAX_LENGTH}`}
          name="note"
          placeholder="e.g. Less spicy"
          maxLength={NOTE_MAX_LENGTH}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          error={errors.note}
        />
      </Card>

      {error && !itemError && (
        <div className="mt-4">
          <ErrorState
            compact
            title="Something went wrong while placing your order."
            message={error.message}
            unreachable={error.isUnreachable}
            onRetry={() => void placeOrder()}
            retrying={submitting}
          />
        </div>
      )}

      <Card padding="lg" className="mt-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="eyebrow text-muted">Total to pay</p>
            <Price
              value={shownTotal}
              className="mt-1.5 block text-[40px] font-extrabold leading-none"
            />
          </div>
          <p className="max-w-[9rem] text-right text-[13px] leading-snug text-muted">
            No taxes or fees. Exactly what you saw.
          </p>
        </div>
        <Button
          type="submit"
          size="lg"
          fullWidth
          className="mt-5"
          variant={paid ? 'success' : 'primary'}
          loading={submitting}
          disabled={paid || blocked}
          iconLeft={
            paid ? (
              <Check className="h-5 w-5 animate-check-pop" strokeWidth={3} aria-hidden />
            ) : (
              <LockKeyhole className="h-5 w-5" aria-hidden />
            )
          }
        >
          {paid ? 'Paid' : submitting ? 'Processing payment…' : `Pay ${formatPrice(shownTotal)}`}
        </Button>
        {blocked ? (
          <p
            role="status"
            className="mt-3 flex items-start justify-center gap-1.5 text-center text-[13px] font-semibold text-brand-700"
          >
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.5} aria-hidden />
            <span>
              {describeProblems(flagged)} Fix {flagged.length === 1 ? 'it' : 'them'} above to pay.
            </span>
          </p>
        ) : (
          <p className="mt-3 text-center text-[12px] text-muted">
            Payment is simulated in this preview build.
          </p>
        )}
      </Card>
    </form>
  );
}

/**
 * The server's own sentence already names the item, except when the item is gone from the menu entirely
 * (it can't know the name then) — the cart line still does, so name it from there.
 */
function itemErrorMessage(error: ApiError, lines: CartLine[]): string {
  if (error.code !== 'ITEM_NOT_FOUND') return error.message;
  const line = lines.find((l) => l.menuItemId === error.details?.menuItemId);
  return line ? `${line.name} is no longer on the menu.` : error.message;
}
