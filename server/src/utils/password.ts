import { compare, hash } from 'bcryptjs';

const BCRYPT_COST = 10;

export const hashPassword = (plain: string): Promise<string> => hash(plain, BCRYPT_COST);

export const verifyPassword = (plain: string, passwordHash: string): Promise<boolean> =>
  compare(plain, passwordHash);
