import { zonedParts, zonedTimeToUtc, zonedWeekday } from './zoned-time';

/**
 * The weekly schedule that decides whether the business is open.
 *
 * The shape is the one the Inbox settings already persist — the same object
 * `evaluateBusinessHours` reads — so an automation carrying its own schedule
 * carries it in the workspace's own vocabulary rather than a second dialect
 * that would have to be translated at every read.
 */
export interface BusinessHoursDaySchedule {
  day: string;
  enabled: boolean;
  /** `HH:MM`, local to the schedule's time zone. */
  start: string;
  end: string;
}

export interface BusinessHoursSchedule {
  enabled: boolean;
  timezone: string;
  days: BusinessHoursDaySchedule[];
}

export const BUSINESS_HOURS_WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isBusinessHoursTime(value: unknown): value is string {
  return typeof value === 'string' && TIME_PATTERN.test(value);
}

/**
 * Reads a stored schedule, or `null` when there is nothing usable to read.
 *
 * Lenient about what it accepts and strict about what it returns: a row written
 * before a field existed, or a day naming a weekday nobody recognises, must not
 * make the whole schedule unreadable — but a schedule with no usable day is
 * reported as absent, because guessing "always closed" would answer every lead
 * with the out-of-hours message.
 */
export function normalizeBusinessHoursSchedule(
  value: unknown,
): BusinessHoursSchedule | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.days)) return null;

  const days: BusinessHoursDaySchedule[] = [];
  for (const entry of raw.days) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const day = entry as Record<string, unknown>;
    const key = typeof day.day === 'string' ? day.day.toLowerCase() : null;
    if (!key || !BUSINESS_HOURS_WEEKDAYS.includes(key as never)) continue;
    if (days.some((item) => item.day === key)) continue;
    const enabled = day.enabled !== false;
    const start = isBusinessHoursTime(day.start) ? day.start : null;
    const end = isBusinessHoursTime(day.end) ? day.end : null;
    // An open day with no hours says nothing about when it is open.
    if (enabled && (!start || !end)) continue;
    days.push({
      day: key,
      enabled,
      start: start ?? '',
      end: end ?? '',
    });
  }

  if (days.length === 0) return null;

  return {
    enabled: raw.enabled !== false,
    timezone:
      typeof raw.timezone === 'string' && raw.timezone.trim()
        ? raw.timezone
        : 'UTC',
    days,
  };
}

/**
 * When the business last closed, at or before `now`.
 *
 * This is the identity of the current out-of-hours stretch, and it is what
 * makes "answer once" possible: a lead who sends four messages at midnight is
 * inside one window and gets one reply, and the same window covers a handoff
 * requested at 23:00 and a message that follows it at 00:10 — a calendar date
 * would have split those two into separate nights.
 *
 * Returns `null` when the schedule has no closing time to point at (every day
 * disabled, or none of the last eight days recognised), which the caller must
 * treat as "no window", never as "a window starting now".
 */
export function resolveClosedWindowStart(
  schedule: BusinessHoursSchedule,
  now: Date,
): Date | null {
  const byDay = new Map(schedule.days.map((day) => [day.day, day]));

  for (let offset = 0; offset <= 7; offset += 1) {
    const probe = new Date(now.getTime() - offset * 24 * 60 * 60 * 1_000);
    const entry = byDay.get(zonedWeekday(probe, schedule.timezone));
    // A closed day never ends the working day; the last close is earlier.
    if (!entry || !entry.enabled || !isBusinessHoursTime(entry.end)) continue;

    const [hour, minute] = entry.end.split(':').map(Number);
    const parts = zonedParts(probe, schedule.timezone);
    const close = zonedTimeToUtc({ ...parts, hour, minute }, schedule.timezone);
    if (close.getTime() <= now.getTime()) return close;
  }

  return null;
}
