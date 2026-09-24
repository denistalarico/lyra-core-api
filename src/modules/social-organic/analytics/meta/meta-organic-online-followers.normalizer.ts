import type { NormalizedOrganicOnlineFollowers } from '../social-organic-online-followers.contract';

/**
 * Raised when the response is not the shape this parser understands.
 *
 * Its own class, mirroring `MetaOrganicAudienceNormalizationError`: a malformed
 * payload is a provider-contract problem, distinct from the queue-plan refusals
 * `SocialOrganicSyncError` carries, and the sync worker treats the two
 * differently.
 */
export class MetaOrganicOnlineFollowersNormalizationError extends Error {
  readonly code = 'meta_invalid_response';

  constructor() {
    super('meta_invalid_response');
    this.name = 'MetaOrganicOnlineFollowersNormalizationError';
  }
}

/**
 * Instagram's `online_followers` into one row per day and hour.
 *
 * ## The shape Meta answers with
 *
 * A single metric entry whose `values` is an array of days, each
 * `{ value: { "0": 37, "1": 69, ... "23": 24 }, end_time: "...T07:00:00+0000" }`.
 * The map's keys are hours 0–23 **in Pacific time**, which is what that
 * `07:00:00+0000` encodes: midnight PST. Both are stored as Meta stated them;
 * see the entity for why the conversion belongs to the read layer.
 *
 * ## An empty day is skipped, not zeroed
 *
 * Meta sends `value: {}` for days it has nothing for — the most recent day is
 * routinely empty, and the whole response is empty when `since`/`until` are
 * omitted. Writing 24 zeros for such a day would put a confident trough in the
 * chart at whatever hour the account was actually most active. It produces no
 * rows instead, and the absence shows as a gap.
 *
 * A malformed payload is a different matter and fails the sync: a `values` that
 * is not an array, or an entry without a usable `end_time`, means the response
 * is not what this parser understands, and guessing would file readings under
 * the wrong day.
 */
export function normalizeInstagramOnlineFollowers(input: {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  assetId: string;
  provider: string;
  assetTimezone: string;
  observedAt: Date;
  syncedAt: Date;
  syncRunId: string;
  insights: unknown;
}): NormalizedOrganicOnlineFollowers[] {
  const metric = readMetric(input.insights);

  if (!metric) return [];

  const values: unknown = metric.values;

  if (!Array.isArray(values)) invalid();

  const rows: NormalizedOrganicOnlineFollowers[] = [];

  for (const entry of values as unknown[]) {
    if (!isRecord(entry)) invalid();

    const metricDate = readPacificDay(entry.end_time);

    if (!metricDate) invalid();

    const hours: unknown = entry.value;

    // `{}` is Meta's "no data for this day", which is an absence and not a day
    // on which nobody was online.
    if (!isRecord(hours)) continue;

    for (const [rawHour, rawCount] of Object.entries(hours)) {
      const hourOfDay = readHour(rawHour);
      const followersOnline = readCount(rawCount);

      if (hourOfDay === null || followersOnline === null) continue;

      rows.push({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        agencyClientId: input.agencyClientId,
        assetId: input.assetId,
        provider: input.provider,
        metricDate,
        hourOfDay,
        assetTimezone: input.assetTimezone,
        sourceTimezone: ONLINE_FOLLOWERS_SOURCE_TIMEZONE,
        followersOnline,
        observedAt: input.observedAt,
        syncedAt: input.syncedAt,
        syncRunId: input.syncRunId,
      });
    }
  }

  return rows;
}

/**
 * The timezone Meta indexes this metric in.
 *
 * Not the account's, and not configurable: Meta states these hours in Pacific
 * time for every account, which is why every row carries this same value and
 * why the read layer is what converts.
 */
export const ONLINE_FOLLOWERS_SOURCE_TIMEZONE = 'America/Los_Angeles';

/**
 * The Pacific calendar day an `end_time` denotes.
 *
 * Meta stamps each day at `07:00:00+0000`, which is midnight Pacific *in
 * standard time*; during daylight saving the same midnight is `06:00:00+0000`.
 * Rather than special-casing either offset, the instant is shifted into Pacific
 * and the calendar date read there — which is right under both offsets, and
 * stays right if Meta changes the hour it stamps.
 */
function readPacificDay(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) return null;

  // `en-CA` renders as `YYYY-MM-DD`, which is the format the column takes.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ONLINE_FOLLOWERS_SOURCE_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(parsed);
}

function readHour(value: string): number | null {
  if (!/^\d{1,2}$/.test(value)) return null;

  const hour = Number(value);

  return hour >= 0 && hour <= 23 ? hour : null;
}

/** A follower count as the digit string the `bigint` column takes. */
function readCount(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }

  return Math.trunc(value).toString();
}

function readMetric(payload: unknown): Record<string, unknown> | null {
  if (!isRecord(payload)) invalid();

  const data: unknown = payload.data;

  if (!Array.isArray(data)) invalid();

  for (const entry of data as unknown[]) {
    if (isRecord(entry) && entry.name === 'online_followers') return entry;
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(): never {
  throw new MetaOrganicOnlineFollowersNormalizationError();
}
