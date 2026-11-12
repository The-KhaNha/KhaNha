import { z } from 'zod';

/** How long an invite stays open (P2.2). A platform constant: docs/CONFIGURATION.md. */
export const INVITE_EXPIRY_DAYS = 7;

export const createInviteSchema = z.object({
  // Lower-cased like auth.users keeps it, so the invite matches the account whatever case was typed. 320 is the
  // longest address there is, and the store_invites CHECK.
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(320, 'That email address is too long.')
    .email('Please enter a valid email address.'),
  role: z.enum(['MANAGER', 'STAFF'], 'role must be MANAGER or STAFF.'),
});
export type CreateInviteInput = z.infer<typeof createInviteSchema>;

export const acceptInviteSchema = z.object({
  // 32 random bytes in base64url are 43 characters; anything far from that is no token, and never reaches a hash.
  token: z.string().min(1, 'token is required.').max(100, 'That invite link is not valid.'),
});
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
