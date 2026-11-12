import type { Request, RequestHandler } from 'express';
import { accessFor, can } from '../domain/permissions';
import { currentStore, currentUser, requestContext } from '../middleware/auth';
import type { CreateInviteInput } from '../schemas/team.schema';
import * as team from '../services/team.service';
import type { BodyHandler } from '../types/http';

/**
 * Whether the caller may act on managers here. requireStore admitted them for `team.manageStaff` with the first
 * standing that holds it; an admin who is also a member must be judged by the standing that holds this one.
 */
function managesManagers(req: Request): boolean {
  const store = currentStore(req);
  const access = accessFor(currentUser(req), store, 'team.manageManagers');
  return can(access, 'team.manageManagers');
}

/** GET /api/stores/:storeId/members, after requireStore('team.manageStaff'). */
export const listTeam: RequestHandler = async (req, res) => {
  res.json(await team.listTeam(currentStore(req).id));
};

/** POST /api/stores/:storeId/invites, after requireStore('team.manageStaff'). The token is in this answer only. */
export const createInvite: BodyHandler<CreateInviteInput> = async (req, res) => {
  const created = await team.createInvite(
    currentStore(req),
    req.body,
    managesManagers(req),
    requestContext(req),
  );
  req.log.info({ storeId: currentStore(req).id, inviteId: created.invite.id }, 'Invite created');
  res.status(201).json(created);
};

/** DELETE /api/stores/:storeId/invites/:inviteId, after requireStore('team.manageStaff'). */
export const revokeInvite: RequestHandler = async (req, res) => {
  await team.revokeInvite(
    currentStore(req).id,
    String(req.params.inviteId),
    managesManagers(req),
    requestContext(req),
  );
  res.status(204).end();
};

/** DELETE /api/stores/:storeId/members/:membershipId, after requireStore('team.manageStaff'). */
export const removeMember: RequestHandler = async (req, res) => {
  await team.removeMember(
    currentStore(req).id,
    String(req.params.membershipId),
    currentUser(req).id,
    managesManagers(req),
    requestContext(req),
  );
  res.status(204).end();
};
