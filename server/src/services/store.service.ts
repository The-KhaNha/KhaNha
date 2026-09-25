import type { Store } from '@prisma/client';
import { notFound } from '../utils/errors';
import { prisma } from '../utils/prisma';

/** V0 has exactly one store, created by `npm run seed`. */
export async function getStore(): Promise<Store> {
  const store = await prisma.store.findFirst();
  if (!store) throw notFound('The store has not been set up yet. Run `npm run seed` in server/.');
  return store;
}
