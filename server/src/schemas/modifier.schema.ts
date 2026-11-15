import { z } from 'zod';
import { typedText, visibleLength } from './common';
import { MODIFIER_LIMITS } from './limits';

const { optionsPerGroup, groupsPerItem, nameMax, selectMax, deltaMax } = MODIFIER_LIMITS;

const name = (what: string) =>
  typedText(nameMax, `${what} must be at most ${nameMax} characters.`).refine(
    (value) => visibleLength(value) >= 1,
    `${what} is required.`,
  );

const option = z.strictObject({
  // An existing option of this group; none for a new one.
  id: z.uuid('Each option id must be an option id.').optional(),
  name: name('Option name'),
  // Whole rupees, may be negative ("Small −₹20"); the service converts to paise.
  priceDelta: z
    .number('Price change must be a number.')
    .int('Price change must be a whole number of rupees.')
    .min(-deltaMax, `Price change must be at least −₹${deltaMax}.`)
    .max(deltaMax, `Price change must be at most ₹${deltaMax}.`),
  isDefault: z.boolean('isDefault must be true or false.'),
  isAvailable: z.boolean('isAvailable must be true or false.'),
});

const select = (field: string) =>
  z
    .number(`${field} must be a number.`)
    .int(`${field} must be a whole number.`)
    .min(0, `${field} cannot be negative.`)
    .max(selectMax, `${field} must be at most ${selectMax}.`);

/** POST and PATCH /stores/:storeId/modifier-groups[/:groupId]: the whole group with its options, in order. */
export const saveModifierGroupSchema = z
  .strictObject({
    name: name('Group name'),
    minSelect: select('minSelect'),
    maxSelect: select('maxSelect').min(1, 'maxSelect must be at least 1.'),
    options: z
      .array(option, 'options must be a list.')
      .min(1, 'Add at least one option.')
      .max(optionsPerGroup, `A group has at most ${optionsPerGroup} options.`),
  })
  .refine((g) => g.minSelect <= g.maxSelect, {
    message: 'minSelect cannot be more than maxSelect.',
    path: ['minSelect'],
  })
  .refine(
    (g) => {
      const ids = g.options.flatMap((o) => (o.id ? [o.id.toLowerCase()] : []));
      return new Set(ids).size === ids.length;
    },
    { message: 'An option is listed twice.', path: ['options'] },
  );

/** PUT /stores/:storeId/menu-items/:itemId/modifier-groups: the item's groups, in order; [] removes them all. */
export const setItemModifierGroupsSchema = z
  .strictObject({
    groupIds: z
      .array(z.uuid('Each group id must be a group id.'), 'groupIds must be a list.')
      .max(groupsPerItem, `An item has at most ${groupsPerItem} groups.`),
  })
  .refine((b) => new Set(b.groupIds.map((id) => id.toLowerCase())).size === b.groupIds.length, {
    message: 'A group is listed twice.',
    path: ['groupIds'],
  });

export type SaveModifierGroupInput = z.infer<typeof saveModifierGroupSchema>;
export type SetItemModifierGroupsInput = z.infer<typeof setItemModifierGroupsSchema>;
