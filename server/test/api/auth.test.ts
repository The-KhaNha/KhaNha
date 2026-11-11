import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { supabaseAdmin } from '../../src/utils/supabase';
import {
  createStoreMember,
  createTestUser,
  deleteAccountByEmail,
  deleteTestUser,
  testAuthMatrix,
  type TestUser,
} from '../setup/helpers';
import { api } from '../setup/api';

interface RegisterBody {
  name?: unknown;
  email?: unknown;
  password?: unknown;
  phone?: unknown;
}

function payload(overrides: RegisterBody = {}): RegisterBody {
  return {
    name: 'Boundary Tester',
    email: `test-${randomUUID()}@example.test`,
    password: 'validpw1',
    phone: '9876543210',
    ...overrides,
  };
}

// Emails of accounts this file actually created with 201, cleaned up in afterAll.
const createdEmails: string[] = [];

async function register(body: RegisterBody) {
  const res = await api().post('/api/auth/register').send(body);
  if (res.status === 201) createdEmails.push((res.body.user as { email: string }).email);
  return res;
}

afterAll(async () => {
  await Promise.all(createdEmails.map((email) => deleteAccountByEmail(email)));
});

describe('POST /api/auth/register', () => {
  it('creates a CUSTOMER profile and returns { user: UserDto }', async () => {
    const email = `test-${randomUUID()}@example.test`;
    const res = await register(payload({ email }));
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({
      email,
      role: 'CUSTOMER',
      memberships: [],
      ownedBrands: [],
    });
    expect(Object.keys(res.body.user).sort()).toEqual(
      ['id', 'name', 'email', 'phone', 'role', 'createdAt', 'memberships', 'ownedBrands'].sort(),
    );
  });

  describe('name bounds', () => {
    it.each([
      ['1 char', 1, false],
      ['2 chars (min)', 2, true],
      ['60 chars (max)', 60, true],
      ['61 chars', 61, false],
    ])('%s -> %s', async (_label, length, ok) => {
      const res = await register(payload({ name: 'a'.repeat(length as number) }));
      expect(res.status).toBe(ok ? 201 : 400);
      if (!ok) expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('trims before counting: name with surrounding whitespace at the 60-char boundary passes', async () => {
      const res = await register(payload({ name: `  ${'a'.repeat(60)}  ` }));
      expect(res.status).toBe(201);
    });
  });

  describe('password bounds', () => {
    it.each([
      ['5 chars', 5, false],
      ['6 chars (min)', 6, true],
      ['72 chars (max)', 72, true],
      ['73 chars', 73, false],
    ])('%s -> %s', async (_label, length, ok) => {
      const res = await register(payload({ password: 'a'.repeat(length as number) }));
      expect(res.status).toBe(ok ? 201 : 400);
      if (!ok) expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('phone', () => {
    it('a blank phone becomes undefined and passes', async () => {
      const res = await register(payload({ phone: '' }));
      expect(res.status).toBe(201);
      expect(res.body.user.phone).toBeNull();
    });

    it('normalises spaces before storing', async () => {
      const res = await register(payload({ phone: '98765 43210' }));
      expect(res.status).toBe(201);
      expect(res.body.user.phone).toBe('9876543210');
    });

    it.each([
      ['9 digits', '987654321'],
      ['16 digits', '9876543210123456'],
      ['letters', 'abcdefghij'],
    ])('%s is rejected', async (_label, phone) => {
      const res = await register(payload({ phone }));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  it('rejects an invalid email', async () => {
    const res = await register(payload({ email: 'not-an-email' }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('lowercases a mixed-case email before storing', async () => {
    const email = `Test-${randomUUID()}@Example.TEST`;
    const res = await register(payload({ email }));
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(email.toLowerCase());
  });

  it('strips a NUL byte from name instead of rejecting the request', async () => {
    const res = await register(payload({ name: 'A\u0000nn' }));
    expect(res.status).toBe(201);
    expect(res.body.user.name).toBe('Ann');
  });

  it('rejects wrong types outright (name: 123, phone: {})', async () => {
    const res1 = await register(payload({ name: 123 }));
    expect(res1.status).toBe(400);
    expect(res1.body.error.code).toBe('VALIDATION_ERROR');
    const res2 = await register(payload({ phone: {} }));
    expect(res2.status).toBe(400);
  });

  it('rejects an empty body', async () => {
    const res = await api().post('/api/auth/register').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects malformed JSON', async () => {
    const res = await api()
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .send('{bad');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('413 PAYLOAD_TOO_LARGE for a body over the express.json() 100 kB default', async () => {
    const res = await api()
      .post('/api/auth/register')
      .send(payload({ name: 'a'.repeat(150_000) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  describe('EMAIL_TAKEN', () => {
    it('409 on a second register with the same email', async () => {
      const email = `test-${randomUUID()}@example.test`;
      const first = await register(payload({ email }));
      expect(first.status).toBe(201);
      const second = await register(payload({ email }));
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('EMAIL_TAKEN');
      // The form shows it on the email field, not in a banner.
      expect(second.body.error.details).toEqual({ field: 'email' });
    });

    it('409 with the same email in a different letter case', async () => {
      const email = `test-${randomUUID()}@example.test`;
      const first = await register(payload({ email }));
      expect(first.status).toBe(201);
      const second = await register(payload({ email: email.toUpperCase() }));
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('EMAIL_TAKEN');
    });
  });

  it('every error body matches the envelope shape, with no stack trace or SQL text', async () => {
    const res = await register(payload({ name: '' }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: expect.any(String), details: { field: 'name' } },
    });
    expect(JSON.stringify(res.body)).not.toMatch(
      /\bat .*\.(ts|js)|stack|PGRST|SQLSTATE|select |insert |update /i,
    );
  });
});

describe('GET /api/auth/me', () => {
  testAuthMatrix('GET /api/auth/me', (http) => http.get('/api/auth/me'));

  it('returns the caller’s own profile with exactly the UserDto keys', async () => {
    let user: TestUser | undefined;
    try {
      user = await createTestUser();
      const res = await api().get('/api/auth/me').set('Authorization', `Bearer ${user.token}`);
      expect(res.status).toBe(200);
      expect(res.body.user.id).toBe(user.id);
      expect(Object.keys(res.body.user).sort()).toEqual(
        ['id', 'name', 'email', 'phone', 'role', 'createdAt', 'memberships', 'ownedBrands'].sort(),
      );
    } finally {
      await deleteTestUser(user);
    }
  });

  it('lists the stores the caller works at and the brands they own', async () => {
    const slug = `me-test-${randomUUID().slice(0, 8)}`;
    const { data: brand } = await supabaseAdmin
      .from('brands')
      .insert({ name: 'Me Test', slug })
      .select('id')
      .single()
      .throwOnError();
    const { data: store } = await supabaseAdmin
      .from('stores')
      .insert({
        name: 'Me Test Store',
        slug,
        brand_id: brand.id,
        tagline: 'Test',
        description: 'Test',
      })
      .select('id')
      .single()
      .throwOnError();
    let user: TestUser | undefined;
    try {
      user = await createStoreMember(store.id, 'MANAGER');
      await supabaseAdmin
        .from('brands')
        .update({ owner_id: user.id })
        .eq('id', brand.id)
        .throwOnError();
      const res = await api().get('/api/auth/me').set('Authorization', `Bearer ${user.token}`);
      expect(res.status).toBe(200);
      expect(res.body.user.memberships).toEqual([
        { storeId: store.id, storeSlug: slug, storeName: 'Me Test Store', role: 'MANAGER' },
      ]);
      expect(res.body.user.ownedBrands).toEqual([{ id: brand.id, name: 'Me Test', slug }]);
    } finally {
      await deleteTestUser(user);
      await supabaseAdmin.from('stores').delete().eq('id', store.id);
      await supabaseAdmin.from('brands').delete().eq('id', brand.id);
    }
  });
});
