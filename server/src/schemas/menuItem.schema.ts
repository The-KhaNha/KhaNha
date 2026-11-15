import { z } from 'zod';
import { typedText, visibleLength } from './common';
import { LIMITS, MANAGED_ITEMS_MAX, STORE_LIST_MAX, TEMPLATE_PUSH_COPIES_MAX } from './limits';

const { nameMin, nameMax, descriptionMax, categoryMax, priceMin, priceMax, stockMax } =
  LIMITS.menuItem;

export const DIETS = ['VEG', 'NON_VEG', 'EGG'] as const;

// A processed upload of the same store (POST …/media/uploads, then the worker); null removes the photo.
const imageUploadId = z.uuid('imageUploadId must be an upload id.').nullable().optional();

const fields = {
  name: typedText(nameMax, `Name must be at most ${nameMax} characters.`).refine(
    // Code points too: the database's char_length counts them, and one emoji is two UTF-16 units but one code point.
    (value) => visibleLength(value) >= nameMin && Array.from(value).length >= nameMin,
    `Name must be at least ${nameMin} characters.`,
  ),
  description: typedText(
    descriptionMax,
    `Description must be at most ${descriptionMax} characters.`,
  ),
  category: typedText(categoryMax, `Category must be at most ${categoryMax} characters.`).refine(
    (value) => visibleLength(value) >= 1,
    'Category is required.',
  ),
  // Whole rupees at the API (ADR-004); the service converts to paise.
  price: z
    .number('Price must be a number.')
    .int('Price must be a whole number of rupees.')
    .min(priceMin, `Price must be at least ₹${priceMin}.`)
    .max(priceMax, `Price must be at most ₹${priceMax}.`),
  diet: z.enum(DIETS, 'Diet must be VEG, NON_VEG or EGG.').nullable(),
  isPopular: z.boolean('isPopular must be true or false.'),
  // The starting stock of a new item; null: not tracked.
  stockQuantity: z
    .number('Stock must be a number.')
    .int('Stock must be a whole number.')
    .min(0, 'Stock cannot be negative.')
    .max(stockMax, `Stock must be at most ${stockMax}.`)
    .nullable(),
};

export const createMenuItemSchema = z.strictObject({
  name: fields.name,
  description: fields.description.default(''),
  price: fields.price,
  category: fields.category,
  diet: fields.diet.optional(),
  isPopular: fields.isPopular.optional(),
  stockQuantity: fields.stockQuantity.optional(),
  imageUploadId,
});

export const updateMenuItemSchema = z
  .strictObject({
    name: fields.name.optional(),
    description: fields.description.optional(),
    price: fields.price.optional(),
    category: fields.category.optional(),
    diet: fields.diet.optional(),
    isPopular: fields.isPopular.optional(),
    // No stockQuantity: a stock edit goes through the stock function and its trail (PR 04).
    isAvailable: z.boolean('isAvailable must be true or false.').optional(),
    imageUploadId,
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'Send at least one field to change.',
  });

export type CreateMenuItemInput = z.infer<typeof createMenuItemSchema>;
export type UpdateMenuItemInput = z.infer<typeof updateMenuItemSchema>;

const itemIds = z
  .array(z.uuid('Each item id must be a UUID.'), 'itemIds must be a list of item ids.')
  .min(1, 'Send at least one item.')
  .max(MANAGED_ITEMS_MAX, `Send at most ${MANAGED_ITEMS_MAX} items.`);

/** "Sold out: all juices": the given items, or every item of one category, switched on or off at once. */
export const bulkAvailabilitySchema = z
  .strictObject({
    itemIds: itemIds.optional(),
    category: fields.category.optional(),
    isAvailable: z.boolean('isAvailable must be true or false.'),
  })
  .refine((input) => (input.itemIds === undefined) !== (input.category === undefined), {
    message: 'Send either itemIds or a category.',
    path: ['itemIds'],
  });

/** The whole menu's new order: every unarchived item of the store, each once. */
export const reorderMenuSchema = z.strictObject({ itemIds });

export type BulkAvailabilityInput = z.infer<typeof bulkAvailabilitySchema>;
export type ReorderMenuInput = z.infer<typeof reorderMenuSchema>;

/**
 * What a template push may overwrite (P3.1, D2); stock, availability, order and popularity are never pushed.
 * `modifiers`: the item's template groups and options (P3.2, push_template_items).
 */
export const TEMPLATE_PUSH_FIELDS = [
  'name',
  'description',
  'price',
  'category',
  'diet',
  'photo',
  'modifiers',
] as const;

/** POST /brands/:brandId/template/push: chosen template items, to chosen branches, chosen fields only. */
export const pushTemplateSchema = z
  .strictObject({
    itemIds,
    storeIds: z
      .array(z.uuid('Each store id must be a UUID.'), 'storeIds must be a list of store ids.')
      .min(1, 'Choose at least one store.')
      .max(STORE_LIST_MAX, `Choose at most ${STORE_LIST_MAX} stores.`),
    fields: z
      .array(z.enum(TEMPLATE_PUSH_FIELDS, 'Unknown field.'), 'fields must be a list.')
      .min(1, 'Choose at least one field.')
      .max(TEMPLATE_PUSH_FIELDS.length),
  })
  .refine((input) => input.itemIds.length * input.storeIds.length <= TEMPLATE_PUSH_COPIES_MAX, {
    message: `One push may reach at most ${TEMPLATE_PUSH_COPIES_MAX} copies (items × stores): push fewer at a time.`,
    path: ['itemIds'],
  });

export type PushTemplateInput = z.infer<typeof pushTemplateSchema>;
