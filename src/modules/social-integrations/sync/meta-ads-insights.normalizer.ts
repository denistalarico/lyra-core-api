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
    isPartial: false,
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
 * At campaign level the id has to come from Meta, and a row without one cannot
 * be attributed at all. A campaign that has no matching row in
 * `social_ad_entities` is fine and expected: the facts table carries no foreign
 * key precisely so that a campaign created since the last hierarchy sync still
 * gets its spend recorded.
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

  const campaignId = row.campaign_id;

  if (typeof campaignId !== 'string' || !OBJECT_ID_PATTERN.test(campaignId)) {
    return null;
  }

  return { entityExternalId: campaignId, campaignExternalId: campaignId };
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
