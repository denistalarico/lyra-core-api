import type { SocialAdProvider } from '../entities/social-ad-account-connection.entity';
import type {
  SocialAdAttributionSetting,
  SocialAdMetricSource,
} from '../entities/social-ad-metric-daily.entity';
import type {
  NormalizedAdMetricDaily,
  SocialAdInsightsLevel,
} from './meta-ads-insights.contract';
import {
  META_ACTION_MAPPING_VERSION,
  deriveActionFacts,
  readActionMap,
} from './meta-action-mapping';
import { parseAmountText, parseCountText } from './metric-number';

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** Meta object ids are bare digits below the account level. */
const OBJECT_ID_PATTERN = /^\d+$/;

/** Everything about a run that a single row cannot learn from its payload. */
export type InsightsNormalizeContext = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  connectionId: string;
  provider: SocialAdProvider;
  source: SocialAdMetricSource;
  attributionSetting: SocialAdAttributionSetting;
  entityLevel: SocialAdInsightsLevel;
  /** `act_<digits>`; the entity id at account level. */
  accountExternalId: string;
  accountTimezone: string;
  currency: string | null;
  /**
   * Whether the day this row describes was still running when it was read.
   *
   * Stated by the coordinator, never inferred here from the date. The
   * temptation is obvious — compare `date_start` to today in the account's zone
   * — and it is wrong in both directions at the only moment it matters. A
   * backfill of a settled day executed at 00:02 local would see its own window
   * as "recent" and mark ninety final days provisional; an intraday pass that
   * started at 23:59 and returned at 00:01 would see today as yesterday and
   * stamp an unfinished day as final. The run knows which mode it is, the row
   * does not, and only one of them can be right.
   */
  isPartial: boolean;
  syncedAt: Date;
};

/**
 * One Insights row into one fact, or `null` if it cannot be trusted.
 *
 * The `null` is the important half. Three things make a row unusable — no
 * readable day, no object to attribute it to, or a numeric field that is
 * present and unparseable — and all three return `null` so the caller can count
 * a skip. The alternative, substituting a zero, produces a row that is
 * indistinguishable from a real day with no delivery: it sums into totals, it
 * renders on charts, and nothing about it says it was invented.
 *
 * Absence, by contrast, is meaningful and is not a failure: Meta omits a metric
 * entirely when it is zero, so a missing `inline_link_clicks` really is no link
 * clicks. Missing `reach` is the one exception that stays `null`, because reach
 * is not additive and a zero would be summed by anyone who did not know that.
 */
export function normalizeMetricRow(
  payload: unknown,
  context: InsightsNormalizeContext,
): NormalizedAdMetricDaily | null {
  if (!payload || typeof payload !== 'object') return null;

  const row = payload as Record<string, unknown>;

  const metricDate = readDay(row.date_start);
  if (!metricDate) return null;

  const identity = readIdentity(row, context);
  if (!identity) return null;

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
  // column means for a metric that must never be summed.
  const reach = row.reach === undefined ? null : parseCountText(row.reach);
  if (row.reach !== undefined && reach === null) return null;

  const counts = readActionMap(row.actions);
  const values = readActionMap(row.action_values);
  const facts = deriveActionFacts({ counts, values });

  return {
    tenantId: context.tenantId,
    workspaceId: context.workspaceId,
    agencyClientId: context.agencyClientId,
    connectionId: context.connectionId,
    provider: context.provider,
    source: context.source,
    entityLevel: context.entityLevel,
    entityExternalId: identity.entityExternalId,
    campaignExternalId: identity.campaignExternalId,
    metricDate,
    accountTimezone: context.accountTimezone,
    currency: context.currency,
    attributionSetting: context.attributionSetting,
    spend,
    impressions,
    reach,
    clicks,
    linkClicks,
    leads: facts.leads,
    conversions: facts.conversions,
    conversionValue: facts.conversionValue,
    videoViews: facts.videoViews,
    /**
     * Both halves of what Meta said, plus the version of the rules that read
     * them. The counts alone would not let a later mapping re-derive revenue,
     * and neither half would say which definition of `leads` this row's number
     * follows — which is what makes rows from two mapping versions comparable
     * instead of silently mixed.
     */
    actions: {
      mappingVersion: META_ACTION_MAPPING_VERSION,
      counts,
      values,
    },
    isPartial: context.isPartial,
    syncedAt: context.syncedAt,
  };
}

/**
 * What the row is about.
 *
 * At account level the answer is the account the credential is bound to, never
 * anything in the payload — the resolver already validated that handle, and
 * taking it from the response would let a redirected read write facts under an
 * id nobody checked.
 *
 * Below the account the id has to come from Meta, and a row without a readable
 * one cannot be attributed at all. An object that has no matching row in
 * `social_ad_entities` is fine and expected: the facts table carries no foreign
 * key precisely so that an ad set created since the last hierarchy sync still
 * gets its spend recorded.
 *
 * Ad set is the level where identity and parent stop being the same value, and
 * the distinction is load-bearing in both directions. `entityExternalId` is the
 * ad set — it is what the unique key identifies and what a destination join
 * matches on — while `campaignExternalId` is the campaign above it, which is
 * what lets a campaign's ad sets be found without a join. Returning the
 * campaign id as the identity would collapse every ad set of one campaign onto
 * a single row per day and silently overwrite them in turn; returning the ad
 * set id as the parent would make the campaign index point at objects that are
 * not campaigns.
 *
 * A row that names an ad set but no campaign is refused rather than stored with
 * a null parent. Meta returns both together at this level, so one without the
 * other is a payload this code does not understand, and a skip is counted where
 * a half-attributed fact would not be.
 */
function readIdentity(
  row: Record<string, unknown>,
  context: InsightsNormalizeContext,
): { entityExternalId: string; campaignExternalId: string | null } | null {
  if (context.entityLevel === 'account') {
    return {
      entityExternalId: context.accountExternalId,
      campaignExternalId: null,
    };
  }

  const campaignId = readObjectId(row.campaign_id);

  if (!campaignId) return null;

  if (context.entityLevel === 'campaign') {
    return { entityExternalId: campaignId, campaignExternalId: campaignId };
  }

  const adsetId = readObjectId(row.adset_id);

  if (!adsetId) return null;

  return { entityExternalId: adsetId, campaignExternalId: campaignId };
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
