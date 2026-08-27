import type { SocialAdEntityLevel } from '../entities/social-ad-entity.entity';

/**
 * What a run is for.
 *
 * Three kinds, and the distinction each one earns:
 *
 * - `entities` — the ad hierarchy alone. No date window, because objects have
 *   no date dimension; a caller who only needs the mirror refreshed should not
 *   pay for a 90-day insights read.
 * - `manual`   — a person asked for this window, now. Hierarchy first, then
 *   insights, because a campaign that appears in today's facts and not in the
 *   mirror shows up in the UI as an id.
 * - `daily`    — the scheduler asked for it, on the account's own morning.
 *
 * `manual` and `daily` execute the identical pipeline and are still separate
 * values: the run table is the log anyone reads to answer "why is yesterday
 * missing?", and a scheduled run filed under `manual` makes that question
 * unanswerable. `requested_by_id` is not a substitute — it is NULL for both a
 * scheduled run and a run enqueued by a system caller.
 */
export type SocialAdSyncRunKind = 'entities' | 'manual' | 'daily';

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
  | 'campaign_insights';

/**
 * What each kind executes, in order.
 *
 * Ordered, not a set: hierarchy before insights so facts land against a mirror
 * that already knows the campaign, and account insights before campaign
 * insights because the account totals are the cheapest read and the ones every
 * campaign sum is checked against.
 */
export const SYNC_SEGMENTS_BY_KIND: Record<
  SocialAdSyncRunKind,
  readonly SocialAdSyncSegment[]
> = {
  entities: ['hierarchy'],
  manual: ['hierarchy', 'account_insights', 'campaign_insights'],
  daily: ['hierarchy', 'account_insights', 'campaign_insights'],
};

/**
 * The hierarchy levels a run touches.
 *
 * All four for every kind, because every kind starts with the hierarchy sweep,
 * which reads all four. Insights cover a subset (account and campaign) and do
 * not widen this list — the column names what the run *covers*, and a level
 * listed twice for two different reasons would not be more true.
 */
export const SYNC_ENTITY_LEVELS: readonly SocialAdEntityLevel[] = [
  'account',
  'campaign',
  'adset',
  'ad',
];

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
 */
export function buildSyncIdempotencyKey(input: {
  connectionId: string;
  runKind: SocialAdSyncRunKind;
  windowStart: string | null;
  windowEnd: string | null;
  entityLevels: readonly SocialAdEntityLevel[];
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
  ].join(':');
}
