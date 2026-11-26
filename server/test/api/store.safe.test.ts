import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api } from '../setup/api';
import { createTestUser, deleteTestUser, type TestUser } from '../setup/helpers';

// The single-store contract is gone (P2 PR 16); these must not come back by accident. The store's DTO keys are
// pinned in stores-read.test.ts and the menu's in menu.safe.test.ts.
let customer: TestUser;
beforeAll(async () => {
  customer = await createTestUser();
});
afterAll(() => deleteTestUser(customer));

describe('removed single-store routes', () => {
  it.each([
    ['get', '/api/store'],
    ['get', '/api/menu'],
    ['patch', `/api/orders/${randomUUID()}/status`],
  ] as const)('%s %s answers 404', async (method, path) => {
    const res = await api()
      [method](path)
      .set('Authorization', `Bearer ${customer.token}`)
      .set('X-Client-Version', '9.0.0');
    // The catch-all's own message: these routes must stay unmounted, not merely refuse something.
    expect(res).toMatchObject({
      status: 404,
      body: {
        error: { code: 'NOT_FOUND', message: `No route matches ${method.toUpperCase()} ${path}.` },
      },
    });
  });
});
