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
  // A menu item (P3.4), with the matching CHECK constraints on public.menu_items. Price in whole rupees.
  menuItem: {
    nameMin: 2,
    nameMax: 80,
    descriptionMax: 300,
    categoryMax: 40,
    priceMin: 1,
    priceMax: 100000,
    stockMax: 100000,
  },
  // A store's profile (P3.1), with the matching CHECK constraints on public.stores (name, address). The slug bounds
  // are for a new branch only; existing slugs keep the wider stores.slug check.
  store: {
    nameMin: 2,
    nameMax: 80,
    slugMin: 3,
    slugMax: 48,
    taglineMax: 120,
    descriptionMax: 300,
    areaMax: 60,
    addressMax: 200,
  },
} as const;

/** Most stores `GET /api/stores` returns (docs/CONFIGURATION.md, platform constant); the list is not paginated. */
export const STORE_LIST_MAX = 200;

/** Opening hours (docs/CONFIGURATION.md, platform constants): most intervals a day, most upcoming exceptions a store holds. */
export const HOURS_LIMITS = { intervalsPerDay: 6, upcomingExceptions: 50 } as const;

/**
 * Most items the menu editor's list returns, and most a bulk edit or a reorder may name (docs/CONFIGURATION.md,
 * platform constant): archived items stay in the list, so it may run past MENU_ITEMS_MAX. PostgREST's own row cap
 * (1000) would cut it silently anyway.
 */
export const MANAGED_ITEMS_MAX = 1000;
