// Local only: opening hours (P2 PR 06): the public hours read, the open state on the store DTOs, and an order refused
// by the schedule with the next opening. Throwaway brand and stores, removed afterwards.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StoreDto, StoreScheduleResponse, StoreSummaryDto } from '../../src/types/api';
import { getSchedule, getSchedules } from '../../src/services/schedule.service';
import { invalidate } from '../../src/utils/cache';
import { supabaseAdmin } from '../../src/utils/supabase';
import { api } from '../setup/api';
import { createTestUser, deleteTestStores, type TestUser } from '../setup/helpers';

const tag = randomUUID().slice(0, 8);
const store = { open: '', ended: '', week: '', bulk: '' };
const item = { open: '', ended: '' };
let brandId = '';
let customer: TestUser;

const HOUR = 3_600_000;
const slug = (key: string) => `hours-${key}-${tag}`;
const utc = (ms: number) => new Date(ms).toISOString();
const time = (ms: number) => utc(ms).slice(11, 16);
// ISO weekday of an instant, in UTC (every test store runs in UTC).
const isoDay = (ms: number) => ((new Date(ms).getUTCDay() + 6) % 7) + 1;

const order = (storeId: string, menuItemId: string) =>
  api()
    .post('/api/orders')
    .set({ Authorization: `Bearer ${customer.token}` })
    .send({ storeId, items: [{ menuItemId, quantity: 1 }] });

beforeAll(async () => {
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .insert({ name: 'Hours', slug: `hours-${tag}`, status: 'ACTIVE' })
    .select('id')
    .single()
    .throwOnError();
  brandId = brand.id;
  const { data: stores } = await supabaseAdmin
    .from('stores')
    .insert(
      (['open', 'ended', 'week'] as const).map((key) => ({
        name: `Hours ${key}`,
        slug: slug(key),
        brand_id: brandId,
        status: 'ACTIVE' as const,
        is_open: true,
        timezone: 'UTC',
        tagline: 'Test',
        description: 'A store for store-hours.test.ts',
      })),
    )
    .select('id, slug')
    .throwOnError();
  for (const key of ['open', 'ended', 'week'] as const)
    store[key] = stores.find((s) => s.slug === slug(key))?.id ?? '';
  for (const key of ['open', 'ended'] as const) {
    const { data } = await supabaseAdmin
      .from('menu_items')
      .insert({
        store_id: store[key],
        name: `Item ${key}`,
        description: 'Test',
        category: 'Test',
        image_url: '/images/x.jpg',
        price_paise: 1000,
      })
      .select('id')
      .single()
      .throwOnError();
    item[key] = data.id;
  }
  const now = Date.now();
  // The only interval of `ended` ran from three hours ago to one hour ago (it may cross midnight: that is the rule).
  const start = now - 3 * HOUR;
  await supabaseAdmin
    .from('store_hours')
    .insert({
      store_id: store.ended,
      day_of_week: isoDay(start),
      opens_at: time(start),
      closes_at: time(now - HOUR),
    })
    .throwOnError();
  // `week`: an overnight Friday interval, and a CLOSED exception far ahead.
  await supabaseAdmin
    .from('store_hours')
    .insert({ store_id: store.week, day_of_week: 5, opens_at: '18:00', closes_at: '02:00' })
    .throwOnError();
  await supabaseAdmin
    .from('store_schedule_exceptions')
    .insert([
      {
        store_id: store.week,
        starts_on: '2999-01-01',
        ends_on: '2999-01-03',
        kind: 'CLOSED' as const,
        label: 'Far festival',
      },
      {
        store_id: store.week,
        starts_on: '2000-01-01',
        ends_on: '2000-01-02',
        kind: 'CLOSED' as const,
        label: 'Long past',
      },
    ])
    .throwOnError();
  customer = await createTestUser();
  invalidate();
}, 60_000);

afterAll(async () => {
  const ids = Object.values(store).filter(Boolean);
  await supabaseAdmin.from('orders').delete().in('store_id', ids);
  await supabaseAdmin.from('menu_items').delete().in('store_id', ids);
  await deleteTestStores(ids, [brandId], [customer]);
});

describe('GET /api/stores/:storeRef/hours', () => {
  it('is public and answers the week and only the upcoming exceptions, by slug or id', async () => {
    const bySlug = await api().get(`/api/stores/${slug('week')}/hours`);
    expect(bySlug.status).toBe(200);
    const body = bySlug.body as StoreScheduleResponse;
    expect(body.timezone).toBe('UTC');
    expect(body.hours).toEqual([{ dayOfWeek: 5, opensAt: '18:00', closesAt: '02:00' }]);
    expect(body.exceptions).toEqual([
      expect.objectContaining({
        startsOn: '2999-01-01',
        endsOn: '2999-01-03',
        kind: 'CLOSED',
        opensAt: null,
        closesAt: null,
        label: 'Far festival',
      }),
    ]);
    const byId = await api().get(`/api/stores/${store.week}/hours`);
    expect(byId.body).toEqual(body);
  });

  it('answers an empty week for a store with no hours, and 404 for an unknown store', async () => {
    const res = await api().get(`/api/stores/${slug('open')}/hours`);
    expect(res.body).toEqual({ timezone: 'UTC', hours: [], exceptions: [] });
    expect((await api().get('/api/stores/no-such-store-here/hours')).status).toBe(404);
  });
});

describe('the open state on the store reads', () => {
  it('reads OPEN with no hours and CLOSED with the next opening after the last interval', async () => {
    const open = (await api().get(`/api/stores/${slug('open')}`)).body.store as StoreDto;
    expect(open).toMatchObject({ isOpen: true, openState: 'OPEN', nextChangeAt: null });
    const ended = (await api().get(`/api/stores/${slug('ended')}`)).body.store as StoreDto;
    expect(ended).toMatchObject({ isOpen: false, openState: 'CLOSED' });
    expect(ended.openLabel).toMatch(/^Opens /);
    expect(Date.parse(ended.nextChangeAt ?? '')).toBeGreaterThan(Date.now());
    const listed = (await api().get('/api/stores')).body.stores as StoreSummaryDto[];
    expect(listed.find((s) => s.id === store.ended)).toMatchObject({
      isOpen: false,
      openState: 'CLOSED',
    });
  });
});

describe('POST /api/orders against the schedule', () => {
  it('refuses an order at a store whose only interval ended an hour ago, naming the next opening', async () => {
    const res = await order(store.ended, item.ended);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('STORE_CLOSED');
    expect(res.body.error.message).toMatch(/^Hours ended opens /);
    expect(res.body.error.details).toEqual({
      kind: 'storeClosed',
      nextChangeAt: expect.any(String),
    });
    expect(Date.parse(res.body.error.details.nextChangeAt)).toBeGreaterThan(Date.now());
  });

  it('takes the same order at a store with no hours', async () => {
    const res = await order(store.open, item.open);
    expect(res.status).toBe(201);
  });
});

// A CLOSED exception covering today (UTC, the test stores' zone), written behind the API's back.
async function closeToday(storeId: string): Promise<() => Promise<void>> {
  const today = utc(Date.now()).slice(0, 10);
  const { data } = await supabaseAdmin
    .from('store_schedule_exceptions')
    .insert({
      store_id: storeId,
      starts_on: today,
      ends_on: today,
      kind: 'CLOSED',
      label: 'Shut today',
    })
    .select('id')
    .single()
    .throwOnError();
  return async () => {
    await supabaseAdmin.from('store_schedule_exceptions').delete().eq('id', data.id).throwOnError();
    invalidate();
  };
}

describe('schedule reads and their caches', () => {
  it('an order is checked against the schedule as it is now, not a cached copy', async () => {
    await api().get(`/api/stores/${slug('open')}/hours`); // fills store_hours:<id>
    const reopen = await closeToday(store.open);
    try {
      const res = await order(store.open, item.open);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('STORE_CLOSED');
    } finally {
      await reopen();
    }
  });

  it("the menu's open state is computed per read, outside the menu's cache", async () => {
    const menu = () => api().get(`/api/stores/${slug('open')}/menu`);
    expect((await menu()).body.store.openState).toBe('OPEN');
    const reopen = await closeToday(store.open);
    try {
      // What the hours editor drops on a write: the schedule's key, not every menu's.
      invalidate(`store_hours:${store.open}`);
      expect((await menu()).body.store.openState).toBe('CLOSED');
    } finally {
      await reopen();
    }
  });

  it('reads an exception that ended two UTC dates ago: the previous local day of a zone west of UTC', async () => {
    const twoDaysAgo = utc(Date.now() - 48 * HOUR).slice(0, 10);
    const { data } = await supabaseAdmin
      .from('store_schedule_exceptions')
      .insert({
        store_id: store.week,
        starts_on: twoDaysAgo,
        ends_on: twoDaysAgo,
        kind: 'SPECIAL_HOURS',
        opens_at: '20:00',
        closes_at: '18:00',
        label: 'Late night',
      })
      .select('id')
      .single()
      .throwOnError();
    invalidate();
    try {
      expect((await getSchedule(store.week)).exceptions.map((e) => e.id)).toContain(data.id);
    } finally {
      await supabaseAdmin.from('store_schedule_exceptions').delete().eq('id', data.id);
      invalidate();
    }
  });

  it('a batch read returns every row past the Data API row cap (max_rows = 1000)', async () => {
    const { data } = await supabaseAdmin
      .from('stores')
      .insert({
        name: 'Hours bulk',
        slug: slug('bulk'),
        brand_id: brandId,
        status: 'DRAFT',
        timezone: 'UTC',
        tagline: 'Test',
        description: 'A store for store-hours.test.ts',
      })
      .select('id')
      .single()
      .throwOnError();
    store.bulk = data.id;
    const rows = Array.from({ length: 1005 }, (_, i) => ({
      store_id: store.bulk,
      day_of_week: (i % 7) + 1,
      opens_at: `00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`,
      closes_at: '23:00',
    }));
    await supabaseAdmin.from('store_hours').insert(rows).throwOnError();
    expect((await getSchedules([store.bulk])).get(store.bulk)?.hours).toHaveLength(1005);
  });
});
