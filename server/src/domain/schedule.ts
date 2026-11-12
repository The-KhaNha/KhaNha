// The open-state rule (P2.4): a pure function of the store, its weekly hours, its exceptions and the clock. Time zones
// are computed here with Intl only, so the client shows `state`, `nextChangeAt` and `label` exactly as received.
// Intervals belong to the local date they start on; one that runs past midnight is still open the next morning.

export type OpenStateName = 'OPEN' | 'CLOSING_SOON' | 'CLOSED' | 'PAUSED' | 'UNAVAILABLE';

/** `opensAt` / `closesAt` are `HH:MM` or `HH:MM:SS` wall times; `closesAt` before `opensAt` runs past midnight. */
export interface ScheduleHours {
  dayOfWeek: number;
  opensAt: string;
  closesAt: string;
}

export interface ScheduleException {
  startsOn: string;
  endsOn: string;
  kind: 'CLOSED' | 'SPECIAL_HOURS';
  opensAt: string | null;
  closesAt: string | null;
  label: string;
}

export interface ScheduleStore {
  status: string;
  /** The manual "closed now" switch. */
  isOpen: boolean;
  timezone: string;
  /** Wired in P2.5; until then a store is never paused. */
  acceptingOrders?: boolean;
  pausedUntil?: Date | null;
}

export interface OpenState {
  state: OpenStateName;
  /** When ordering next changes: the last-order time while open, the next opening while closed. */
  nextChangeAt: Date | null;
  label: string | null;
}

/** How long before the last order the state reads CLOSING_SOON (display only). Presentation constant. */
export const CLOSING_SOON_MINUTES = 30;
/** How many days ahead the next opening is searched. */
const HORIZON_DAYS = 14;
// Unit conversions, not tunable durations (check:durations looks for the latter).
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${timeZone}|${JSON.stringify(options)}`;
  let found = formatters.get(key);
  if (!found) {
    found = new Intl.DateTimeFormat('en-US', { timeZone, ...options });
    formatters.set(key, found);
  }
  return found;
}

/** The zone's offset from UTC at an instant, in ms (wall clock read as UTC, minus the instant). */
function offsetMs(ms: number, timeZone: string): number {
  const p = new Map(
    formatter(timeZone, {
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
      .formatToParts(ms)
      .map((part) => [part.type, Number(part.value)]),
  );
  const get = (type: Intl.DateTimeFormatPartTypes): number => p.get(type) ?? 0;
  const wall = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return wall - Math.floor(ms / 1000) * 1000;
}

/** The local calendar day of an instant, as days since 1970-01-01. */
function localDay(ms: number, timeZone: string): number {
  return Math.floor((ms + offsetMs(ms, timeZone)) / DAY_MS);
}

/** The instant a local wall time (minutes after midnight of local day `day`) happens; two passes settle a clock change. */
function wallToInstant(day: number, minutes: number, timeZone: string): number {
  const guess = day * DAY_MS + minutes * MINUTE_MS;
  const first = guess - offsetMs(guess, timeZone);
  return guess - offsetMs(first, timeZone);
}

const minutesOf = (time: string): number =>
  Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const dayOf = (date: string): number => Date.parse(`${date}T00:00:00Z`) / DAY_MS;
/** ISO weekday of a local day: 1 = Monday ... 7 = Sunday. 1970-01-01 was a Thursday. */
const isoWeekday = (day: number): number => ((((day + 3) % 7) + 7) % 7) + 1;

interface Block {
  start: number;
  end: number;
}

/** When the store is open on one local day: a CLOSED exception empties it, SPECIAL_HOURS replace the week. */
function intervalsOn(
  day: number,
  hours: ScheduleHours[],
  exceptions: ScheduleException[],
  timeZone: string,
): Block[] {
  const covering = exceptions.filter((e) => dayOf(e.startsOn) <= day && day <= dayOf(e.endsOn));
  if (covering.some((e) => e.kind === 'CLOSED')) return [];
  const special = covering.filter((e) => e.kind === 'SPECIAL_HOURS');
  const wanted: { opensAt: string; closesAt: string }[] = special.length
    ? special.map((e) => ({ opensAt: e.opensAt ?? '00:00', closesAt: e.closesAt ?? '00:00' }))
    : hours.filter((h) => h.dayOfWeek === isoWeekday(day));
  // No weekly hours at all means "open all day" (the manual switch decides), so exceptions can still carve it up.
  if (!special.length && hours.length === 0) {
    return [{ start: wallToInstant(day, 0, timeZone), end: wallToInstant(day + 1, 0, timeZone) }];
  }
  return wanted.map(({ opensAt, closesAt }) => {
    const opens = minutesOf(opensAt);
    const closes = minutesOf(closesAt);
    return {
      start: wallToInstant(day, opens, timeZone),
      end: wallToInstant(closes <= opens ? day + 1 : day, closes, timeZone),
    };
  });
}

function mergeBlocks(blocks: Block[]): Block[] {
  const merged: Block[] = [];
  for (const block of [...blocks].sort((a, b) => a.start - b.start)) {
    const last = merged[merged.length - 1];
    if (last && block.start <= last.end) last.end = Math.max(last.end, block.end);
    else merged.push({ ...block });
  }
  return merged;
}

/** "at 9:00 AM", "tomorrow at 8:00 AM" or "Mon at 8:00 AM", read in the store's zone. */
export function describeWhen(target: Date, now: Date, timeZone: string): string {
  const time = formatter(timeZone, { hour: 'numeric', minute: '2-digit' }).format(target);
  const ahead = localDay(target.getTime(), timeZone) - localDay(now.getTime(), timeZone);
  if (ahead <= 0) return `at ${time}`;
  if (ahead === 1) return `tomorrow at ${time}`;
  return `${formatter(timeZone, { weekday: 'short' }).format(target)} at ${time}`;
}

export function openState(
  store: ScheduleStore,
  hours: ScheduleHours[],
  exceptions: ScheduleException[],
  lastOrderMinutes: number,
  now: Date,
): OpenState {
  const timeZone = store.timezone;
  if (store.status !== 'ACTIVE')
    return { state: 'UNAVAILABLE', nextChangeAt: null, label: 'Unavailable' };
  if (store.acceptingOrders === false && (!store.pausedUntil || store.pausedUntil > now)) {
    const back = store.pausedUntil ?? null;
    return {
      state: 'PAUSED',
      nextChangeAt: back,
      label: back ? `Paused, back ${describeWhen(back, now, timeZone)}` : 'Paused',
    };
  }
  if (!store.isOpen) return { state: 'CLOSED', nextChangeAt: null, label: 'Closed right now' };

  const nowMs = now.getTime();
  const today = localDay(nowMs, timeZone);
  const windowEnd = wallToInstant(today + HORIZON_DAYS + 1, 0, timeZone);
  const blocks = mergeBlocks(
    Array.from({ length: HORIZON_DAYS + 2 }, (_, i) =>
      intervalsOn(today - 1 + i, hours, exceptions, timeZone),
    ).flat(),
  );
  const current = blocks.find((b) => b.start <= nowMs && nowMs < b.end);

  if (current) {
    const lastOrderAt = current.end - lastOrderMinutes * MINUTE_MS;
    // An unbroken run to the end of the search window has no known closing time (no weekly hours: always open).
    const endless = hours.length === 0 && current.end >= windowEnd;
    if (nowMs < lastOrderAt) {
      const soon = lastOrderAt - nowMs <= CLOSING_SOON_MINUTES * MINUTE_MS;
      // The customer cares when ordering stops, which is the cutoff, not the door closing.
      const stopsAt = new Date(lastOrderAt);
      const when = describeWhen(stopsAt, now, timeZone);
      return {
        state: soon ? 'CLOSING_SOON' : 'OPEN',
        nextChangeAt: endless ? null : stopsAt,
        label: endless ? null : lastOrderMinutes > 0 ? `Last orders ${when}` : `Closes ${when}`,
      };
    }
  }

  const next = blocks.find((b) => b.start > nowMs);
  const nextChangeAt = next ? new Date(next.start) : null;
  const closedFor = exceptions.find(
    (e) => e.kind === 'CLOSED' && dayOf(e.startsOn) <= today && today <= dayOf(e.endsOn),
  );
  const opens = nextChangeAt ? `Opens ${describeWhen(nextChangeAt, now, timeZone)}` : null;
  return {
    state: 'CLOSED',
    nextChangeAt,
    label: closedFor ? `Closed for ${closedFor.label}` : (opens ?? 'Closed'),
  };
}
