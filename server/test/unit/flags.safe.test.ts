import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { evaluateFlag, toFlag, type Flag } from '../../src/services/flags.service';

const STORE = randomUUID();
const OTHER_STORE = randomUUID();
const flag = (rules: Flag['rules'], enabled = true): Flag => ({ key: 'test_flag', enabled, rules });

describe('evaluateFlag', () => {
  it('is off when disabled, whatever the rules', () => {
    expect(
      evaluateFlag(flag({}, false), { userId: randomUUID(), role: 'ADMIN', storeId: STORE }),
    ).toBe(false);
  });

  it('is on for everyone when enabled with no rules, signed out included', () => {
    expect(evaluateFlag(flag({}), {})).toBe(true);
  });

  it('storeIds: on for a listed store only', () => {
    const f = flag({ storeIds: [STORE] });
    expect(evaluateFlag(f, { storeId: STORE })).toBe(true);
    expect(evaluateFlag(f, { storeId: OTHER_STORE })).toBe(false);
    expect(evaluateFlag(f, {})).toBe(false);
  });

  it('roles: on for a listed role only', () => {
    const f = flag({ roles: ['STAFF'] });
    expect(evaluateFlag(f, { role: 'STAFF' })).toBe(true);
    expect(evaluateFlag(f, { role: 'CUSTOMER' })).toBe(false);
    expect(evaluateFlag(f, {})).toBe(false);
  });

  it('percent: 0 is nobody, 100 is every signed-in user, no user is never in it', () => {
    const userId = randomUUID();
    expect(evaluateFlag(flag({ percent: 0 }), { userId })).toBe(false);
    expect(evaluateFlag(flag({ percent: 100 }), { userId })).toBe(true);
    expect(evaluateFlag(flag({ percent: 100 }), {})).toBe(false);
  });

  it('combined: every rule must pass', () => {
    const f = flag({ storeIds: [STORE], roles: ['CUSTOMER'], percent: 100 });
    const userId = randomUUID();
    expect(evaluateFlag(f, { userId, role: 'CUSTOMER', storeId: STORE })).toBe(true);
    expect(evaluateFlag(f, { userId, role: 'STAFF', storeId: STORE })).toBe(false);
    expect(evaluateFlag(f, { userId, role: 'CUSTOMER', storeId: OTHER_STORE })).toBe(false);
    expect(evaluateFlag(f, { role: 'CUSTOMER', storeId: STORE })).toBe(false);
  });

  it('percent is stable per user and lands within ±3% of its target over 10 000 users', () => {
    const f = flag({ percent: 30 });
    const users = Array.from({ length: 10_000 }, () => randomUUID());
    const first = users.map((userId) => evaluateFlag(f, { userId }));
    expect(users.map((userId) => evaluateFlag(f, { userId }))).toEqual(first);
    const share = first.filter(Boolean).length / users.length;
    expect(share).toBeGreaterThanOrEqual(0.27);
    expect(share).toBeLessThanOrEqual(0.33);
  });

  it('percent buckets differ between flags, so one flag at 10% is not the same 10% as another', () => {
    const users = Array.from({ length: 1000 }, () => randomUUID());
    const a = users.map((userId) =>
      evaluateFlag({ ...flag({ percent: 50 }), key: 'flag_a' }, { userId }),
    );
    const b = users.map((userId) =>
      evaluateFlag({ ...flag({ percent: 50 }), key: 'flag_b' }, { userId }),
    );
    expect(a).not.toEqual(b);
  });
});

describe('toFlag', () => {
  it.each([
    ['a misspelt key', { storeId: [STORE] }],
    ['a percent over 100', { percent: 150 }],
    ['an unknown role', { roles: ['OWNER'] }],
    ['a store id that is not a uuid', { storeIds: ['main'] }],
    ['an empty list', { roles: [] }],
    ['not an object', 'everyone'],
  ])('a malformed rule (%s) is off', (_label, rules) => {
    const parsed = toFlag({ key: 'test_flag', enabled: true, rules });
    expect(evaluateFlag(parsed, { userId: randomUUID(), role: 'CUSTOMER', storeId: STORE })).toBe(
      false,
    );
  });

  it('a well-formed rule keeps the flag as stored', () => {
    expect(toFlag({ key: 'test_flag', enabled: true, rules: { roles: ['STAFF'] } })).toEqual(
      flag({ roles: ['STAFF'] }),
    );
  });
});
