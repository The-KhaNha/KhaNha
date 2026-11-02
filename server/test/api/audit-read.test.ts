// Local only: writes audit rows (append-only, they stay) by changing a throwaway profile's role.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Role } from '../../src/types/enums';
import type { AuditEntryDto, AuditPageDto } from '../../src/types/api';
import { supabaseAdmin } from '../../src/utils/supabase';
import { AUDIT_ENTITY_TYPES } from '../../src/schemas/admin.schema';
import {
  createTestUser,
  deleteTestUser,
  localSql,
  testAuthMatrix,
  type TestUser,
} from '../setup/helpers';
import { api } from '../setup/api';

let admin: TestUser;
let staff: TestUser;
let customer: TestUser;
let subject: TestUser; // the profile whose role changes write the rows read below
const ROLE_CHANGES = 7; // three pages of three: 3 + 3 + 1

const bearer = (user: TestUser) => ({ Authorization: `Bearer ${user.token}` });

async function readAudit(query: Record<string, string | number>) {
  return api().get('/api/admin/audit').query(query).set(bearer(admin));
}

/** Every row of the subject's profile, newest first, read through the endpoint itself. */
async function subjectRows(): Promise<AuditEntryDto[]> {
  const res = await readAudit({ entityType: 'profile', entityId: subject.id, limit: 100 });
  expect(res.status).toBe(200);
  return (res.body as AuditPageDto).entries;
}

beforeAll(async () => {
  [admin, staff, customer, subject] = await Promise.all([
    createTestUser('ADMIN'),
    createTestUser('STAFF'),
    createTestUser('CUSTOMER'),
    createTestUser('CUSTOMER'),
  ]);
  // Named as the admin through the x-actor header, the way the API names its writes, so actorId has rows to find.
  const actor = JSON.stringify({ type: 'USER', id: admin.id, role: 'ADMIN' });
  for (let i = 0; i < ROLE_CHANGES; i++) {
    const role: Role = i % 2 === 0 ? 'STAFF' : 'CUSTOMER';
    await supabaseAdmin
      .from('profiles')
      .update({ role })
      .eq('id', subject.id)
      .setHeader('x-actor', actor)
      .setHeader('x-request-id', `audit-read-${i}`)
      .throwOnError();
  }
}, 30_000);

afterAll(async () => {
  await Promise.all([admin, staff, customer, subject].map((user) => deleteTestUser(user)));
});

testAuthMatrix('GET /api/admin/audit', (http) => http.get('/api/admin/audit'));

describe('GET /api/admin/audit: role', () => {
  it.each([
    ['a customer', () => customer],
    ['staff (a restaurant role, not a site admin)', () => staff],
  ])('403 FORBIDDEN for %s', async (_label, who) => {
    const res = await api().get('/api/admin/audit').set(bearer(who()));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('200 for an admin: newest first, at most the default 50, never stored by the browser', async () => {
    const res = await api().get('/api/admin/audit').set(bearer(admin));
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const { entries } = res.body as AuditPageDto;
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.length).toBeLessThanOrEqual(50);
    const ids = entries.map((entry) => entry.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
  });
});

describe('GET /api/admin/audit: filters', () => {
  it('entityType + entityId returns exactly that entity, as DTOs', async () => {
    const rows = await subjectRows();
    expect(rows).toHaveLength(ROLE_CHANGES);
    expect(rows[0]).toEqual({
      id: expect.any(Number),
      occurredAt: expect.stringMatching(/Z$/),
      actorType: 'USER',
      actorId: admin.id,
      actorRole: 'ADMIN',
      storeId: null,
      action: 'profile.role_changed',
      entityType: 'profile',
      entityId: subject.id,
      changes: { role: ['CUSTOMER', 'STAFF'] },
      reason: null,
      requestId: `audit-read-${ROLE_CHANGES - 1}`,
    });
  });

  it('entityType alone returns only that type', async () => {
    const res = await readAudit({ entityType: 'profile', limit: 100 });
    expect(res.status).toBe(200);
    const types = new Set((res.body as AuditPageDto).entries.map((entry) => entry.entityType));
    expect([...types]).toEqual(['profile']);
  });

  it('actorId returns only that actor', async () => {
    const res = await readAudit({ actorId: admin.id, limit: 100 });
    expect(res.status).toBe(200);
    const { entries } = res.body as AuditPageDto;
    expect(entries).toHaveLength(ROLE_CHANGES);
    expect(entries.every((entry) => entry.actorId === admin.id)).toBe(true);
  });

  it('from is inclusive and to is exclusive', async () => {
    const rows = await subjectRows();
    const pivot = rows[3];
    if (!pivot) throw new Error('expected the subject to have at least four audit rows');
    const query = { entityType: 'profile', entityId: subject.id, limit: 100 };

    const from = (await readAudit({ ...query, from: pivot.occurredAt })).body as AuditPageDto;
    expect(from.entries.map((entry) => entry.id)).toContain(pivot.id);
    expect(from.entries.every((entry) => entry.occurredAt >= pivot.occurredAt)).toBe(true);

    const to = (await readAudit({ ...query, to: pivot.occurredAt })).body as AuditPageDto;
    expect(to.entries.map((entry) => entry.id)).not.toContain(pivot.id);
    expect(to.entries.every((entry) => entry.occurredAt < pivot.occurredAt)).toBe(true);
  });

  it('an entity with no rows is an empty page, not a 404', async () => {
    const res = await readAudit({ entityType: 'order', entityId: subject.id });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ entries: [], nextCursor: null });
  });
});

describe('GET /api/admin/audit: cursor', () => {
  it('walks three pages with no duplicate or gap, and the last page says so', async () => {
    const all = (await subjectRows()).map((entry) => entry.id);
    const walked: number[] = [];
    const sizes: number[] = [];
    let before: number | null = null;
    do {
      const query: Record<string, string | number> = {
        entityType: 'profile',
        entityId: subject.id,
        limit: 3,
      };
      if (before !== null) query.before = before;
      const res = await readAudit(query);
      expect(res.status).toBe(200);
      const page = res.body as AuditPageDto;
      walked.push(...page.entries.map((entry) => entry.id));
      sizes.push(page.entries.length);
      before = page.nextCursor;
    } while (before !== null && sizes.length < 10);
    expect(sizes).toEqual([3, 3, 1]);
    expect(walked).toEqual(all);
  });

  it('a page that ends exactly on the last row has a null cursor', async () => {
    const res = await readAudit({
      entityType: 'profile',
      entityId: subject.id,
      limit: ROLE_CHANGES,
    });
    expect((res.body as AuditPageDto).entries).toHaveLength(ROLE_CHANGES);
    expect((res.body as AuditPageDto).nextCursor).toBeNull();
  });
});

describe('GET /api/admin/audit: validation', () => {
  it.each([
    [{ limit: 0 }, 'limit'],
    [{ limit: 101 }, 'limit'],
    [{ limit: 'ten' }, 'limit'],
    [{ limit: 2.5 }, 'limit'],
    [{ before: 0 }, 'before'],
    [{ before: 'abc' }, 'before'],
    [{ from: 'yesterday' }, 'from'],
    [{ to: '2026-13-40T00:00:00Z' }, 'to'],
    [{ from: '2026-11-02' }, 'from'],
    [{ actorId: 'not-a-uuid' }, 'actorId'],
    [{ entityType: 'audit_log' }, 'entityType'],
    [{ entityId: 'x' }, 'entityType'],
    [{ from: '2026-11-02T00:00:00Z', to: '2026-11-01T00:00:00Z' }, 'from'],
    [{ from: '2026-11-02T00:00:00Z', to: '2026-11-02T00:00:00Z' }, 'from'],
  ])('400 VALIDATION_ERROR for %j', async (query, field) => {
    const res = await readAudit(query);
    expect(res.status).toBe(400);
    expect(res.body.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: expect.any(String),
      details: { field },
    });
  });
});

describe('GET /api/admin/audit: combined and edge queries', () => {
  it('combines filters with AND', async () => {
    const hit = await readAudit({
      entityType: 'profile',
      entityId: subject.id,
      actorId: admin.id,
      limit: 100,
    });
    expect((hit.body as AuditPageDto).entries).toHaveLength(ROLE_CHANGES);
    const miss = await readAudit({
      entityType: 'profile',
      entityId: subject.id,
      actorId: staff.id,
    });
    expect(miss.body).toEqual({ entries: [], nextCursor: null });
    const wrongType = await readAudit({
      entityType: 'menu_item',
      entityId: subject.id,
      actorId: admin.id,
    });
    expect(wrongType.body).toEqual({ entries: [], nextCursor: null });
  });

  it('strips unknown query params instead of rejecting them', async () => {
    const res = await readAudit({
      entityType: 'profile',
      entityId: subject.id,
      limit: 100,
      foo: 'bar',
    });
    expect(res.status).toBe(200);
    expect((res.body as AuditPageDto).entries).toHaveLength(ROLE_CHANGES);
  });

  it('accepts limit 1 and 100 (the bounds)', async () => {
    const one = await readAudit({ entityType: 'profile', entityId: subject.id, limit: 1 });
    const page = one.body as AuditPageDto;
    expect(page.entries).toHaveLength(1);
    expect(page.nextCursor).toBe(page.entries[0]?.id);
    expect((await readAudit({ limit: 100 })).status).toBe(200);
  });

  it.each([
    ['65 characters', 'a'.repeat(65)],
    ['blank', '   '],
  ])('400 for an entityId that is %s', async (_label, entityId) => {
    const res = await readAudit({ entityType: 'profile', entityId });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('error bodies leak no internals', async () => {
    const res = await readAudit({ limit: 0 });
    expect(JSON.stringify(res.body)).not.toMatch(
      /\bat .*\.(ts|js)|stack|PGRST|SQLSTATE|select |insert |update /i,
    );
  });
});

describe('AUDIT_ENTITY_TYPES', () => {
  it('lists exactly the entity types the audit_row_change triggers write', () => {
    const rows = localSql<{ entity_type: string }>(
      `select distinct split_part(split_part(pg_get_triggerdef(oid), 'audit_row_change(''', 2), '.', 1) as entity_type
         from pg_trigger where tgfoid = 'public.audit_row_change'::regproc`,
    );
    expect(rows.map((row) => row.entity_type).sort()).toEqual([...AUDIT_ENTITY_TYPES].sort());
  });
});

describe('audit_log indexes', () => {
  // listAudit pages on `order by id desc`: an index that ends in anything else makes every filtered page a sort.
  it('each paged filter has an index ending in id desc', () => {
    const defs = localSql<{ indexdef: string }>(
      `select indexdef from pg_indexes where schemaname = 'public' and tablename = 'audit_log'`,
    ).map((row) => row.indexdef.replace(/^.* USING btree /, ''));
    expect(defs).toEqual(
      expect.arrayContaining([
        '(entity_type, entity_id, id DESC)',
        '(entity_type, id DESC)',
        '(store_id, id DESC)',
        '(actor_id, id DESC)',
      ]),
    );
  });
});
