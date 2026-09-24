/**
 * "Melhor dia para postagem" and "melhor horário para postagens".
 *
 * Both are read from one stored grid of hourly online-follower counts — see
 * `SocialOrganicOnlineFollowersEntity`. This file holds the shapes the charts
 * consume and the timezone conversion that stands between the stored hour and
 * the one a person should read.
 */

/**
 * The average number of followers online in one hour of the day.
 *
 * `hour` is 0–23 **in the asset's own timezone**, converted from the Pacific
 * hour Meta indexes the metric by. `sampleDays` is how many days contributed to
 * the average, so a chart can grey out an hour that only one day supports.
 */
export type SocialOrganicActivityHourPoint = {
  hour: number;
  /** Mean followers online, as a decimal string. */
  average: string;
  sampleDays: number;
};

/**
 * The average number of followers online across one weekday.
 *
 * `weekday` is 0 = Sunday through 6 = Saturday, matching `Date.getUTCDay`, in
 * the asset's own timezone.
 */
export type SocialOrganicActivityWeekdayPoint = {
  weekday: number;
  /** Mean followers online across that weekday's hours, as a decimal string. */
  average: string;
  sampleDays: number;
};

/**
 * When this account's followers are online.
 *
 * ## Why both charts come from one response
 *
 * They are two readings of the same grid: the best hour is it averaged down the
 * columns, the best weekday averaged across the rows. Splitting them into two
 * endpoints would double the work and let the two answers describe different
 * windows.
 *
 * ## Averages, never sums
 *
 * Every figure here is a mean, because the underlying counts are a stock: a
 * follower online at 14:00 and 15:00 is one person in two rows, so a sum is not
 * a number of people. Comparing means between hours or weekdays is the only
 * operation the data supports, and it is the only one the charts do.
 *
 * ## The window is Meta's, not the dashboard's
 *
 * Meta serves roughly the last 30 days of this metric and nothing older,
 * whatever period the report asks for. `windowSince`/`windowUntil` state what
 * was actually averaged so the chart can label itself honestly instead of
 * inheriting the dashboard's heading.
 */
export type SocialOrganicActivityView = {
  assetId: string;
  /** The zone the hours and weekdays below are expressed in. */
  timezone: string;
  /** The zone Meta indexed them in before conversion — Pacific. */
  sourceTimezone: string;

  /** The days actually averaged, which Meta's retention decides. */
  windowSince: string | null;
  windowUntil: string | null;
  daysCovered: number;

  /**
   * False when nothing has been collected yet. Distinct from an all-zero grid,
   * which would be a real answer about an account nobody follows.
   */
  hasData: boolean;

  /** 24 points, always, ascending — an hour with no sample carries `"0"`. */
  hours: SocialOrganicActivityHourPoint[];
  /** 7 points, always, Sunday first. */
  weekdays: SocialOrganicActivityWeekdayPoint[];
};

/**
 * Converts one Pacific day-and-hour into the asset's own day-and-hour.
 *
 * ## Why this is not an offset subtraction
 *
 * The tempting version adds a fixed difference — São Paulo is "4 hours ahead of
 * Pacific" — and it is wrong twice a year in each zone, because the two observe
 * daylight saving on different dates. For several weeks the gap is 4 hours and
 * for the rest it is 5, and a chart built on the wrong one names the wrong peak
 * hour, which is precisely the decision this chart exists to inform.
 *
 * So the Pacific wall-clock time is resolved to a real instant and that instant
 * is then formatted in the target zone. Both conversions go through the IANA
 * database, which knows the rules for both zones on that date.
 *
 * ## Resolving the instant
 *
 * `Date.parse` cannot read "08:00 Pacific" directly, so the instant is found by
 * guessing UTC and correcting: format the guess in Pacific, measure how far it
 * lands from the wanted wall-clock time, and shift by the difference.
 *
 * The correction **iterates**, and that is not defensive padding. A single pass
 * is wrong for every hour after a DST transition, not merely the hour that
 * moves: the first guess lands on the far side of the change, so it is
 * corrected by the old offset and misses by an hour. Measured over four sample
 * days it left 15 of 96 hours shifted — enough to move the reported peak. Two
 * passes converge everywhere except the hour spring-forward deletes, where
 * 02:00 resolves to 03:00, which is the honest answer for a wall-clock time
 * that does not occur.
 */
export function convertPacificHour(
  metricDate: string,
  hourOfDay: number,
  sourceTimezone: string,
  targetTimezone: string,
): { date: string; hour: number; weekday: number } {
  const instant = resolveInstant(metricDate, hourOfDay, sourceTimezone);
  const parts = readZonedParts(instant, targetTimezone);

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: parts.hour,
    // Derived from the converted calendar day rather than carried over from the
    // source: crossing midnight changes the weekday, and that is the whole
    // point of converting — an hour that is Friday in Pacific can be Saturday
    // where the audience actually is.
    weekday: new Date(
      `${parts.year}-${parts.month}-${parts.day}T00:00:00Z`,
    ).getUTCDay(),
  };
}

/**
 * The UTC instant at which `timeZone`'s wall clock reads the given time.
 *
 * Three passes at most: two suffice for every zone in the IANA database, and
 * the loop exits as soon as the drift is zero, so a normal day costs one
 * comparison. The bound is what keeps a hypothetical non-converging zone from
 * spinning rather than a number of passes anyone needs.
 */
function resolveInstant(date: string, hour: number, timeZone: string): Date {
  const wanted = Date.parse(`${date}T${String(hour).padStart(2, '0')}:00:00Z`);
  let instant = wanted;

  for (let pass = 0; pass < 3; pass += 1) {
    const seen = readZonedParts(new Date(instant), timeZone);
    const seenAsUtc = Date.parse(
      `${seen.year}-${seen.month}-${seen.day}T${String(seen.hour).padStart(2, '0')}:${String(seen.minute).padStart(2, '0')}:00Z`,
    );
    const drift = wanted - seenAsUtc;

    if (drift === 0) break;
    instant += drift;
  }

  return new Date(instant);
}

function readZonedParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(instant);

  const read = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? '';

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    // `hour12: false` yields "24" for midnight in some ICU versions; both
    // spellings mean hour zero.
    hour: Number(read('hour')) % 24,
    minute: Number(read('minute')),
  };
}
