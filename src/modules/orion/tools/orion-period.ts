export const ORION_PERIODS = [
  'today',
  'yesterday',
  'last_7_days',
  'last_30_days',
  'this_month',
  'last_month',
] as const;
export type OrionPeriod = (typeof ORION_PERIODS)[number];

export const ORION_DAYS = ['today', 'tomorrow'] as const;
export type OrionDay = (typeof ORION_DAYS)[number];

type Ymd = { y: number; m: number; d: number };

/**
 * Calendar periods in the tenant's zone, as `[from, to)` instants. Periods
 * that include today end at `now` (the analytics services refuse a future
 * end). No date library: `Intl` gives the zone offset at any instant.
 */
export function resolveOrionPeriod(
  period: OrionPeriod,
  timeZone: string,
  now = new Date(),
): { from: Date; to: Date } {
  const today = zonedDate(now, timeZone);
  const day = (offset: number) => zonedMidnight(shift(today, offset), timeZone);
  const monthStart = (offset: number) =>
    zonedMidnight(
      normalize({ y: today.y, m: today.m + offset, d: 1 }),
      timeZone,
    );
  switch (period) {
    case 'today':
      return { from: day(0), to: now };
    case 'yesterday':
      return { from: day(-1), to: day(0) };
    case 'last_7_days':
      return { from: day(-6), to: now };
    case 'last_30_days':
      return { from: day(-29), to: now };
    case 'this_month':
      return { from: monthStart(0), to: now };
    case 'last_month':
      return { from: monthStart(-1), to: monthStart(0) };
  }
}

/** `[start, end)` of today or tomorrow in the zone. */
export function resolveOrionDay(
  day: OrionDay,
  timeZone: string,
  now = new Date(),
): { from: Date; to: Date } {
  const today = zonedDate(now, timeZone);
  const offset = day === 'today' ? 0 : 1;
  return {
    from: zonedMidnight(shift(today, offset), timeZone),
    to: zonedMidnight(shift(today, offset + 1), timeZone),
  };
}

/** "HH:mm" of an instant in the zone. */
export function zonedTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

function parts(date: Date, timeZone: string) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>;
  return values;
}

function zonedDate(date: Date, timeZone: string): Ymd {
  const p = parts(date, timeZone);
  return { y: p.year, m: p.month, d: p.day };
}

function offsetMs(instant: number, timeZone: string): number {
  const p = parts(new Date(instant), timeZone);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return asUtc - Math.floor(instant / 1000) * 1000;
}

function zonedMidnight(date: Ymd, timeZone: string): Date {
  const guess = Date.UTC(date.y, date.m - 1, date.d);
  const first = guess - offsetMs(guess, timeZone);
  // A DST change between the guess and the answer moves the offset once.
  const second = guess - offsetMs(first, timeZone);
  return new Date(second);
}

function shift(date: Ymd, days: number): Ymd {
  return normalize({ ...date, d: date.d + days });
}

function normalize(date: Ymd): Ymd {
  const value = new Date(Date.UTC(date.y, date.m - 1, date.d));
  return {
    y: value.getUTCFullYear(),
    m: value.getUTCMonth() + 1,
    d: value.getUTCDate(),
  };
}
