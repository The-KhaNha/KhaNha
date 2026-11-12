import { z } from 'zod';
import { phoneField, typedText, visibleLength } from './common';
import { LIMITS } from './limits';

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

const { nameMin, nameMax, slugMin, slugMax, taglineMax, descriptionMax, areaMax, addressMax } =
  LIMITS.store;

/** A new branch's slug: the stores.slug shape, and LIMITS.store's length. */
export const NEW_STORE_SLUG_PATTERN = new RegExp(
  `^(?=.{${slugMin},${slugMax}}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$`,
);

const name = typedText(nameMax, `Name must be at most ${nameMax} characters.`).refine(
  // Code points too, as stores_name_length counts them.
  (value) => visibleLength(value) >= nameMin && Array.from(value).length >= nameMin,
  `Name must be at least ${nameMin} characters.`,
);
// Optional place fields: a blank one clears it (null), as the column allows.
const place = (max: number, label: string) =>
  z.preprocess(
    (value) => (typeof value === 'string' && visibleLength(value) === 0 ? null : value),
    typedText(max, `${label} must be at most ${max} characters.`).nullable(),
  );

export const createStoreSchema = z.strictObject({
  name,
  // Lower-case letters, digits and dashes; omitted: made from the name.
  slug: z
    .string()
    .regex(
      NEW_STORE_SLUG_PATTERN,
      `Use ${slugMin}–${slugMax} lower-case letters, digits and dashes, not starting or ending with a dash.`,
    )
    .optional(),
  area: place(areaMax, 'Area').optional(),
  addressLine: place(addressMax, 'Address').optional(),
});

export const updateStoreProfileSchema = z
  .strictObject({
    name: name.optional(),
    tagline: typedText(taglineMax, `Tagline must be at most ${taglineMax} characters.`).optional(),
    description: typedText(
      descriptionMax,
      `Description must be at most ${descriptionMax} characters.`,
    ).optional(),
    area: place(areaMax, 'Area').optional(),
    addressLine: place(addressMax, 'Address').optional(),
    // null or a blank one clears it.
    contactPhone: phoneField
      .nullable()
      .transform((value) => value ?? null)
      .optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'Send at least one field to change.',
  });

export type CreateStoreInput = z.infer<typeof createStoreSchema>;
export type UpdateStoreProfileInput = z.infer<typeof updateStoreProfileSchema>;
