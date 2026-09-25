import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { z } from 'zod';
import { env } from './env';
import { unauthorized } from './errors';

const TOKEN_TTL = '7d';

const tokenPayloadSchema = z.object({
  sub: z.string().min(1),
  role: z.nativeEnum(Role),
});

export type TokenPayload = z.infer<typeof tokenPayloadSchema>;

export function signToken(payload: TokenPayload): string {
  return jwt.sign({ role: payload.role }, env.JWT_SECRET, {
    subject: payload.sub,
    expiresIn: TOKEN_TTL,
  });
}

/** Verifies the signature and expiry, then checks the payload has the shape we issued. */
export function verifyToken(token: string): TokenPayload {
  try {
    return tokenPayloadSchema.parse(jwt.verify(token, env.JWT_SECRET));
  } catch {
    throw unauthorized('Your session has expired or is invalid. Please sign in again.');
  }
}
