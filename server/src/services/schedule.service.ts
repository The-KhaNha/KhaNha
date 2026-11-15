import {
  openState,
  type OpenState,
  type ScheduleException,
  type ScheduleHours,
} from '../domain/schedule';
import type { ScheduleExceptionDto, StoreHoursDto, StoreScheduleResponse } from '../types/api';
import { cached, PUBLIC_READ_TTL_MS } from '../utils/cache';
import { supabaseAdmin } from '../utils/supabase';
import type { OpenFields, StoreWithBrand } from '../utils/serializers';

export interface Schedule {
  hours: ScheduleHours[];
  exceptions: (ScheduleException & { id: string })[];
}

// A unit conversion, not a tunable duration (check:durations looks for the latter).
const DAY_MS = 24 * 60 * 60 * 1000;
// The Data API answers at most `max_rows` rows (1000 in config.toml, Supabase's default) and says nothing when it cuts.
// ponytail: a page this size assumes max_rows >= 1000; lowering max_rows would end the paging early.
const PAGE = 1000;

/** Every row of an ordered query, a page at a time. */
async function readAll<Row>(
  page: (from: number, to: number) => PromiseLike<{ data: Row[] }>,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await page(from, from + PAGE - 1);
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

/**
 * The weeks and the upcoming exceptions of `storeIds`, two queries (a page each, past 1000 rows) whatever the count.
 * Exceptions that ended before the UTC date two days back can never matter and are not read: at UTC-12, the previous
 * local day, whose overnight exception still runs into today, can be that date.
 */
async function loadSchedules(storeIds: string[]): Promise<Map<string, Schedule>> {
  const since = new Date(Date.now() - 2 * DAY_MS).toISOString().slice(0, 10);
  const [hours, exceptions] = await Promise.all([
    readAll((from, to) =>
      supabaseAdmin
        .from('store_hours')
        .select('store_id, day_of_week, opens_at, closes_at')
        .in('store_id', storeIds)
        .order('day_of_week')
        .order('opens_at')
        .order('id')
        .range(from, to)
        .throwOnError(),
    ),
    readAll((from, to) =>
      supabaseAdmin
        .from('store_schedule_exceptions')
        .select('id, store_id, starts_on, ends_on, kind, opens_at, closes_at, label')
        .in('store_id', storeIds)
        .gte('ends_on', since)
        .order('starts_on')
        .order('id')
        .range(from, to)
        .throwOnError(),
    ),
  ]);
  const schedules = new Map<string, Schedule>(
    storeIds.map((id) => [id, { hours: [], exceptions: [] }]),
  );
  for (const row of hours)
    schedules.get(row.store_id)?.hours.push({
      dayOfWeek: row.day_of_week,
      opensAt: row.opens_at,
      closesAt: row.closes_at,
    });
  for (const row of exceptions)
    schedules.get(row.store_id)?.exceptions.push({
      id: row.id,
      startsOn: row.starts_on,
      endsOn: row.ends_on,
      kind: row.kind,
      opensAt: row.opens_at,
      closesAt: row.closes_at,
      label: row.label,
    });
  return schedules;
}

/** One store's schedule, uncached: what a write path (an order's acceptance) checks against. */
export async function loadSchedule(storeId: string): Promise<Schedule> {
  return (await loadSchedules([storeId])).get(storeId) ?? { hours: [], exceptions: [] };
}

/** One store's schedule, cached under `store_hours:<id>`; the hours editor (PR 07) drops the key on every write. */
export function getSchedule(storeId: string): Promise<Schedule> {
  return cached(`store_hours:${storeId}`, PUBLIC_READ_TTL_MS, () => loadSchedule(storeId));
}

export async function getSchedules(storeIds: string[]): Promise<Map<string, Schedule>> {
  return storeIds.length ? loadSchedules(storeIds) : new Map();
}

export function computeOpenState(
  store: StoreWithBrand,
  schedule: Schedule,
  now = new Date(),
): OpenState {
  return openState(
    {
      status: store.status,
      isOpen: store.is_open,
      timezone: store.timezone,
      acceptingOrders: store.accepting_orders,
      pausedUntil: store.paused_until ? new Date(store.paused_until) : null,
    },
    schedule.hours,
    schedule.exceptions,
    store.last_order_minutes_before_close,
    now,
  );
}

/** The DTO fields of a state; `isOpen` keeps the deployed client's meaning ("can order right now"). */
export function toOpenFields(state: OpenState): OpenFields {
  return {
    isOpen: state.state === 'OPEN' || state.state === 'CLOSING_SOON',
    openState: state.state,
    nextChangeAt: state.nextChangeAt?.toISOString() ?? null,
    openLabel: state.label,
  };
}

/** A store's open fields from its cached schedule, computed at call time. */
export async function getOpenFields(store: StoreWithBrand): Promise<OpenFields> {
  return toOpenFields(computeOpenState(store, await getSchedule(store.id)));
}

const hhmm = (time: string | null): string | null => time?.slice(0, 5) ?? null;

/** The week and the exceptions from today (in the store's zone) on; `fresh` skips the cache (a manager's own read). */
export async function getStoreSchedule(
  store: StoreWithBrand,
  fresh = false,
): Promise<StoreScheduleResponse> {
  const { hours, exceptions } = await (fresh ? loadSchedule : getSchedule)(store.id);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: store.timezone }).format(new Date());
  return {
    timezone: store.timezone,
    hours: hours.map((h): StoreHoursDto => ({
      dayOfWeek: h.dayOfWeek,
      opensAt: h.opensAt.slice(0, 5),
      closesAt: h.closesAt.slice(0, 5),
    })),
    exceptions: exceptions
      .filter((e) => e.endsOn >= today)
      .map((e): ScheduleExceptionDto => ({
        id: e.id,
        startsOn: e.startsOn,
        endsOn: e.endsOn,
        kind: e.kind,
        opensAt: hhmm(e.opensAt),
        closesAt: hhmm(e.closesAt),
        label: e.label,
      })),
  };
}
