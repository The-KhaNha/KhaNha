import { describe, expect, expectTypeOf, it } from 'vitest';
import { accessFor, can, type Capability, type StoreAccess } from '../../src/domain/permissions';

// The P2 matrix (plans/P2_MULTI_STORE.md "Capabilities in P2"), written out cell by cell so a changed map fails here.
const EXPECTED: Record<Capability, Record<StoreAccess, boolean>> = {
  'orders.view': { STAFF: true, MANAGER: true, OWNER: true, ADMIN: false },
  'orders.transition': { STAFF: true, MANAGER: true, OWNER: true, ADMIN: false },
  'store.pause': { STAFF: true, MANAGER: true, OWNER: true, ADMIN: true },
  'hours.edit': { STAFF: false, MANAGER: true, OWNER: true, ADMIN: false },
  'settings.edit': { STAFF: false, MANAGER: true, OWNER: true, ADMIN: false },
  'team.manageStaff': { STAFF: false, MANAGER: true, OWNER: true, ADMIN: true },
  'team.manageManagers': { STAFF: false, MANAGER: false, OWNER: true, ADMIN: true },
  'audit.store': { STAFF: false, MANAGER: true, OWNER: true, ADMIN: true },
};

describe('can', () => {
  for (const [capability, row] of Object.entries(EXPECTED) as [
    Capability,
    Record<StoreAccess, boolean>,
  ][]) {
    for (const [access, allowed] of Object.entries(row) as [StoreAccess, boolean][]) {
      it(`${access} ${allowed ? 'may' : 'may not'} ${capability}`, () => {
        expect(can(access, capability)).toBe(allowed);
      });
    }
    it(`no access may not ${capability}`, () => {
      expect(can(null, capability)).toBe(false);
    });
  }

  // EXPECTED is a Record<Capability, …>, so a capability missing from it, or one the map lacks, fails to compile.
  it('an unknown capability does not compile', () => {
    expectTypeOf<'orders.delete'>().not.toMatchTypeOf<Capability>();
  });
});

describe('accessFor', () => {
  const store = { id: 'store-a', brandId: 'brand-a' };
  const user = (over: Partial<Parameters<typeof accessFor>[0]> = {}) => ({
    role: 'CUSTOMER' as const,
    memberships: [],
    ownedBrandIds: [],
    ...over,
  });

  it('the brand owner is OWNER, above any membership', () => {
    const owner = user({
      ownedBrandIds: ['brand-a'],
      memberships: [{ storeId: 'store-a', role: 'STAFF' }],
    });
    expect(accessFor(owner, store, 'orders.view')).toBe('OWNER');
  });

  it("a member has the membership's role at that store only", () => {
    const manager = user({ memberships: [{ storeId: 'store-a', role: 'MANAGER' }] });
    expect(accessFor(manager, store, 'hours.edit')).toBe('MANAGER');
    // Lacking the capability still reports the standing, so requireStore answers 403 rather than 404.
    expect(accessFor(manager, store, 'team.manageManagers')).toBe('MANAGER');
    expect(accessFor(manager, { id: 'store-b', brandId: 'brand-a' }, 'orders.view')).toBeNull();
  });

  it('the owner of another brand has no access', () => {
    expect(accessFor(user({ ownedBrandIds: ['brand-b'] }), store, 'orders.view')).toBeNull();
  });

  it('an admin who also works the store keeps both powers', () => {
    const admin = user({ role: 'ADMIN', memberships: [{ storeId: 'store-a', role: 'STAFF' }] });
    expect(accessFor(admin, store, 'orders.view')).toBe('STAFF');
    expect(accessFor(admin, store, 'team.manageManagers')).toBe('ADMIN');
    expect(accessFor(user({ role: 'ADMIN' }), store, 'store.pause')).toBe('ADMIN');
  });

  it('a STAFF profile with no membership has no access: the profile role grants nothing at a store', () => {
    expect(accessFor(user({ role: 'STAFF' }), store, 'orders.view')).toBeNull();
  });
});
