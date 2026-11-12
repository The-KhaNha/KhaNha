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

const DAY_MS = 86_400_000;

/**
 * The weeks and the upcoming exceptions of `storeIds`, two queries whatever the count. Exceptions that ended before
 * yesterday (UTC, so any zone's today is covered) can never matter and are not read.
 */
async function loadSchedules(storeIds: string[]): Promise<Map<string, Schedule>> {
  const since = new Date(Date.now() - DAY_MS).toISOString().slice(0, 10);
  const [hours, exceptions] = await Promise.all([
    supabaseAdmin
      .from('store_hours')
      .select('store_id, day_of_week, opens_at, closes_at')
      .in('store_id', storeIds)
      .order('day_of_week')
      .order('opens_at')
      .throwOnError(),
    supabaseAdmin
      .from('store_schedule_exceptions')
      .select('id, store_id, starts_on, ends_on, kind, opens_at, closes_at, label')
      .in('store_id', storeIds)
      .gte('ends_on', since)
      .order('starts_on')
      .order('id')
      .throwOnError(),
  ]);
  const schedules = new Map<string, Schedule>(
    storeIds.map((id) => [id, { hours: [], exceptions: [] }]),
  );
  for (const row of hours.data)
    schedules.get(row.store_id)?.hours.push({
      dayOfWeek: row.day_of_week,
      opensAt: row.opens_at,
      closesAt: row.closes_at,
    });
  for (const row of exceptions.data)
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

/** One store's schedule, cached under `store_hours:<id>`; the hours editor (PR 07) drops the key on every write. */
export function getSchedule(storeId: string): Promise<Schedule> {
  return cached(`store_hours:${storeId}`, PUBLIC_READ_TTL_MS, async () => {
    const schedules = await loadSchedules([storeId]);
    return schedules.get(storeId) ?? { hours: [], exceptions: [] };
  });
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
    { status: store.status, isOpen: store.is_open, timezone: store.timezone },
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

/** The week and the exceptions from today (in the store's zone) on. */
export async function getStoreSchedule(store: StoreWithBrand): Promise<StoreScheduleResponse> {
  const { hours, exceptions } = await getSchedule(store.id);
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
