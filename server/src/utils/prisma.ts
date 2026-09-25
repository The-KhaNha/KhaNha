import { PrismaClient } from '@prisma/client';
import { env } from './env';

/** The single Prisma client shared by the whole process. */
export const prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
