import { FOLLOWUP_QUIET_HOURS } from '../catalog/followup-plan.catalog';

/**
 * When a follow-up attempt may actually reach the lead.
 *
 * The old behaviour was to check the workspace's business hours at fire time
 * and, when outside them, return — which dropped the attempt *and* the rest of
 * the chain with it, since the next attempt is only scheduled after a delivery.
 * A quiet-hours policy has to move an attempt, never delete it.
 *
 * Which direction it moves in is not a detail:
 *
 *  - d0/d1 answer inside the WhatsApp 24-hour window, and the window is a
 *    deadline. Waiting for the morning can close it, turning a free-text reply
 *    into a template that needs approval. So these attempts are **anticipated**:
 *    the last allowed instant at or before the due time (20:00 the evening
 *    before, rather than 03:00).
 *  - d3/d7 are already outside any window and go out on a template, so there is
 *    no deadline to protect. They are simply **postponed** to the next 07:00.
 *
 * Anticipation that lands in the past — a timer that fired late, a chain armed
 * at dawn — falls back to postponing. Late is a nuisance; 03:00 is a complaint.
 */
export interface FollowupSendWindowInput {
  /** When the attempt is due by the cadence. */
  dueAt: Date;
  now: Date;
  timeZone: string;
  respectQuietHours: boolean;
  /** True for the attempts that answer inside the messaging window (d0/d1). */
  allowAnticipation: boolean;
}

export function resolveFollowupSendAt(input: FollowupSendWindowInput): Date {
  const target = laterOf(input.dueAt, input.now);
  if (!input.respectQuietHours) return target;
  if (isInsideQuietWindow(target, input.timeZone)) return target;

  if (input.allowAnticipation) {
    const anticipated = previousWindowClose(target, input.timeZone);
    if (anticipated.getTime() >= input.now.getTime()) return anticipated;
  }
  return nextWindowOpen(target, input.timeZone);
}

export function isInsideQuietWindow(date: Date, timeZone: string): boolean {
  const { hour } = zonedParts(date, timeZone);
  return hour >= FOLLOWUP_QUIET_HOURS.startHour &&
    hour < FOLLOWUP_QUIET_HOURS.endHour;
}

/** The most recent window close (20:00 local) at or before `date`. */
function previousWindowClose(date: Date, timeZone: string): Date {
  const parts = zonedParts(date, timeZone);
  const sameDay = zonedTimeToUtc(
    { ...parts, hour: FOLLOWUP_QUIET_HOURS.endHour, minute: 0 },
    timeZone,
  );
  if (sameDay.getTime() <= date.getTime()) return sameDay;
  const previous = zonedParts(
    new Date(date.getTime() - 24 * 60 * 60 * 1_000),
    timeZone,
  );
  return zonedTimeToUtc(
    { ...previous, hour: FOLLOWUP_QUIET_HOURS.endHour, minute: 0 },
    timeZone,
  );
}

/** The next window open (07:00 local) at or after `date`. */
function nextWindowOpen(date: Date, timeZone: string): Date {
  const parts = zonedParts(date, timeZone);
  const sameDay = zonedTimeToUtc(
    { ...parts, hour: FOLLOWUP_QUIET_HOURS.startHour, minute: 0 },
    timeZone,
  );
  if (sameDay.getTime() >= date.getTime()) return sameDay;
  const next = zonedParts(
    new Date(date.getTime() + 24 * 60 * 60 * 1_000),
    timeZone,
  );
  return zonedTimeToUtc(
    { ...next, hour: FOLLOWUP_QUIET_HOURS.startHour, minute: 0 },
    timeZone,
  );
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function zonedParts(date: Date, timeZone: string): ZonedParts {
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
function zonedTimeToUtc(parts: ZonedParts, timeZone: string): Date {
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

function offsetMs(date: Date, timeZone: string): number {
  const parts = zonedParts(date, timeZone);
  return (
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
    ) -
    // Seconds and milliseconds are irrelevant to a whole-hour boundary and are
    // dropped on both sides, so the difference is a clean zone offset.
    Math.floor(date.getTime() / 60_000) * 60_000
  );
}

function safeTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return 'UTC';
  }
}

function laterOf(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}
