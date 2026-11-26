import { describe, expect, it } from 'vitest';
import type { ManagedStore, MyBrand, StoreSummary, User } from '../../types/api';
import {
  canEditHours,
  canEditMenu,
  canEditSettings,
  canManage,
  canManageManagers,
  canPublish,
  canRemoveMember,
  ownStoreId,
  ownedBranch,
  pickerEntries,
} from './manageRules';

const store = (slug: string, isTemplate = false): ManagedStore => ({
  id: `id-${slug}`,
  slug,
  name: slug,
  status: 'ACTIVE',
  isTemplate,
  area: null,
  address: null,
  contactPhone: null,
  tagline: '',
  description: '',
  imageUrl: null,
  createdAt: '2026-01-01T00:00:00Z',
});
const brand = (stores: ManagedStore[], template: ManagedStore | null = null): MyBrand => ({
  id: 'b1',
  name: 'B',
  slug: 'b',
  template,
  stores,
});

describe('ownedBranch', () => {
  it('finds a branch by slug across brands', () => {
    const brands = [brand([store('a')]), brand([store('b'), store('c')])];
    expect(ownedBranch(brands, 'c')?.id).toBe('id-c');
  });

  it('never returns the template, even by its own slug', () => {
    expect(ownedBranch([brand([store('a')], store('tpl', true))], 'tpl')).toBeNull();
  });

  it('never returns a template even when it is listed among the stores (a template has no board)', () => {
    expect(ownedBranch([brand([store('t', true), store('a')])], 't')).toBeNull();
  });

  it('is null for an unknown slug, no brands, or not loaded', () => {
    expect(ownedBranch([brand([store('a')])], 'zzz')).toBeNull();
    expect(ownedBranch([], 'a')).toBeNull();
    expect(ownedBranch(null, 'a')).toBeNull();
    expect(ownedBranch(undefined, 'a')).toBeNull();
  });
});

const here = { id: 's1', brand: { id: 'b1' } } as Pick<StoreSummary, 'id' | 'brand'>;
const person = (over: Partial<User> = {}): User => ({
  id: 'u1',
  name: 'P',
  email: 'p@example.com',
  phone: null,
  role: 'CUSTOMER',
  createdAt: '2026-01-01T00:00:00Z',
  memberships: [],
  ownedBrands: [],
  ...over,
});
const member = (role: 'MANAGER' | 'STAFF', storeId = 's1', storeSlug = 'north') => ({
  storeId,
  storeSlug,
  storeName: 'North',
  role,
});

const ACTORS = {
  OWNER: person({ ownedBrands: [{ id: 'b1', name: 'B', slug: 'b' }] }),
  MANAGER: person({ memberships: [member('MANAGER')] }),
  STAFF: person({ memberships: [member('STAFF')] }),
  ADMIN: person({ role: 'ADMIN' }),
  CUSTOMER: person(),
} as const;
type Actor = keyof typeof ACTORS;

// Each client rule mirrors one capability of MATRIX in server/src/domain/permissions.ts. The expected table below must
// agree with that MATRIX (OWNER, MANAGER, STAFF, ADMIN per capability); change both together.
//   audit.store: MANAGER OWNER ADMIN          hours.edit / settings.edit / menu.edit: MANAGER OWNER
//   team.manageManagers, store.publish: OWNER
const CAN: [string, (u: User) => boolean, Record<Actor, boolean>][] = [
  [
    'canManage (audit.store)',
    (u) => canManage(u, here),
    { OWNER: true, MANAGER: true, STAFF: false, ADMIN: true, CUSTOMER: false },
  ],
  [
    'canEditHours (hours.edit)',
    (u) => canEditHours(u, here),
    { OWNER: true, MANAGER: true, STAFF: false, ADMIN: false, CUSTOMER: false },
  ],
  [
    'canEditSettings (settings.edit)',
    (u) => canEditSettings(u, here),
    { OWNER: true, MANAGER: true, STAFF: false, ADMIN: false, CUSTOMER: false },
  ],
  [
    'canEditMenu (menu.edit)',
    (u) => canEditMenu(u, here),
    { OWNER: true, MANAGER: true, STAFF: false, ADMIN: false, CUSTOMER: false },
  ],
  [
    'canManageManagers (team.manageManagers)',
    (u) => canManageManagers(u, here),
    { OWNER: true, MANAGER: false, STAFF: false, ADMIN: false, CUSTOMER: false },
  ],
  [
    'canPublish (store.publish)',
    (u) => canPublish(u, 'b1'),
    { OWNER: true, MANAGER: false, STAFF: false, ADMIN: false, CUSTOMER: false },
  ],
];

describe('manage capabilities per actor (server MATRIX parity)', () => {
  it.each(CAN)('%s', (_, check, expected) => {
    for (const actor of Object.keys(ACTORS) as Actor[])
      expect(check(ACTORS[actor]), actor).toBe(expected[actor]);
  });

  it('a membership or brand at another store or brand grants nothing here', () => {
    const elsewhere = person({
      memberships: [member('MANAGER', 's2')],
      ownedBrands: [{ id: 'b2', name: 'Other', slug: 'o' }],
    });
    for (const [, check] of CAN) expect(check(elsewhere)).toBe(false);
  });

  it('canRemoveMember: STAFF by anyone, oneself, a manager only by the owner', () => {
    const peer = { role: 'MANAGER', userId: 'u9' } as const;
    expect(canRemoveMember(ACTORS.MANAGER, here, { role: 'STAFF', userId: 'u9' })).toBe(true);
    expect(canRemoveMember(ACTORS.MANAGER, here, { role: 'MANAGER', userId: 'u1' })).toBe(true);
    expect(canRemoveMember(ACTORS.MANAGER, here, peer)).toBe(false);
    expect(canRemoveMember(ACTORS.OWNER, here, peer)).toBe(true);
  });
});

const summary = (id: string, name = id): StoreSummary =>
  ({ id, slug: `${id}-slug`, name }) as StoreSummary;

describe('pickerEntries', () => {
  it('lists a template first, then each branch with its status note', () => {
    const rows = pickerEntries(
      ACTORS.OWNER,
      [
        {
          ...brand(
            [
              { ...store('a'), status: 'DRAFT' },
              { ...store('b'), status: 'ACTIVE' },
              { ...store('c'), status: 'SUSPENDED' },
              { ...store('d'), status: 'ARCHIVED' },
            ],
            store('tpl', true),
          ),
          name: 'Brand',
        },
      ],
      null,
    );
    expect(rows).toEqual([
      { id: 'id-tpl', slug: 'tpl', name: 'Brand', note: 'Brand template' },
      { id: 'id-a', slug: 'a', name: 'a', note: 'Draft: not public yet' },
      { id: 'id-b', slug: 'b', name: 'b', note: null },
      { id: 'id-c', slug: 'c', name: 'c', note: 'Suspended' },
      { id: 'id-d', slug: 'd', name: 'd', note: 'Closed' },
    ]);
  });

  it('a brand without a template starts with its first branch', () => {
    expect(pickerEntries(ACTORS.OWNER, [brand([store('a')])], null).map((r) => r.id)).toEqual([
      'id-a',
    ]);
  });

  it('adds the stores the account manages, once even when the brand lists them too', () => {
    const user = person({
      memberships: [member('MANAGER', 'id-a', 'a'), member('STAFF', 'x', 'x')],
    });
    const rows = pickerEntries(user, [brand([store('a')])], null);
    expect(rows).toEqual([{ id: 'id-a', slug: 'a', name: 'a', note: null }]);
    const alone = pickerEntries(user, null, null);
    expect(alone).toEqual([{ id: 'id-a', slug: 'a', name: 'North', note: null }]);
  });

  it('an admin also gets the public stores, each once; anyone else does not', () => {
    const publicStores = [summary('p1', 'P1'), summary('p2', 'P2')];
    expect(pickerEntries(ACTORS.ADMIN, null, [...publicStores, publicStores[0]!])).toEqual([
      { id: 'p1', slug: 'p1-slug', name: 'P1', note: null },
      { id: 'p2', slug: 'p2-slug', name: 'P2', note: null },
    ]);
    expect(pickerEntries(ACTORS.CUSTOMER, null, publicStores)).toEqual([]);
    expect(pickerEntries(ACTORS.ADMIN, null, null)).toEqual([]);
  });
});

describe('ownStoreId', () => {
  const brands = [brand([store('a')], store('tpl', true)), { ...brand([store('z')]), id: 'b2' }];

  it('finds a managed store by slug, but not one the account is only STAFF at', () => {
    const user = person({
      memberships: [member('STAFF', 'sx', 'north'), member('MANAGER', 'sm', 'south')],
    });
    expect(ownStoreId(user, null, 'south')).toBe('sm');
    expect(ownStoreId(user, null, 'north')).toBeNull();
  });

  it('finds an owned branch or template across brands', () => {
    expect(ownStoreId(ACTORS.OWNER, brands, 'a')).toBe('id-a');
    expect(ownStoreId(ACTORS.OWNER, brands, 'tpl')).toBe('id-tpl');
    expect(ownStoreId(ACTORS.OWNER, brands, 'z')).toBe('id-z');
  });

  it('is null for a slug that is none of the account’s own', () => {
    expect(ownStoreId(ACTORS.OWNER, brands, 'nope')).toBeNull();
    expect(ownStoreId(ACTORS.CUSTOMER, null, 'a')).toBeNull();
  });
});
