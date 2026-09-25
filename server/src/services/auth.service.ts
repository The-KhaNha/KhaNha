import type { User } from '@prisma/client';
import type { LoginInput, RegisterInput } from '../schemas/auth.schema';
import type { AuthResponse } from '../types/api';
import { AppError, notFound } from '../utils/errors';
import { signToken } from '../utils/jwt';
import { hashPassword, verifyPassword } from '../utils/password';
import { prisma } from '../utils/prisma';
import { toUserDto } from '../utils/serializers';

export async function register(input: RegisterInput): Promise<AuthResponse> {
  const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) {
    throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists. Try signing in.');
  }

  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      phone: input.phone ?? null,
      passwordHash: await hashPassword(input.password),
    },
  });
  return toAuthResponse(user);
}

export async function login(input: LoginInput): Promise<AuthResponse> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  // Same error for unknown email and wrong password so accounts cannot be enumerated.
  if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
  }
  return toAuthResponse(user);
}

export async function getUserById(id: string): Promise<User> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw notFound('Account not found.');
  return user;
}

function toAuthResponse(user: User): AuthResponse {
  return { user: toUserDto(user), token: signToken({ sub: user.id, role: user.role }) };
}
