import type { RequestHandler } from 'express';
import { Role } from '@prisma/client';
import type { AuthUser } from '../types/auth';
import { forbidden, unauthorized } from '../utils/errors';
import { verifyToken } from '../utils/jwt';
import { prisma } from '../utils/prisma';

function readBearerToken(header: string | undefined): string | undefined {
  const [scheme, token] = header?.split(' ') ?? [];
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
}

/** Requires a valid bearer token for a user that still exists; attaches `req.user`. */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const token = readBearerToken(req.header('authorization'));
  if (!token) throw unauthorized();

  const payload = verifyToken(token);
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, role: true },
  });
  if (!user) throw unauthorized('That account no longer exists. Please sign in again.');

  req.user = user;
  next();
};

/** Must run after `requireAuth`. */
export const requireStaff: RequestHandler = (req, _res, next) => {
  if (currentUser(req).role !== Role.STAFF) throw forbidden('Only staff can do that.');
  next();
};

/** Reads the user set by `requireAuth`; throws if the route forgot to require it. */
export function currentUser(req: { user?: AuthUser }): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
