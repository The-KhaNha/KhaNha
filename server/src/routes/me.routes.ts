import { Router } from 'express';
import * as team from '../controllers/team.controller';
import { requireAuth } from '../middleware/auth';
import { inviteAcceptLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { acceptInviteSchema } from '../schemas/team.schema';

export const meRouter = Router();

// The token travels in the body: the access log keeps the path, and field redaction (REDACT_PATHS) covers the body.
meRouter.post(
  '/invites/accept',
  requireAuth,
  inviteAcceptLimiter,
  validate(acceptInviteSchema),
  team.acceptInvite,
);
