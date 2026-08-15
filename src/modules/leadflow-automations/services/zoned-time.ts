/**
 * Wall-clock arithmetic in a named time zone.
 *
 * Extracted from the follow-up quiet-hours policy, which was not the only place
 * that needs it: deciding whether the business is open, and when it last closed,
 * is the same question about local time. Keeping one implementation keeps one
 * answer — including the DST correction, which is easy to get subtly wrong twice.
 */
export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const read = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  // Intl renders midnight as hour 24 in some ICU versions.
  const hour = read('hour') % 24;
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour,
    minute: read('minute'),
  };
}

/**
 * The instant at which the given wall-clock time happens in `timeZone`.
 *
 * Two passes: the first guesses with the offset in force at the reference
 * instant, the second corrects it if that guess crossed a DST boundary.
 */
export function zonedTimeToUtc(parts: ZonedParts, timeZone: string): Date {
  const wallClock = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
  );
  let guess = new Date(wallClock - offsetMs(new Date(wallClock), timeZone));
  guess = new Date(wallClock - offsetMs(guess, timeZone));
  return guess;
}

/** The weekday name (`monday` … `sunday`) the instant falls on locally. */
export function zonedWeekday(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimeZone(timeZone),
    weekday: 'long',
  })
    .format(date)
    .toLowerCase();
}

export function safeTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return 'UTC';
  }
}

function offsetMs(date: Date, timeZone: string): number {
  const parts = zonedParts(date, timeZone);
  return (
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) -
    // Seconds and milliseconds are irrelevant to a whole-hour boundary and are
    // dropped on both sides, so the difference is a clean zone offset.
    Math.floor(date.getTime() / 60_000) * 60_000
  );
}
