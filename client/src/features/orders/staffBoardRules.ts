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
