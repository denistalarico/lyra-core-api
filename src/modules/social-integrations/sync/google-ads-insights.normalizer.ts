import type { SocialAdProvider } from '../entities/social-ad-account-connection.entity';
import type { GoogleAdsRawPage } from '../services/google-ads-reader.service';
import type {
  NormalizedAdMetricDaily,
  NormalizedAdMetricPage,
  SocialAdInsightsLevel,
} from './meta-ads-insights.contract';
import {
  formatScaledAmount,
  parseAmountText,
  parseCountText,
} from './metric-number';

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const OBJECT_ID_PATTERN = /^\d{1,20}$/;
const MICROS_PATTERN = /^\d{1,19}$/;

type Row = Record<string, unknown>;

export type GoogleAdsInsightsContext = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  connectionId: string;
  provider: SocialAdProvider;
  entityLevel: SocialAdInsightsLevel;
  /** The 10-digit customer id; the entity id at account level. */
  customerId: string;
  accountTimezone: string;
  currency: string | null;
  /** Stated by the run mode, never inferred from the date. */
  isPartial: boolean;
  syncedAt: Date;
};

function record(value: unknown): Row {
  return typeof value === 'object' && value !== null ? (value as Row) : {};
}

function objectId(value: unknown): string | null {
  const candidate = typeof value === 'number' ? String(value) : value;

  return typeof candidate === 'string' && OBJECT_ID_PATTERN.test(candidate)
    ? candidate
    : null;
}

/**
 * `cost_micros` is already `numeric(18,6)` scaled: one micro is 10^-6 of the
 * currency unit, so the integer is formatted, never divided as a float (A-07).
 */
function readMicros(value: unknown): string | null {
  const candidate =
    typeof value === 'number' && Number.isSafeInteger(value)
      ? String(value)
      : value;

  if (typeof candidate !== 'string' || !MICROS_PATTERN.test(candidate)) {
    return null;
  }

  return formatScaledAmount(BigInt(candidate));
}

/** Google's `conversions` are doubles; rounded to the column's six places. */
function readDouble(value: unknown): string | null {
  if (value === undefined || value === null) return '0.000000';

  const parsed = typeof value === 'number' ? value : Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) return null;

  return parseAmountText(parsed.toFixed(6));
}

/** A count that Google omitted is zero; one that is present and bad is a skip. */
function readCount(value: unknown): string | null {
  if (value === undefined || value === null) return '0';

  return parseCountText(value);
}

/**
 * Daily rows of one level into mirror facts.
 *
 * Meaning of the Meta-only columns: `reach`, `messaging_conversations` and
 * `thruplays` stay `null` (A-07) rather than `0`, because nothing was measured.
 * `link_clicks` is `clicks`, the closest Google has. `leads` is `0`: Google has
 * conversion actions, not a lead event, and the total lives in `conversions`.
 * The extras with no column are kept in `actions` so a later mapping can use them.
 */
export function normalizeGoogleAdsMetrics(
  page: GoogleAdsRawPage,
  context: GoogleAdsInsightsContext,
): NormalizedAdMetricPage {
  const rows: NormalizedAdMetricDaily[] = [];
  let skipped = 0;

  for (const raw of page.rows) {
    const fact = normalizeRow(raw, context);

    if (fact) rows.push(fact);
    else skipped += 1;
  }

  return { rows, truncated: page.truncated, skipped, apiCalls: page.apiCalls };
}

function normalizeRow(
  raw: Row,
  context: GoogleAdsInsightsContext,
): NormalizedAdMetricDaily | null {
  const segments = record(raw.segments);
  const metrics = record(raw.metrics);
  const metricDate = segments.date;

  if (typeof metricDate !== 'string' || !DAY_PATTERN.test(metricDate)) {
    return null;
  }

  const identity = readIdentity(raw, context);
  if (!identity) return null;

  const spend = readMicros(metrics.costMicros ?? '0');
  const impressions = readCount(metrics.impressions);
  const clicks = readCount(metrics.clicks);
  const conversions = readDouble(metrics.conversions);
  const conversionValue = readDouble(metrics.conversionsValue);
  const videoViews = readCount(metrics.videoViews);

  if (
    spend === null ||
    impressions === null ||
    clicks === null ||
    conversions === null ||
    conversionValue === null ||
    videoViews === null
  ) {
    return null;
  }

  return {
    tenantId: context.tenantId,
    workspaceId: context.workspaceId,
    agencyClientId: context.agencyClientId,
    connectionId: context.connectionId,
    provider: context.provider,
    source: 'paid',
    entityLevel: context.entityLevel,
    entityExternalId: identity.entityExternalId,
    campaignExternalId: identity.campaignExternalId,
    metricDate,
    accountTimezone: context.accountTimezone,
    currency: context.currency,
    attributionSetting: 'account_default',
    spend,
    impressions,
    reach: null,
    clicks,
    linkClicks: clicks,
    leads: '0',
    conversions,
    conversionValue,
    videoViews,
    messagingConversations: null,
    thruplays: null,
    videoAvgWatchSeconds: null,
    actions: {
      mappingVersion: 'google_ads_v1',
      extras: {
        interactions: readCount(metrics.interactions),
        allConversions: readDouble(metrics.allConversions),
      },
    },
    isPartial: context.isPartial,
    syncedAt: context.syncedAt,
  };
}

function readIdentity(
  raw: Row,
  context: GoogleAdsInsightsContext,
): { entityExternalId: string; campaignExternalId: string | null } | null {
  const campaignId = objectId(record(raw.campaign).id);

  switch (context.entityLevel) {
    case 'account':
      return {
        entityExternalId: context.customerId,
        campaignExternalId: null,
      };
    case 'campaign':
      return campaignId
        ? { entityExternalId: campaignId, campaignExternalId: campaignId }
        : null;
    case 'adset': {
      const adGroupId = objectId(record(raw.adGroup).id);

      return adGroupId && campaignId
        ? { entityExternalId: adGroupId, campaignExternalId: campaignId }
        : null;
    }
    case 'ad': {
      const adId = objectId(record(record(raw.adGroupAd).ad).id);

      return adId && campaignId
        ? { entityExternalId: adId, campaignExternalId: campaignId }
        : null;
    }
  }
}
