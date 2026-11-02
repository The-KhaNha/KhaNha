import { z } from 'zod';
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
export const AUDIT_ENTITY_TYPES = ['site_settings', 'order', 'profile', 'menu_item'] as const;

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
