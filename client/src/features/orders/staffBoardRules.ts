import type { Order } from '../../types/api';
import { STAFF_FILTERS, isTerminal, matchesFilter, type StaffFilterKey } from './orderStatus';

/** Active orders oldest-first (fair queue); finished orders newest-first after them. */
export function queueOrder(a: Order, b: Order): number {
  const aDone = isTerminal(a.status) ? 1 : 0;
  const bDone = isTerminal(b.status) ? 1 : 0;
  if (aDone !== bDone) return aDone - bDone;
  const diff = Date.parse(a.createdAt) - Date.parse(b.createdAt);
  return aDone ? -diff : diff;
}

/** How many orders each filter chip matches. */
export function countByFilter(orders: readonly Order[]): Record<StaffFilterKey, number> {
  const counts: Record<StaffFilterKey, number> = {
    ALL: 0,
    NEW: 0,
    PREPARING: 0,
    READY: 0,
    COLLECTED: 0,
  };
  for (const order of orders) {
    for (const f of STAFF_FILTERS) if (matchesFilter(order.status, f)) counts[f.key] += 1;
  }
  return counts;
}

/** A failed staff action, shown on its order card until the next action on that card or until it goes stale. */
export interface StaffActionError {
  message: string;
  /** The request never reached the API: the network, not the order, was the problem. */
  unreachable: boolean;
  /** When it failed (ms since epoch). */
  at: number;
}

/**
 * The card messages to show now. An "unreachable" error goes stale once the board has loaded again after it failed:
 * the connection is back, and a stale "We couldn't reach the server" would send staff chasing a problem that is gone.
 * Other errors (an invalid transition, a 403) stay until that card's next action.
 */
export function visibleActionErrors(
  errors: Record<string, StaffActionError>,
  boardUpdatedAt: number | null,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(errors)
      .filter(([, e]) => !(e.unreachable && boardUpdatedAt !== null && boardUpdatedAt > e.at))
      .map(([id, e]) => [id, e.message]),
  );
}
