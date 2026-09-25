import type { SocialAdProvider } from '../entities/social-ad-account-connection.entity';
import type { SocialAdBreakdownKind } from '../entities/social-ad-breakdown-daily.entity';
import type { NormalizedAdBreakdownDaily } from './meta-ads-breakdown.contract';
import type { SocialAdInsightsLevel } from './meta-ads-insights.contract';
import {
  META_ACTION_MAPPING_VERSION,
  readActionMap,
} from './meta-action-mapping';
import { parseAmountText, parseCountText } from './metric-number';

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const OBJECT_ID_PATTERN = /^\d+$/;

/**
 * The shape a stored breakdown key may take.
 *
 * Meta's values for the audience dimensions are lowercase words, digits,
 * hyphens and underscores — `25-34`, `mobile_app`, `instagram`, `65+`,
 * `unknown` — plus the `|` this normalizer joins an age/gender pair with. A
 * value outside this alphabet is not a dimension value this code understands,
 * and storing it would put an unlabelled key in a chart legend.
 *
 * The hourly dimension is the one that does not arrive in this alphabet, and
 * it is folded to one (`h09`) before it gets here rather than by widening the
 * pattern. Widening it to admit spaces and colons would also admit them for
 * every other dimension, where such a value really would mean a payload this
 * code had misread.
 */
const BREAKDOWN_KEY_PATTERN = /^[a-z0-9_+|-]+$/;

/**
 * Meta's rendering of one whole hour: `09:00:00 - 09:59:59`.
 *
 * Anchored on both the start and the end, and on the end's `:59:59`, because
 * the point of matching it is to be sure the row really is one of the 24 whole
 * hours before folding it to a start hour. A range Meta might introduce later
 * that is not a whole hour — half-hours, or a span — would fail this and be
 * skipped and counted, rather than silently collapsing two spans onto one key
 * and doubling that bucket.
 */
const HOURLY_RANGE_PATTERN = /^(\d{2}):00:00 ?- ?(\d{2}):59:59$/;

/** The column's own ceiling; a longer key is a payload this code misread. */
const MAX_BREAKDOWN_KEY_LENGTH = 64;

/** Everything about a pass that a single row cannot learn from its payload. */
export type BreakdownNormalizeContext = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  connectionId: string;
  provider: SocialAdProvider;
  entityLevel: SocialAdInsightsLevel;
  /** `act_<digits>`; the entity id at account level. */
  accountExternalId: string;
  accountTimezone: string;
  currency: string | null;
  breakdownKind: SocialAdBreakdownKind;
  /** Stated by the coordinator, never inferred here from the date. */
  isPartial: boolean;
  syncedAt: Date;
};

/**
 * One breakdown row into one fact, or `null` if it cannot be trusted.
 *
 * The same contract as `normalizeMetricRow`, with one addition that matters
 * more here than there: a row whose **breakdown key** cannot be read is refused.
 *
 * That refusal is the whole reason this is a separate normalizer rather than a
 * parameter on the existing one. An unreadable key has no safe fallback. Folding
 * it into an `unknown` bucket would merge genuinely different audiences under
 * one label — and the number would still be right in total, so nothing about the
 * resulting chart would look wrong. Dropping it is visible in the skip count;
 * mislabelling it is visible nowhere.
 *
 * Absence of a metric stays meaningful and is not a failure, exactly as on the
 * unsplit path: Meta omits a zero entirely, so a missing `inline_link_clicks`
 * really is no link clicks. Missing `reach` remains `null`.
 */
export function normalizeBreakdownRow(
  payload: unknown,
  context: BreakdownNormalizeContext,
): NormalizedAdBreakdownDaily | null {
  if (!payload || typeof payload !== 'object') return null;

  const row = payload as Record<string, unknown>;

  const metricDate = readDay(row.date_start);
  if (!metricDate) return null;

  const entityExternalId = readIdentity(row, context);
  if (!entityExternalId) return null;

  const breakdownKey = readBreakdownKey(row, context.breakdownKind);
  if (!breakdownKey) return null;

  const spend = readAmount(row.spend);
  const impressions = readCount(row.impressions);
  const clicks = readCount(row.clicks);
  const linkClicks = readCount(row.inline_link_clicks);

  if (
    spend === null ||
    impressions === null ||
    clicks === null ||
    linkClicks === null
  ) {
    return null;
  }

  // Present and unreadable is a skip; absent stays null, which is what the
  // column means for a metric that must never be summed — in either direction.
  const reach = row.reach === undefined ? null : parseCountText(row.reach);
  if (row.reach !== undefined && reach === null) return null;

  return {
    tenantId: context.tenantId,
    workspaceId: context.workspaceId,
    agencyClientId: context.agencyClientId,
    connectionId: context.connectionId,
    provider: context.provider,
    entityLevel: context.entityLevel,
    entityExternalId,
    metricDate,
    accountTimezone: context.accountTimezone,
    currency: context.currency,
    breakdownKind: context.breakdownKind,
    breakdownKey,
    spend,
    impressions,
    clicks,
    linkClicks,
    reach,
    /**
     * Both halves of what Meta said, plus the mapping version — the same
     * envelope the unsplit fact stores, so one read path can derive leads and
     * revenue from either table without knowing which it is looking at.
     */
    actions: {
      mappingVersion: META_ACTION_MAPPING_VERSION,
      counts: readActionMap(row.actions),
      values: readActionMap(row.action_values),
    },
    isPartial: context.isPartial,
    syncedAt: context.syncedAt,
  };
}

/**
 * The stored key for this row's dimension, or `null` if it cannot be read.
 *
 * Age and gender arrive as two fields and are joined into one key rather than
 * given two columns. The join is what makes the unique index able to identify a
 * cell of the cross — `25-34|female` — and it is ordered age-first, always, so
 * that the key is derivable from the pair in exactly one way. A second ordering
 * anywhere would produce rows that never collide with the ones already stored.
 *
 * Meta reports `unknown` as a real bucket for each of the audience dimensions,
 * and it is kept: it carries genuine delivery, and dropping it would make the
 * buckets quietly fail to add up to the account total — the one property a
 * reader checks. The hourly dimension has no such bucket, because every
 * impression happened at some hour; a daypart that is simply absent from a
 * day's rows had no delivery, which is a different statement and one the read
 * layer renders as a zero rather than a gap.
 */
function readBreakdownKey(
  row: Record<string, unknown>,
  kind: SocialAdBreakdownKind,
): string | null {
  if (kind === 'age_gender') {
    const age = readKeyPart(row.age);
    const gender = readKeyPart(row.gender);

    if (!age || !gender) return null;

    return bounded(`${age}|${gender}`);
  }

  if (kind === 'device_platform') {
    return bounded(readKeyPart(row.device_platform));
  }

  if (kind === 'hourly') {
    return bounded(
      readHourKey(row.hourly_stats_aggregated_by_audience_time_zone),
    );
  }

  return bounded(readKeyPart(row.publisher_platform));
}

/**
 * Meta's hour range folded to the key this table stores: `h00` … `h23`.
 *
 * The only dimension whose stored key is not the provider's own string, and the
 * only one where that is right. `09:00:00 - 09:59:59` is a *rendering* of an
 * hour, not an identifier for it: it carries three redundant fields, it is 19
 * of the column's 64 characters, and it sorts correctly only by the accident of
 * Meta zero-padding the first digit. `h09` identifies the same bucket, sorts in
 * the order a daypart chart draws, and is re-rendered on read the way every
 * other key in this table is.
 *
 * The `h` prefix is not decoration. A bare `09` would be a key that some
 * consumer eventually reads as the number nine, and the one thing a breakdown
 * key must never be is arithmetic — it is an opaque join value, and the prefix
 * makes that true by construction.
 *
 * An hour outside 00–23, or a range whose two halves disagree, is refused.
 * Meta has never sent either; the check is here because the alternative to
 * refusing is storing a 25th daypart that every chart would draw and no reader
 * could explain.
 */
function readHourKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const match = HOURLY_RANGE_PATTERN.exec(value.trim());
  if (!match) return null;

  const [, start, end] = match;
  if (start !== end) return null;

  const hour = Number(start);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;

  return `h${start}`;
}

/**
 * One dimension field, lowercased and validated against the key alphabet.
 *
 * Lowercasing is the only normalization applied. Meta is consistent about case
 * today, and a value that differed only by case would otherwise become a second
 * bucket for the same audience — two slices of one pie chart with the same
 * label.
 */
function readKeyPart(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const normalized = value.trim().toLowerCase();

  return normalized && BREAKDOWN_KEY_PATTERN.test(normalized)
    ? normalized
    : null;
}

/** A key that would not fit the column is a payload this code misread. */
function bounded(value: string | null): string | null {
  if (value === null) return null;

  return value.length <= MAX_BREAKDOWN_KEY_LENGTH ? value : null;
}

/**
 * What the row is about.
 *
 * At account level the answer is the account the credential is bound to, never
 * anything in the payload — the resolver validated that handle, and taking it
 * from the response would let a redirected read write facts under an id nobody
 * checked.
 *
 * Below the account the id has to come from Meta. Unlike the unsplit normalizer
 * there is no parent to carry: `campaign_external_id` does not exist on this
 * table, so an ad-set row needs only its own id.
 */
function readIdentity(
  row: Record<string, unknown>,
  context: BreakdownNormalizeContext,
): string | null {
  if (context.entityLevel === 'account') return context.accountExternalId;

  if (context.entityLevel === 'campaign') return readObjectId(row.campaign_id);

  return readObjectId(row.adset_id);
}

/** A Meta object id below the account level: bare digits, or nothing. */
function readObjectId(value: unknown): string | null {
  return typeof value === 'string' && OBJECT_ID_PATTERN.test(value)
    ? value
    : null;
}

/** `date_start` as it arrived, or nothing. No parsing, no conversion. */
function readDay(value: unknown): string | null {
  return typeof value === 'string' && DAY_PATTERN.test(value) ? value : null;
}

function readAmount(value: unknown): string | null {
  return value === undefined || value === null ? '0' : parseAmountText(value);
}

function readCount(value: unknown): string | null {
  return value === undefined || value === null ? '0' : parseCountText(value);
}
