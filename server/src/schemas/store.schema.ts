import { z } from 'zod';

/** The `stores.slug` CHECK constraint, so a ref that cannot be a slug is 404 without a database round-trip. */
export const STORE_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;

// Only a string: every ref that names no store (too long, wrong shape, unknown) is the same 404, never a 400.
export const storeRefParamsSchema = z.object({ storeRef: z.string() });

export const storeListQuerySchema = z.object({
  // An empty `?area=` (a picker with nothing chosen) means every area.
  area: z
    .string()
    .max(60, 'Area is too long.')
    .optional()
    .transform((area) => area || undefined),
});
export type StoreListQuery = z.infer<typeof storeListQuerySchema>;
