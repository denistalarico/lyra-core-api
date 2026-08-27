import { shiftDay } from './insights-window';

/** One piece of a backfill, as an inclusive calendar window. */
export type SocialAdBackfillChunk = {
  /**
   * Position in the plan, newest first. `0` is the week that ends at the
   * anchor. It is not stored anywhere — the window is the identity — and
   * exists so a log line can say "chunk 3 of 13" without recomputing.
   */
  index: number;
  since: string;
  until: string;
  /** Inclusive day count: a chunk of one day is `1`. */
  days: number;
};

const MS_PER_DAY = 86_400_000;

/**
 * Cuts a connection's history into the runs that will fetch it.
 *
 * Pure, and deliberately so: this is the function that decides whether a
 * quarter of a client's ad spend has a hole in it, and the property that
 * matters — every day between the first and the anchor appears in exactly one
 * chunk — is a statement about arithmetic that no amount of database fixtures
 * would make more true.
 *
 * ## The anchor, and why the plan is not computed from "today"
 *
 * `anchor` is the newest closed day the plan covers, fixed when the backfill
 * was decided. A plan re-derived from the current day would shift under its own
 * chain: thirteen chunks take longer than a moment, and if the run that starts
 * on Monday computes its boundaries from Monday while the run that continues on
 * Tuesday computes them from Tuesday, the two plans disagree about where each
 * week begins. The result is not a missing day — it is a *sliding* one, where
 * chunk 5 of Monday's plan and chunk 5 of Tuesday's cover different weeks and
 * the day between them belongs to neither. So the anchor is stored where it
 * cannot drift: it is the newest `window_end` among the connection's own
 * backfill runs, which is the first chunk this plan ever produced.
 *
 * ## Newest first
 *
 * Chunk 0 ends at the anchor. A backfill that is interrupted — a dead-lettered
 * chunk, a kill switch, a deploy — has therefore filled in the most recent
 * weeks, which are the ones anybody looks at. Filling the oldest week first
 * would produce a connection with three months of history and a hole where last
 * week should be.
 *
 * ## The last chunk
 *
 * Every chunk but the last covers exactly `chunkDays`. The last is clipped to
 * the horizon, so 90 days in weeks is twelve full weeks and one of six days
 * rather than thirteen weeks and a day of history nobody asked for. Clipping
 * the *last* one is what keeps the boundaries of all the others independent of
 * `totalDays`.
 */
export function planBackfillChunks(input: {
  /** Newest closed day in the plan, `YYYY-MM-DD` in the account's zone. */
  anchor: string;
  totalDays: number;
  chunkDays: number;
}): SocialAdBackfillChunk[] {
  const totalDays = Math.trunc(input.totalDays);
  const chunkDays = Math.trunc(input.chunkDays);

  // A plan of no days is a plan of no chunks, which is how `backfillDays = 0`
  // turns the feature off without a second switch to read.
  if (totalDays <= 0 || chunkDays <= 0) return [];

  const earliest = shiftDay(input.anchor, -(totalDays - 1));
  const chunks: SocialAdBackfillChunk[] = [];

  for (let index = 0; ; index += 1) {
    const until = shiftDay(input.anchor, -index * chunkDays);

    // The previous chunk already reached the horizon. Comparing the dates as
    // text is exact here and everywhere else in this module: `YYYY-MM-DD` sorts
    // chronologically as a string, which is the whole reason the format is used
    // rather than an instant.
    if (until < earliest) break;

    const since = maxDay(earliest, shiftDay(until, -(chunkDays - 1)));

    chunks.push({ index, since, until, days: countDays(since, until) });
  }

  return chunks;
}

/**
 * Inclusive day count between two calendar days.
 *
 * UTC is used as a calendar with no daylight saving in it, never as a timezone:
 * both inputs are already days in the ad account's own zone, and the offsets
 * cancel because they are the same on both sides of the subtraction.
 */
function countDays(since: string, until: string): number {
  return Math.round((dayTime(until) - dayTime(since)) / MS_PER_DAY) + 1;
}

function dayTime(day: string): number {
  const [year, month, date] = day.split('-').map(Number);

  return Date.UTC(year, month - 1, date);
}

function maxDay(left: string, right: string): string {
  return left > right ? left : right;
}
