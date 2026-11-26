// Local only: every store route × every standing (docs/PERMISSIONS.md). The route list is read from
// src/routes/store.routes.ts, so a route added without its row here fails; the capability each route should check is a
// literal below, so a route wired to the wrong capability fails too. can()'s own cells are permissions.safe.test.ts.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { can, type Capability, type StoreAccess } from '../../src/domain/permissions';
import { MEDIA_FILE_ROUTE } from '../../src/routes/store.routes';
import { invalidate } from '../../src/utils/cache';
import { supabaseAdmin } from '../../src/utils/supabase';
import { api } from '../setup/api';
import {
  createBrandOwner,
  createStoreMember,
  createTestUser,
  deleteTestStores,
  type TestUser,
} from '../setup/helpers';

const EXPECTED: Record<string, Capability> = {
  'GET /:storeId/orders': 'orders.view',
  'PATCH /:storeId/orders/:orderId/status': 'orders.transition',
  'GET /:storeId/settings': 'settings.edit',
  'PATCH /:storeId/settings': 'settings.edit',
  'PUT /:storeId/hours': 'hours.edit',
  'POST /:storeId/schedule-exceptions': 'hours.edit',
  'DELETE /:storeId/schedule-exceptions/:exceptionId': 'hours.edit',
  'GET /:storeId/audit': 'audit.store',
  'GET /:storeId/members': 'team.manageStaff',
  'POST /:storeId/invites': 'team.manageStaff',
  'DELETE /:storeId/invites/:inviteId': 'team.manageStaff',
  'DELETE /:storeId/members/:membershipId': 'team.manageStaff',
  'DELETE /:storeId/membership': 'team.leave',
  'POST /:storeId/pause': 'store.pause',
  'POST /:storeId/resume': 'store.pause',
  'GET /:storeId/menu-items': 'menu.edit',
  'POST /:storeId/menu-items': 'menu.edit',
  'POST /:storeId/menu-items/bulk': 'menu.edit',
  'PUT /:storeId/menu-items/order': 'menu.edit',
  'PATCH /:storeId/menu-items/:itemId': 'menu.edit',
  'DELETE /:storeId/menu-items/:itemId': 'menu.edit',
  'GET /:storeId/modifier-groups': 'menu.edit',
  'POST /:storeId/modifier-groups': 'menu.edit',
  'PATCH /:storeId/modifier-groups/:groupId': 'menu.edit',
  'DELETE /:storeId/modifier-groups/:groupId': 'menu.edit',
  'PUT /:storeId/menu-items/:itemId/modifier-groups': 'menu.edit',
  'PATCH /:storeId/menu-items/:itemId/stock': 'stock.update',
  'GET /:storeId/stock': 'stock.update',
  'GET /:storeId/stock-movements': 'stock.update',
  'GET /:storeId/manage': 'store.profile',
  'GET /:storeId/manage/hours': 'hours.edit',
  'PATCH /:storeId/profile': 'store.profile',
  'POST /:storeId/publish': 'store.publish',
  'POST /:storeId/unpublish': 'store.publish',
  'POST /:storeId/media/uploads': 'menu.edit',
  'PUT /:storeId/media/uploads/:uploadId/file': 'menu.edit',
  'POST /:storeId/media/uploads/:uploadId/complete': 'menu.edit',
  'GET /:storeId/media/uploads/:uploadId': 'menu.edit',
};

interface Route {
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  path: string;
  capability: string | undefined;
}
/** Every `storesRouter.<verb>('<path>', …)` with the capability its `requireStore(…)` names. */
function storeRoutes(): Route[] {
  const source = readFileSync(join(__dirname, '../../src/routes/store.routes.ts'), 'utf8');
  return [
    ...source.matchAll(
      /storesRouter\.(get|post|patch|put|delete)\(\s*(?:'([^']+)'|(MEDIA_FILE_ROUTE)),([^;]*?)\);/gs,
    ),
  ].map(([, method, path, constant, rest]) => ({
    method: method as Route['method'],
    // The upload route is registered by constant (app.ts matches the same one); read its value, not a copy.
    path: constant ? MEDIA_FILE_ROUTE : (path ?? ''),
    capability: rest?.match(/requireStore\('([^']+)'\)/)?.[1],
  }));
}
const key = (r: Route) => `${r.method.toUpperCase()} ${r.path}`;
const STORE_ROUTES = storeRoutes().filter((r) => r.path.startsWith('/:storeId'));

describe('the store routes and the capability each checks', () => {
  it('every route under /:storeId checks a capability, and it is the one this table expects', () => {
    expect(Object.fromEntries(STORE_ROUTES.map((r) => [key(r), r.capability]))).toEqual(EXPECTED);
  });
});

const STANDINGS = ['OWNER', 'MANAGER', 'STAFF', 'ADMIN', 'CUSTOMER', 'ANONYMOUS'] as const;
type Standing = (typeof STANDINGS)[number];
const tag = randomUUID().slice(0, 8);
let brandId = '';
let storeId = '';
const users = {} as Record<Exclude<Standing, 'ANONYMOUS'>, TestUser>;

beforeAll(async () => {
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .insert({ name: 'Roles', slug: `roles-${tag}`, status: 'ACTIVE' })
    .select('id')
    .single()
    .throwOnError();
  brandId = brand.id;
  const { data: store } = await supabaseAdmin
    .from('stores')
    .insert({
      name: 'Roles',
      slug: `store-roles-${tag}`,
      brand_id: brandId,
      status: 'ACTIVE',
      tagline: 'Test',
      description: 'store-route-roles.test.ts',
    })
    .select('id')
    .single()
    .throwOnError();
  storeId = store.id;
  [users.OWNER, users.MANAGER, users.STAFF, users.ADMIN, users.CUSTOMER] = await Promise.all([
    createBrandOwner(brandId),
    createStoreMember(storeId, 'MANAGER'),
    createStoreMember(storeId, 'STAFF'),
    createTestUser('ADMIN'),
    createTestUser(),
  ]);
}, 60_000);

afterAll(() => deleteTestStores([storeId], [brandId], Object.values(users)));

function send(route: Route, who: Standing) {
  const path = route.path.replace(':storeId', storeId).replace(/:[a-zA-Z]+/g, () => randomUUID());
  const req = api()[route.method](`/api/stores${path}`);
  if (who !== 'ANONYMOUS') req.set('Authorization', `Bearer ${users[who].token}`);
  return route.method === 'get' || route.method === 'delete' ? req : req.send({});
}

type StoreStatus = 'ACTIVE' | 'SUSPENDED';
let storeStatus: StoreStatus = 'ACTIVE';
async function setStoreStatus(status: StoreStatus): Promise<void> {
  storeStatus = status;
  await supabaseAdmin.from('stores').update({ status }).eq('id', storeId).throwOnError();
  invalidate();
}

/**
 * What a standing gets: 401 without a token, 404 at a store it may not see (not ACTIVE and no standing there),
 * 403 FORBIDDEN without the capability, else past the gate.
 */
function expected(who: Standing, capability: Capability, staffCanEditStock: boolean) {
  if (who === 'ANONYMOUS') return 'UNAUTHORIZED';
  const access: StoreAccess | null = who === 'CUSTOMER' ? null : who;
  if (access === null && storeStatus !== 'ACTIVE') return 'NOT_FOUND';
  return can(access, capability, { staffCanEditStock }) ? 'THROUGH' : 'FORBIDDEN';
}
async function outcome(route: Route, who: Standing) {
  const res = await send(route, who);
  // Unpublishing really happens for the owner; put the store back so the next standings see what this run expects.
  if (route.path.endsWith('/unpublish') && res.status === 200) await setStoreStatus(storeStatus);
  // Leaving really happens too: give the member their place back for the routes after this one.
  if (
    route.path.endsWith('/membership') &&
    res.status === 204 &&
    (who === 'STAFF' || who === 'MANAGER')
  )
    await supabaseAdmin
      .from('store_memberships')
      .insert({ store_id: storeId, user_id: users[who].id, role: who })
      .throwOnError();
  if (res.status >= 500) return `5xx ${res.status}`;
  if (res.status === 401)
    return res.body.error?.code === 'UNAUTHORIZED' ? 'UNAUTHORIZED' : 'bad 401';
  if (res.status === 403) return res.body.error?.code === 'FORBIDDEN' ? 'FORBIDDEN' : 'bad 403';
  // The store gate's own 404, not the app's "No route matches": that one would mean the route is gone.
  if (res.status === 404 && res.body.error?.message === 'Store not found.') return 'NOT_FOUND';
  // Past the gate, validation and resource answers (400, 404, 413, 415, 2xx) are fine; these two are not.
  if (res.status === 404 && String(res.body.error?.message).startsWith('No route matches'))
    return 'catch-all 404';
  if (res.status === 429) return '429';
  return 'THROUGH';
}

const routeCases = STORE_ROUTES.map((r) => [key(r), r] as const);
async function checkRoute(route: Route): Promise<void> {
  const capability = EXPECTED[key(route)];
  if (!capability) throw new Error(`no row for ${key(route)}`);
  // One standing at a time: unpublish changes the store the next one sees.
  const got: Record<string, string> = {};
  for (const who of STANDINGS) got[who] = await outcome(route, who);
  expect(got).toEqual(
    Object.fromEntries(STANDINGS.map((who) => [who, expected(who, capability, true)])),
  );
}

// Kept on purpose (decided 2026-11-23): at a suspended store its people keep every power they had; only those with
// no standing there lose sight of it.
describe('every store route × every standing, at a SUSPENDED store', () => {
  beforeAll(() => setStoreStatus('SUSPENDED'));
  afterAll(() => setStoreStatus('ACTIVE'));
  it.each(routeCases)('%s', (_key, route) => checkRoute(route));
});

describe('every store route × every standing', () => {
  it.each(routeCases)('%s', (_key, route) => checkRoute(route));

  it('staff lose the stock routes when the store stops letting them edit stock', async () => {
    await supabaseAdmin
      .from('stores')
      .update({ staff_can_edit_stock: false })
      .eq('id', storeId)
      .throwOnError();
    invalidate();
    try {
      const stock = STORE_ROUTES.filter((r) => EXPECTED[key(r)] === 'stock.update');
      expect(stock).toHaveLength(3);
      for (const route of stock) expect(await outcome(route, 'STAFF')).toBe('FORBIDDEN');
      expect(await outcome(stock[0] as Route, 'MANAGER')).toBe('THROUGH');
    } finally {
      await supabaseAdmin
        .from('stores')
        .update({ staff_can_edit_stock: true })
        .eq('id', storeId)
        .throwOnError();
      invalidate();
    }
  });
});
