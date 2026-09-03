import type { SocialAdEntityLevel } from '../entities/social-ad-entity.entity';
import type { SocialAdInsightsLevel } from './meta-ads-insights.contract';

/**
 * What a run is for.
 *
 * Five kinds, and the distinction each one earns:
 *
 * - `entities`  — the ad hierarchy alone. No date window, because objects have
 *   no date dimension; a caller who only needs the mirror refreshed should not
 *   pay for a 90-day insights read.
 * - `manual`    — a person asked for this window, now. Hierarchy first, then
 *   insights, because a campaign that appears in today's facts and not in the
 *   mirror shows up in the UI as an id.
 * - `daily`     — the scheduler asked for it, on the account's own morning.
 * - `backfill`  — one chunk of the initial history sweep. Closed days, like
 *   `daily`, and deliberately a separate value: a connection's first ninety
 *   days arrive as a dozen runs, and filing them under `daily` would make the
 *   morning's own run impossible to find in the list it shares with them.
 * - `intraday`  — today, while today is still running. The only kind that
 *   writes `is_partial = true`, and the only one whose window is *not* closed.
 *
 * `manual` and `daily` execute the identical pipeline and are still separate
 * values: the run table is the log anyone reads to answer "why is yesterday
 * missing?", and a scheduled run filed under `manual` makes that question
 * unanswerable. `requested_by_id` is not a substitute — it is NULL for both a
 * scheduled run and a run enqueued by a system caller.
 *
 * The column is a plain `varchar(40)` with no CHECK — S2.2 left the vocabulary
 * to the runtime on purpose — so adding these two cost no migration. This type
 * is the vocabulary; the worker's plan lookup is what refuses anything else.
 */
export type SocialAdSyncRunKind =
  | 'entities'
  | 'manual'
  | 'daily'
  | 'backfill'
  | 'intraday';

/**
 * The kinds whose window is a day the ad account has already finished.
 *
 * Everything except `intraday`. Membership decides two things that must never
 * disagree: which assertion guards the window at execution, and what
 * `is_partial` is written as. Deriving both from one list is what keeps a run
 * from being validated as closed and then stored as open, or the reverse.
 */
export const CLOSED_WINDOW_RUN_KINDS: readonly SocialAdSyncRunKind[] = [
  'manual',
  'daily',
  'backfill',
];

/** Whether a run of this kind writes facts for a day still in progress. */
export function isIntradayRunKind(runKind: string): boolean {
  return runKind === 'intraday';
}

/**
 * One unit of work inside a run, and the unit a retry resumes from.
 *
 * Segments are the grain at which failure is recorded, so they are drawn where
 * failure actually differs: the hierarchy read hits different Graph edges from
 * the insights read, and the campaign-level insights read is the expensive one
 * that a rate limit lands on first.
 */
export type SocialAdSyncSegment =
  | 'hierarchy'
  | 'account_insights'
  | 'campaign_insights'
  | 'adset_insights';

/**
 * The insights level each insights segment reads.
 *
 * A total map rather than a conditional at the call site. The worker used to
 * decide this with `segment === 'account_insights' ? 'account' : 'campaign'`,
 * which was correct while there were exactly two insights segments and became
 * wrong the moment a third existed — it would have read `adset_insights` at
 * campaign level and written campaign rows under an ad set segment's name. A
 * map keyed by the union makes the compiler, rather than a reviewer, the thing
 * that notices the next one.
 */
export const INSIGHTS_LEVEL_BY_SEGMENT = {
  account_insights: 'account',
  campaign_insights: 'campaign',
  adset_insights: 'adset',
} as const satisfies Record<
  Exclude<SocialAdSyncSegment, 'hierarchy'>,
  SocialAdInsightsLevel
>;

/** Whether a segment is an insights read, narrowing it for the map above. */
export function isInsightsSegment(
  segment: SocialAdSyncSegment,
): segment is Exclude<SocialAdSyncSegment, 'hierarchy'> {
  return segment !== 'hierarchy';
}

/**
 * What each kind executes, in order.
 *
 * Ordered, not a set: hierarchy before insights so facts land against a mirror
 * that already knows the campaign, and the insights levels from cheapest and
 * coarsest downward — the account totals are the ones every finer sum is
 * checked against, and ad set is both the largest read and the one whose
 * failure costs the least, because the coarser levels have already landed.
 */
export const SYNC_SEGMENTS_BY_KIND: Record<
  SocialAdSyncRunKind,
  readonly SocialAdSyncSegment[]
> = {
  entities: ['hierarchy'],
  manual: [
    'hierarchy',
    'account_insights',
    'campaign_insights',
    'adset_insights',
  ],
  daily: [
    'hierarchy',
    'account_insights',
    'campaign_insights',
    'adset_insights',
  ],
  /**
   * No hierarchy, on both of the kinds the scheduler repeats.
   *
   * A backfill is thirteen chunks of one account's history, and the hierarchy
   * is the same tree for all thirteen — sweeping it per chunk would read the
   * account's 450-odd objects thirteen times to learn nothing new after the
   * first. The chain enqueues one `entities` run ahead of the chunks instead,
   * which also gives that sweep its own row, its own retry and its own line in
   * the history.
   *
   * Intraday leaves it out for the same reason from the other direction: it
   * runs up to six times a day, and the hierarchy has no intraday dimension.
   * A campaign created this morning still gets its spend recorded — the facts
   * table has no foreign key to the mirror precisely so that it can — and the
   * account's own daily run adds it to the mirror the next morning.
   */
  backfill: ['account_insights', 'campaign_insights', 'adset_insights'],
  /**
   * Intraday reads all three levels, and the cost was measured before it did.
   *
   * An intraday pass is one day, so each level is a single Graph request
   * regardless of how many objects delivered — the ad-set read of this
   * account's busiest week returned one page, and a day is a seventh of that.
   * The pass goes from two requests to three: an hourly-bucketed schedule at
   * the default 3-hour interval spends six more requests per connection per day
   * against a quota measured in CPU-seconds, which the account-level probe
   * showed this account barely registers on.
   *
   * The alternative — ad set on `daily` only — was rejected on what it would do
   * to the product rather than on cost: destination is an ad-set property, so
   * excluding ad set here would make every per-destination number blind to
   * today, and "spend by WhatsApp" would silently stop at yesterday while the
   * account-level total beside it included this morning.
   */
  intraday: ['account_insights', 'campaign_insights', 'adset_insights'],
};

/**
 * The hierarchy levels a run touches.
 *
 * All four for the kinds that start with a hierarchy sweep, which reads all
 * four. Insights cover a subset and do not widen this list — the column names
 * what the run *covers*, and a level listed twice for two different reasons
 * would not be more true.
 */
export const SYNC_ENTITY_LEVELS: readonly SocialAdEntityLevel[] = [
  'account',
  'campaign',
  'adset',
  'ad',
];

/**
 * What an insights-only run covers.
 *
 * The levels the insights pipeline ingests, and the honest answer for a
 * `backfill` chunk or an `intraday` pass: neither reads the hierarchy, so
 * claiming `ad` would describe work the run does not do. It is also part of
 * their idempotency key, which is why it is a constant rather than an argument
 * — a caller that could pass a different list would produce a second key for
 * one intent.
 *
 * ## This constant is the coverage record
 *
 * I3.4 added `adset` here, and that single edit is what makes every backfill
 * run written before I3.4 read as *not* covering ad set — because those rows
 * stored `["account","campaign"]` in `entity_levels`, which is exactly what
 * they did. The planner compares a chunk's stored levels against this list, so
 * a connection whose thirteen chunks all succeeded under the old list is
 * correctly seen as needing ad-set history, and a connection backfilled after
 * I3.4 is correctly seen as needing nothing.
 *
 * That is why no new `run_kind`, no `coverage_version` column and no migration
 * were introduced: the durable, per-run record of "which levels did this run
 * actually read" already existed and was already written on every row. It was
 * simply never read back. Adding a version number beside it would be a second
 * answer to a question this column already answers, and the two would disagree
 * the first time one of them was updated alone.
 */
export const INSIGHTS_ENTITY_LEVELS: readonly SocialAdEntityLevel[] = [
  'account',
  'campaign',
  'adset',
];

/**
 * Whether a settled run actually covered every insights level we now ingest.
 *
 * The whole of I3.4's coverage logic, in one predicate, and it answers a
 * question that has exactly one honest source: what the run *recorded that it
 * read*. Not what facts exist — a connection can hold ad-set rows for eighty of
 * ninety days because somebody ran a manual sync last week, and the other ten
 * days are indistinguishable from ten days nothing delivered, because Meta
 * returns no row for either. That is the same argument the planner already makes
 * about facts in general, and widening the levels does not weaken it.
 *
 * `entity_levels` is a `jsonb` column, so it is whatever was written to it: a
 * value that is not an array of known levels is treated as covering nothing,
 * which fails closed. A run that read *more* than the current list still counts
 * — the test is coverage, not equality — so shrinking the list later would not
 * retroactively invalidate history.
 */
export function coversInsightsLevels(
  entityLevels: unknown,
  required: readonly SocialAdEntityLevel[] = INSIGHTS_ENTITY_LEVELS,
): boolean {
  if (!Array.isArray(entityLevels)) return false;

  const covered = new Set(
    entityLevels.filter((level): level is string => typeof level === 'string'),
  );

  return required.every((level) => covered.has(level));
}

/** Default retry ceiling, matching the column's own default. */
export const SOCIAL_AD_SYNC_MAX_ATTEMPTS = 5;

/**
 * How long a claim is good for.
 *
 * Long enough that a legitimate 90-day campaign-level run finishes inside it —
 * the proven ingest takes seconds, and the ceiling is sixty Graph pages at a
 * 30s timeout each — and short enough that a worker killed mid-run does not
 * park its connection for an hour.
 */
export const SOCIAL_AD_SYNC_LEASE_MS = 10 * 60_000;

/**
 * A segment that did not complete, reduced to what is safe to store.
 *
 * One meaning in both places it is written: *what this run has not done*. On a
 * run that went back to `queued` that list is the plan the next claim executes;
 * on a run that ended `partial` the same list is the record of what is missing,
 * and nothing re-executes it because nothing claims a settled run. The list
 * does not change meaning — the run's status does.
 *
 * Two fields, and deliberately no third. `errorCode` comes from the same
 * classifier the HTTP mapper uses, so it is a name for a condition and never a
 * provider string: Meta's messages carry account ids and occasionally fragments
 * of the request URL, and this column is read back into the settings UI. No
 * stack trace either — a stack is a file path and a line number, which tells an
 * operator nothing and tells a reader of the log where the code lives.
 */
export type SocialAdSyncFailedSegment = {
  segment: SocialAdSyncSegment;
  errorCode: string;
};

/**
 * The identity of an *intent*, which is not the identity of a row.
 *
 * This is what the partial unique index compares, so two enqueues that mean the
 * same thing collapse into one run instead of two workers racing over the same
 * window. Everything that changes what the run would *do* is in the key, and
 * nothing that does not: no timestamp, no random suffix, no requester. A key
 * with a clock in it would deduplicate nothing, which is the failure mode this
 * exists to prevent — a scheduler that retries its tick and a person clicking
 * "sync now" twice would both produce a second reader of the same days.
 *
 * The connection id is included even though the index already keys on it. The
 * key travels into logs and into the runs list, where a value that identifies
 * itself is worth more than four saved characters.
 *
 * `bucket` is the one dimension that is not part of *what would be read*, and
 * it exists for the single case where that is not enough. Every intraday pass
 * of one day asks for the identical window — `since = until = today` — so
 * without it the 09:00 snapshot and the 12:00 snapshot are one intent, and the
 * second is deduplicated against a run that has already settled. It is a
 * derived label for a period of the account's own day, never a clock reading:
 * a timestamp here would deduplicate nothing, which is the failure this whole
 * function exists to prevent.
 */
export function buildSyncIdempotencyKey(input: {
  connectionId: string;
  runKind: SocialAdSyncRunKind;
  windowStart: string | null;
  windowEnd: string | null;
  entityLevels: readonly SocialAdEntityLevel[];
  bucket?: string | null;
}): string {
  // Sorted so two callers listing the same levels in different orders produce
  // one key. An unsorted list would make ["account","campaign"] and
  // ["campaign","account"] two different intents describing one read.
  const levels = [...input.entityLevels].sort().join('+');

  return [
    input.connectionId,
    input.runKind,
    input.windowStart ?? '-',
    input.windowEnd ?? '-',
    levels,
    // Omitted entirely when absent rather than joined as a placeholder: every
    // key written before this parameter existed must keep its exact spelling,
    // or the scheduler's "has today's run already settled?" question would
    // stop matching yesterday's rows the day this ships.
    ...(input.bucket ? [input.bucket] : []),
  ].join(':');
}
