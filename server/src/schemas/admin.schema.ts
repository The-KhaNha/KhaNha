import { z } from 'zod';
import { ROLES } from '../types/enums';
import { LIMITS } from './limits';

// Same bounds as the check constraints on public.site_settings, so a bad value is a 400, never a database error.
const integer = (name: string, min: number, max: number) =>
  z
    .number(`${name} must be a number.`)
    .int(`${name} must be a whole number.`)
    .min(min, `${name} must be at least ${min}.`)
    .max(max, `${name} must be at most ${max}.`);
const limit = (name: string, max: number) => integer(name, 1, max);
const pollMs = (name: string) => integer(name, LIMITS.pollMs.min, LIMITS.pollMs.max);

export const updateSettingsSchema = z
  .object({
    customerOrderHistoryLimit: limit('Customer order history limit', 200).optional(),
    staffOrderListLimit: limit('Staff order list limit', 500).optional(),
    maxLinesPerOrder: limit('Items per order', 100).optional(),
    orderPollMs: pollMs('Order page refresh').optional(),
    ordersPollMs: pollMs('Order list refresh').optional(),
    staffBoardPollMs: pollMs('Staff board refresh').optional(),
    clientErrorSamplePercent: integer('Error reporting sample', 0, 100).optional(),
    minClientVersion: z
      .string('Minimum client version must be text.')
      .regex(/^\d+\.\d+\.\d+$/, 'Minimum client version must look like 1.2.3.')
      .optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'Send at least one setting to change.',
  });

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

/** One page of GET /api/admin/audit: newest first, `limit` rows. */
export const AUDIT_PAGE = { default: 50, max: 100 } as const;

// The entity types the audit_row_change triggers write: the first part of each trigger's action. A new audited table
// adds its type here; audit-read.test.ts compares this list with the triggers.
export const AUDIT_ENTITY_TYPES = [
  'site_settings',
  'order',
  'profile',
  'menu_item',
  'feature_flag',
  'brand',
  'store',
  'membership',
  'store_settings',
  'store_hours',
  'schedule_exception',
] as const;

const timestamp = (name: string) =>
  z.iso
    .datetime({ offset: true, message: `${name} must be an ISO 8601 date and time.` })
    .optional();

export const auditQuerySchema = z
  .object({
    entityType: z
      .enum(AUDIT_ENTITY_TYPES, `entityType must be one of: ${AUDIT_ENTITY_TYPES.join(', ')}.`)
      .optional(),
    entityId: z
      .string()
      .trim()
      .min(1)
      .max(64, 'entityId must be at most 64 characters.')
      .optional(),
    actorId: z.uuid('actorId must be a UUID.').optional(),
    from: timestamp('from'),
    to: timestamp('to'),
    // The keyset cursor: the nextCursor of the previous page.
    before: z.coerce
      .number('before must be a number.')
      .int('before must be a whole number.')
      .positive('before must be at least 1.')
      .optional(),
    limit: z.coerce
      .number('limit must be a number.')
      .int('limit must be a whole number.')
      .min(1, 'limit must be at least 1.')
      .max(AUDIT_PAGE.max, `limit must be at most ${AUDIT_PAGE.max}.`)
      // Defaulted in listAudit: a required key here would not fit Express's ParsedQs-typed route handlers.
      .optional(),
  })
  // An entity id alone could match rows of several types, and the entity index starts with the type.
  .refine((query) => query.entityId === undefined || query.entityType !== undefined, {
    message: 'Send entityType with entityId.',
    path: ['entityType'],
  })
  // An inverted range would read as "nothing changed" instead of a mistake.
  .refine((query) => !query.from || !query.to || Date.parse(query.from) < Date.parse(query.to), {
    message: 'from must be before to.',
    path: ['from'],
  });

export type AuditQuery = z.infer<typeof auditQuerySchema>;

// A flag's targeting (feature_flags.rules). Each list narrows who gets the flag; a missing one narrows nothing. Strict:
// a misspelt key ("storeId") stripped silently would turn a targeted flag on for everyone.
const noDuplicates = (list: readonly string[]) => new Set(list).size === list.length;

export const flagRulesSchema = z.strictObject(
  {
    storeIds: z
      .array(z.uuid('storeIds must hold store ids.'))
      .min(1)
      .max(100)
      .refine(noDuplicates, 'storeIds must not repeat a store.')
      .optional(),
    roles: z
      .array(z.enum(ROLES, `roles must be some of: ${ROLES.join(', ')}.`))
      .min(1)
      .max(ROLES.length)
      .refine(noDuplicates, 'roles must not repeat a role.')
      .optional(),
    percent: integer('percent', 0, 100).optional(),
  },
  'rules may hold only storeIds, roles and percent.',
);

export type FlagRules = z.infer<typeof flagRulesSchema>;

export const updateFlagSchema = z
  .object({
    enabled: z.boolean('enabled must be true or false.').optional(),
    clientVisible: z.boolean('clientVisible must be true or false.').optional(),
    rules: flagRulesSchema.optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'Send enabled, clientVisible or rules.',
  });

export type UpdateFlagInput = z.infer<typeof updateFlagSchema>;
