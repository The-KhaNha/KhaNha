/**
 * Field bounds the API enforces and the client's forms mirror. The client's one copy is
 * client/src/config/fallbacks.json (`validation`), kept equal by test/unit/limits-parity.safe.test.ts.
 */
export const LIMITS = {
  nameMin: 2,
  nameMax: 60,
  noteMax: 200,
  // bcrypt only reads the first 72 bytes, so a longer password would silently be truncated.
  password: { min: 6, max: 72 },
  phoneDigits: { min: 10, max: 15 },
  // The poll-interval site settings, in ms: faster than 2 s costs customers data, slower than a minute makes a status
  // change feel lost.
  pollMs: { min: 2000, max: 60000 },
  // POST /api/client-errors: sized so five reports stay well under the 64 KB a `keepalive` request may carry in
  // flight. The browser reporter cuts to the same bounds, so a tightened bound here must reach it too.
  clientErrors: { reportsMax: 5, messageMax: 500, stackMax: 3500, routeMax: 200 },
} as const;

/** Most stores `GET /api/stores` returns (docs/CONFIGURATION.md, platform constant); the list is not paginated. */
export const STORE_LIST_MAX = 200;
