import { zonedParts, zonedTimeToUtc } from './zoned-time';

const DAILY_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Sunday-first, matching `Date.getUTCDay()`. */
const WEEKDAY_NAMES = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

export type SummaryFrequency = 'daily' | 'weekly' | 'monthly';

export const SUMMARY_FREQUENCIES: readonly SummaryFrequency[] = [
  'daily',
  'weekly',
  'monthly',
];

/**
 * How often a recurring summary fires, in local wall-clock terms.
 *
 * `weekday` is only read when the frequency is weekly and `dayOfMonth` only
 * when it is monthly, so switching cadence never has to clear the other field:
 * the operator gets their previous choice back when they switch again.
 */
export interface SummarySchedule {
  frequency: SummaryFrequency;
  dailyTime: string;
  timezone: string;
  weekday?: string | null;
  dayOfMonth?: number | null;
}

export interface DailyOccurrence {
  fireAt: Date;
  localDate: string;
}

/**
 * Reads a schedule out of a stored `schedulePolicy`, or returns null when the
 * automation has nothing runnable configured.
 *
 * Defaults are the historical ones: an instance saved before cadence existed
 * keeps firing daily in its own timezone, with no field to migrate.
 */
export function readSummarySchedule(
  policy: Record<string, unknown> | null | undefined,
): SummarySchedule | null {
  const dailyTime = trimmed(policy?.dailyTime);
  if (!dailyTime) return null;

  const frequency = trimmed(policy?.frequency) ?? 'daily';
  if (!SUMMARY_FREQUENCIES.includes(frequency as SummaryFrequency)) return null;

  return {
    frequency: frequency as SummaryFrequency,
    dailyTime,
    timezone: trimmed(policy?.timezone) ?? 'UTC',
    weekday: trimmed(policy?.weekday),
    dayOfMonth:
      typeof policy?.dayOfMonth === 'number' ? policy.dayOfMonth : null,
  };
}

/**
 * Resolves the next wall-clock occurrence of HH:mm in an IANA timezone.
 *
 * The conversion is deliberately based on Intl rather than the server timezone.
 * This keeps each workspace schedule stable across deploy regions and daylight
 * saving changes.
 */
export function nextDailyOccurrence(
  now: Date,
  dailyTime: string,
  timezone: string,
): DailyOccurrence {
  const currentLocalDate = localDateAt(now, timezone);
  let localDate = currentLocalDate;
  let fireAt = localDateTimeToUtc(localDate, dailyTime, timezone);
  if (fireAt.getTime() <= now.getTime()) {
    localDate = addLocalDays(localDate, 1);
    fireAt = localDateTimeToUtc(localDate, dailyTime, timezone);
  }
  return { fireAt, localDate };
}

/**
 * The next occurrence of a schedule of any cadence.
 *
 * Daily walks a day, weekly walks to the chosen weekday and monthly to the
 * chosen day of the month. A day that a short month does not have is clamped to
 * that month's last day, so "day 31" means "the last day" in February rather
 * than silently skipping the month.
 */
export function nextScheduledOccurrence(
  now: Date,
  schedule: SummarySchedule,
): DailyOccurrence {
  const { frequency, dailyTime, timezone } = schedule;
  if (frequency === 'daily') {
    return nextDailyOccurrence(now, dailyTime, timezone);
  }

  if (frequency === 'weekly') {
    const weekday = requireWeekday(schedule.weekday);
    let localDate = localDateAt(now, timezone);
    // Eight candidates: today, then a full week ahead. Today only wins when its
    // wall-clock time is still in the future.
    for (let step = 0; step < 8; step += 1) {
      if (localWeekday(localDate) === weekday) {
        const fireAt = localDateTimeToUtc(localDate, dailyTime, timezone);
        if (fireAt.getTime() > now.getTime()) return { fireAt, localDate };
      }
      localDate = addLocalDays(localDate, 1);
    }
    throw new Error('summary_weekday_invalid');
  }

  if (frequency === 'monthly') {
    const dayOfMonth = requireDayOfMonth(schedule.dayOfMonth);
    const today = parseLocalDate(localDateAt(now, timezone));
    // This month, then the next one. Two candidates are always enough.
    for (let step = 0; step < 2; step += 1) {
      const localDate = monthlyLocalDate(
        today.year,
        today.month + step,
        dayOfMonth,
      );
      const fireAt = localDateTimeToUtc(localDate, dailyTime, timezone);
      if (fireAt.getTime() > now.getTime()) return { fireAt, localDate };
    }
    throw new Error('summary_day_of_month_invalid');
  }

  throw new Error('summary_frequency_invalid');
}

/**
 * The occurrence immediately before the given one — the start of the window a
 * summary reports on.
 *
 * The reported period is `[previous occurrence, this occurrence)`: the stretch
 * that just closed. It is the only rule that reads the same in all three
 * cadences, and it stays correct when the operator changes the cadence, because
 * it is derived from the schedule in force rather than from a stored cursor.
 */
export function previousScheduledOccurrence(
  occurrence: DailyOccurrence,
  schedule: SummarySchedule,
): DailyOccurrence {
  const { frequency, dailyTime, timezone } = schedule;
  const localDate =
    frequency === 'weekly'
      ? addLocalDays(occurrence.localDate, -7)
      : frequency === 'monthly'
        ? previousMonthlyLocalDate(
            occurrence.localDate,
            // The configured day, not the fired one: an occurrence clamped to
            // February 28 still reports the window that opened on January 31.
            typeof schedule.dayOfMonth === 'number'
              ? schedule.dayOfMonth
              : parseLocalDate(occurrence.localDate).day,
          )
        : addLocalDays(occurrence.localDate, -1);

  return {
    localDate,
    fireAt: localDateTimeToUtc(localDate, dailyTime, timezone),
  };
}

export function dailyOccurrenceForDate(
  localDate: string,
  dailyTime: string,
  timezone: string,
): DailyOccurrence {
  return {
    localDate,
    fireAt: localDateTimeToUtc(localDate, dailyTime, timezone),
  };
}

export function localDayBounds(
  localDate: string,
  timezone: string,
): { start: Date; end: Date } {
  return {
    start: localDateTimeToUtc(localDate, '00:00', timezone),
    end: localDateTimeToUtc(addLocalDays(localDate, 1), '00:00', timezone),
  };
}

export function addLocalDays(localDate: string, days: number): string {
  const { year, month, day } = parseLocalDate(localDate);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return formatLocalDate(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
  );
}

/** The weekday name of a calendar date, independent of any timezone. */
export function localWeekday(localDate: string): string {
  const { year, month, day } = parseLocalDate(localDate);
  return WEEKDAY_NAMES[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

function monthlyLocalDate(
  year: number,
  month: number,
  dayOfMonth: number,
): string {
  // `month` may overflow past December; normalizing through Date.UTC keeps the
  // year in step without any modulo arithmetic here.
  const normalized = new Date(Date.UTC(year, month - 1, 1));
  const targetYear = normalized.getUTCFullYear();
  const targetMonth = normalized.getUTCMonth() + 1;
  return formatLocalDate(
    targetYear,
    targetMonth,
    Math.min(Math.max(dayOfMonth, 1), lastDayOfMonth(targetYear, targetMonth)),
  );
}

function previousMonthlyLocalDate(
  localDate: string,
  dayOfMonth: number,
): string {
  const { year, month } = parseLocalDate(localDate);
  return monthlyLocalDate(year, month - 1, dayOfMonth);
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function requireWeekday(value: unknown): string {
  const weekday = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!WEEKDAY_NAMES.includes(weekday as (typeof WEEKDAY_NAMES)[number])) {
    throw new Error('summary_weekday_invalid');
  }
  return weekday;
}

function requireDayOfMonth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error('summary_day_of_month_invalid');
  }
  if (value < 1 || value > 31) {
    throw new Error('summary_day_of_month_invalid');
  }
  return value;
}

function localDateTimeToUtc(
  localDate: string,
  dailyTime: string,
  timezone: string,
): Date {
  const { year, month, day } = parseLocalDate(localDate);
  const time = DAILY_TIME.exec(dailyTime);
  if (!time) throw new Error('daily_time_invalid');
  assertTimezone(timezone);

  return zonedTimeToUtc(
    {
      year,
      month,
      day,
      hour: Number(time[1]),
      minute: Number(time[2]),
    },
    timezone,
  );
}

function localDateAt(date: Date, timezone: string): string {
  assertTimezone(timezone);
  const parts = zonedParts(date, timezone);
  return formatLocalDate(parts.year, parts.month, parts.day);
}

function formatLocalDate(year: number, month: number, day: number): string {
  return [
    year,
    String(month).padStart(2, '0'),
    String(day).padStart(2, '0'),
  ].join('-');
}

function parseLocalDate(value: string): {
  year: number;
  month: number;
  day: number;
} {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error('local_date_invalid');
  const result = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  const canonical = new Date(
    Date.UTC(result.year, result.month - 1, result.day),
  );
  if (
    canonical.getUTCFullYear() !== result.year ||
    canonical.getUTCMonth() + 1 !== result.month ||
    canonical.getUTCDate() !== result.day
  ) {
    throw new Error('local_date_invalid');
  }
  return result;
}

function trimmed(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function assertTimezone(timezone: string): void {
  if (!timezone.trim()) throw new Error('timezone_invalid');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
  } catch {
    throw new Error('timezone_invalid');
  }
}
