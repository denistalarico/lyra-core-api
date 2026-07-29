const DAILY_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface DailyOccurrence {
  fireAt: Date;
  localDate: string;
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
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
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

  const targetAsUtc = Date.UTC(
    year,
    month - 1,
    day,
    Number(time[1]),
    Number(time[2]),
  );
  let candidate = targetAsUtc;

  // Convert the zone's displayed parts back into a UTC scalar and iteratively
  // correct the candidate. Two passes are enough for ordinary offsets; four
  // also covers an offset transition close to midnight.
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const displayed = zonedParts(new Date(candidate), timezone);
    const displayedAsUtc = Date.UTC(
      displayed.year,
      displayed.month - 1,
      displayed.day,
      displayed.hour,
      displayed.minute,
    );
    const correction = targetAsUtc - displayedAsUtc;
    candidate += correction;
    if (correction === 0) break;
  }
  return new Date(candidate);
}

function localDateAt(date: Date, timezone: string): string {
  assertTimezone(timezone);
  const parts = zonedParts(date, timezone);
  return [
    parts.year,
    String(parts.month).padStart(2, '0'),
    String(parts.day).padStart(2, '0'),
  ].join('-');
}

function zonedParts(
  date: Date,
  timezone: string,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const values = new Map(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(values.get('year')),
    month: Number(values.get('month')),
    day: Number(values.get('day')),
    hour: Number(values.get('hour')),
    minute: Number(values.get('minute')),
  };
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

function assertTimezone(timezone: string): void {
  if (!timezone.trim()) throw new Error('timezone_invalid');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
  } catch {
    throw new Error('timezone_invalid');
  }
}
