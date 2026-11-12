// Local only: editing opening hours (P2 PR 07): the week, its exceptions, the audit trail and the cache invalidation.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StoreDto, StoreScheduleResponse } from '../../src/types/api';
import { supabaseAdmin } from '../../src/utils/supabase';
import { api } from '../setup/api';
import {
  createStoreMember,
  deleteTestStores,
  testAuthMatrix,
  testStoreIsolation,
  type TestUser,
} from '../setup/helpers';

const tag = randomUUID().slice(0, 8);
let brandId = '';
let storeId = '';
let manager: TestUser;
let staff: TestUser;
const as = (user: TestUser) => ({ Authorization: `Bearer ${user.token}` });
const put = (hours: unknown, user = manager) =>
  api().put(`/api/stores/${storeId}/hours`).set(as(user)).send({ hours });
const week = async () =>
  (await api().get(`/api/stores/${storeId}/hours`)).body as StoreScheduleResponse;
const audit = async () =>
  (
    await supabaseAdmin
      .from('audit_log')
      .select('actor_id, changes')
      .eq('store_id', storeId)
      .eq('action', 'store_hours.changed')
      .order('id')
      .throwOnError()
  ).data;
const everyDay = (opensAt: string, closesAt: string) =>
  [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({ dayOfWeek, opensAt, closesAt }));

beforeAll(async () => {
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .insert({ name: 'HoursEdit', slug: `hours-edit-${tag}`, status: 'ACTIVE' })
    .select('id')
    .single()
    .throwOnError();
  brandId = brand.id;
  const { data: store } = await supabaseAdmin
    .from('stores')
    .insert({
      name: 'Hours edit',
      slug: `hours-edit-${tag}`,
      brand_id: brandId,
      status: 'ACTIVE',
      is_open: true,
      timezone: 'UTC',
      tagline: 'Test',
      description: 'A store for store-hours-edit.test.ts',
    })
    .select('id')
    .single()
    .throwOnError();
  storeId = store.id;
  manager = await createStoreMember(storeId, 'MANAGER');
  staff = await createStoreMember(storeId, 'STAFF');
}, 60_000);

afterAll(async () => {
  await deleteTestStores([storeId], [brandId], [manager, staff]);
});

testAuthMatrix('PUT /api/stores/:storeId/hours', (http) =>
  http.put(`/api/stores/${randomUUID()}/hours`).send({ hours: [] }),
);
testStoreIsolation(
  'PUT /api/stores/:storeId/hours',
  (http, id) => http.put(`/api/stores/${id}/hours`).send({ hours: [] }),
  undefined,
  'MANAGER',
);
testStoreIsolation(
  'DELETE /api/stores/:storeId/schedule-exceptions/:exceptionId',
  (http, id, exceptionId) => http.delete(`/api/stores/${id}/schedule-exceptions/${exceptionId}`),
  async (id) => {
    const { data } = await supabaseAdmin
      .from('store_schedule_exceptions')
      .insert({
        store_id: id,
        starts_on: '2099-01-01',
        ends_on: '2099-01-01',
        kind: 'CLOSED',
        label: 'Iso',
      })
      .select('id')
      .single()
      .throwOnError();
    return data.id;
  },
  'MANAGER',
);

describe('opening hours editing', () => {
  it('staff lack hours.edit → 403', async () => {
    expect((await put([], staff)).status).toBe(403);
  });

  it('saves the week, flips openState on the next read, and audits one row naming the actor', async () => {
    // Open all day every day: open now whatever the clock says.
    const before = await api().get(`/api/stores/${storeId}`);
    expect((before.body.store as StoreDto).openState).toBe('OPEN');
    // Prime the schedule cache, then replace the week with intervals that cannot contain now.
    const now = new Date();
    const hour = now.getUTCHours();
    const closedWindow = hour >= 12 ? ['01:00', '02:00'] : ['20:00', '21:00'];
    const res = await put(everyDay(closedWindow[0] ?? '', closedWindow[1] ?? ''));
    expect(res.status).toBe(200);
    expect((res.body as StoreScheduleResponse).hours).toHaveLength(7);
    const after = await api().get(`/api/stores/${storeId}`);
    expect((after.body.store as StoreDto).openState).toBe('CLOSED');
    const rows = await audit();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor_id).toBe(manager.id);
    const { week: pair } = rows[0]?.changes as { week: [unknown[], unknown[]] };
    expect(pair[0]).toEqual([]);
    expect(pair[1]).toHaveLength(7);
    const { data: events } = await supabaseAdmin
      .from('domain_events')
      .select('id')
      .eq('store_id', storeId)
      .eq('type', 'store.hours_changed')
      .throwOnError();
    expect(events).toHaveLength(1);
  });

  it('a repeat PUT is a 200 that leaves no second audit row and no second event', async () => {
    const hours = (await week()).hours;
    expect((await put(hours)).status).toBe(200);
    expect(await audit()).toHaveLength(1);
    const { data: events } = await supabaseAdmin
      .from('domain_events')
      .select('id')
      .eq('store_id', storeId)
      .eq('type', 'store.hours_changed')
      .throwOnError();
    expect(events).toHaveLength(1);
  });

  it.each([
    [
      'two intervals on a day',
      [
        { dayOfWeek: 2, opensAt: '09:00', closesAt: '12:00' },
        { dayOfWeek: 2, opensAt: '11:00', closesAt: '14:00' },
      ],
    ],
    [
      'an overnight interval over the next morning',
      [
        { dayOfWeek: 2, opensAt: '22:00', closesAt: '02:00' },
        { dayOfWeek: 3, opensAt: '01:00', closesAt: '05:00' },
      ],
    ],
    [
      'Sunday night over Monday morning',
      [
        { dayOfWeek: 7, opensAt: '22:00', closesAt: '02:00' },
        { dayOfWeek: 1, opensAt: '01:00', closesAt: '05:00' },
      ],
    ],
  ])('an overlap (%s) → 400 VALIDATION_ERROR and the old week stays', async (_label, hours) => {
    const old = await week();
    const res = await put(hours);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect((await week()).hours).toEqual(old.hours);
    expect(await audit()).toHaveLength(1);
  });

  it('touching intervals and an overnight one that ends before the next opens are fine', async () => {
    const res = await put([
      { dayOfWeek: 2, opensAt: '09:00', closesAt: '12:00' },
      { dayOfWeek: 2, opensAt: '12:00', closesAt: '14:00' },
      { dayOfWeek: 3, opensAt: '22:00', closesAt: '02:00' },
      { dayOfWeek: 4, opensAt: '02:00', closesAt: '05:00' },
    ]);
    expect(res.status).toBe(200);
  });

  it.each([
    ['a bad time', [{ dayOfWeek: 1, opensAt: '9:00', closesAt: '12:00' }]],
    ['day 8', [{ dayOfWeek: 8, opensAt: '09:00', closesAt: '12:00' }]],
    ['equal times', [{ dayOfWeek: 1, opensAt: '09:00', closesAt: '09:00' }]],
    [
      'seven intervals a day',
      Array.from({ length: 7 }, (_, i) => ({
        dayOfWeek: 1,
        opensAt: `${String(i * 3).padStart(2, '0')}:00`,
        closesAt: `${String(i * 3 + 1).padStart(2, '0')}:00`,
      })),
    ],
  ])('%s → 400', async (_label, hours) => {
    expect((await put(hours)).status).toBe(400);
  });

  it('an empty week clears the hours', async () => {
    expect((await put([])).status).toBe(200);
    expect((await week()).hours).toEqual([]);
  });

  describe('exceptions', () => {
    const post = (body: object, user = manager) =>
      api().post(`/api/stores/${storeId}/schedule-exceptions`).set(as(user)).send(body);
    const closed = {
      startsOn: '2099-05-01',
      endsOn: '2099-05-02',
      kind: 'CLOSED',
      label: 'Holiday',
    };

    it('adds and removes one, flipping the schedule read, with an audit row naming the actor', async () => {
      await week(); // primes the cache
      const res = await post(closed);
      expect(res.status).toBe(201);
      const id = (res.body as { exception: { id: string } }).exception.id;
      expect((await week()).exceptions.map((e) => e.id)).toContain(id);
      expect(
        (await api().delete(`/api/stores/${storeId}/schedule-exceptions/${id}`).set(as(manager)))
          .status,
      ).toBe(204);
      expect((await week()).exceptions.map((e) => e.id)).not.toContain(id);
      const { data } = await supabaseAdmin
        .from('audit_log')
        .select('actor_id')
        .eq('store_id', storeId)
        .eq('action', 'schedule_exception.changed')
        .throwOnError();
      expect(data).toHaveLength(2);
      expect(data.every((row) => row.actor_id === manager.id)).toBe(true);
    });

    it('an unknown id or a malformed one is 404', async () => {
      for (const id of [randomUUID(), 'nope'])
        expect(
          (await api().delete(`/api/stores/${storeId}/schedule-exceptions/${id}`).set(as(manager)))
            .status,
        ).toBe(404);
    });

    it.each([
      ['CLOSED with times', { ...closed, opensAt: '09:00', closesAt: '12:00' }],
      ['SPECIAL_HOURS without times', { ...closed, kind: 'SPECIAL_HOURS' }],
      ['ends before it starts', { ...closed, endsOn: '2099-04-01' }],
      ['an impossible date', { ...closed, startsOn: '2099-02-31' }],
      ['a month past 12', { ...closed, startsOn: '2099-13-01' }],
      ['a short label', { ...closed, label: 'x' }],
    ])('%s → 400', async (_label, body: object) => {
      expect((await post(body)).status).toBe(400);
    });

    it('the 51st upcoming exception is refused', async () => {
      const { data: existing } = await supabaseAdmin
        .from('store_schedule_exceptions')
        .select('id')
        .eq('store_id', storeId)
        .throwOnError();
      const room = 50 - existing.length;
      await supabaseAdmin
        .from('store_schedule_exceptions')
        .insert(
          Array.from({ length: room }, (_, i) => ({
            store_id: storeId,
            starts_on: '2099-06-01',
            ends_on: '2099-06-01',
            kind: 'CLOSED' as const,
            label: `Bulk ${i}`,
          })),
        )
        .throwOnError();
      expect((await post(closed)).status).toBe(400);
    });
  });
});
