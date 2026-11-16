import type { SocialAdProvider } from '../entities/social-ad-account-connection.entity';
import type { LinkedInRawPage } from '../services/linkedin-ads-reader.service';
import type {
  NormalizedAdMetricDaily,
  NormalizedAdMetricPage,
  SocialAdInsightsLevel,
} from './meta-ads-insights.contract';
import { parseAmountText, parseCountText } from './metric-number';

const URN_PREFIX_BY_LEVEL: Record<SocialAdInsightsLevel, string> = {
  account: 'urn:li:sponsoredAccount:',
  campaign: 'urn:li:sponsoredCampaignGroup:',
  adset: 'urn:li:sponsoredCampaign:',
  ad: 'urn:li:sponsoredCreative:',
};

type Row = Record<string, unknown>;

export type LinkedInInsightsContext = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  connectionId: string;
  provider: SocialAdProvider;
  entityLevel: SocialAdInsightsLevel;
  accountId: string;
  /**
   * The timezone the stored dates are in. LinkedIn reports `DAILY` rows by
   * calendar date without naming a zone: the connection stores `UTC`.
   */
  accountTimezone: string;
  currency: string | null;
  /** adset/ad level: entity id → its campaign group id, from the mirror. */
  groupByEntity: ReadonlyMap<string, string>;
  /** Stated by the run mode, never inferred from the date. */
  isPartial: boolean;
  syncedAt: Date;
};

function record(value: unknown): Row {
  return typeof value === 'object' && value !== null ? (value as Row) : {};
}

function pad(value: number, size: number): string {
  return String(value).padStart(size, '0');
}

/** `{year,month,day}` → `YYYY-MM-DD`, or null when it is not a real date. */
function dayOf(value: unknown): string | null {
  const date = record(value);
  const { year, month, day } = date;

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return null;
  }

  const iso = `${pad(year as number, 4)}-${pad(month as number, 2)}-${pad(day as number, 2)}`;
  const parsed = new Date(`${iso}T00:00:00.000Z`);

  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === iso
    ? iso
    : null;
}

/** A count LinkedIn omitted is zero; one that is present and bad is a skip. */
function readCount(value: unknown): string | null {
  if (value === undefined || value === null) return '0';

  return parseCountText(value);
}

/** Money/decimal strings (`"19.91833"`), omitted → zero, bad → skip. */
function readAmount(value: unknown): string | null {
  if (value === undefined || value === null) return '0.000000';

  return parseAmountText(value);
}

/**
 * Daily `adAnalytics` rows of one level into mirror facts.
 *
 * Meaning of the columns LinkedIn does not fill: `reach`,
 * `messaging_conversations`, `thruplays` stay `null` (nothing was measured)
 * rather than `0`. `link_clicks` is `landingPageClicks`; `leads` is
 * `oneClickLeads`; `conversions` is `externalWebsiteConversions`.
 */
export function normalizeLinkedInMetrics(
  page: LinkedInRawPage,
  context: LinkedInInsightsContext,
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
  context: LinkedInInsightsContext,
): NormalizedAdMetricDaily | null {
  const range = record(raw.dateRange);
  const metricDate = dayOf(range.start);

  // DAILY granularity: a row spanning several days is not a daily fact.
  if (!metricDate || metricDate !== dayOf(range.end)) return null;

  const pivot: unknown = Array.isArray(raw.pivotValues)
    ? (raw.pivotValues as unknown[])[0]
    : null;
  const prefix = URN_PREFIX_BY_LEVEL[context.entityLevel];

  if (typeof pivot !== 'string' || !pivot.startsWith(prefix)) return null;

  const entityExternalId = pivot.slice(prefix.length);

  if (!/^\d{1,20}$/.test(entityExternalId)) return null;

  let campaignExternalId: string | null;
  switch (context.entityLevel) {
    case 'account':
      campaignExternalId = null;
      break;
    case 'campaign':
      campaignExternalId = entityExternalId;
      break;
    default:
      campaignExternalId = context.groupByEntity.get(entityExternalId) ?? null;
      // An entity the mirror does not know yet cannot be attributed.
      if (!campaignExternalId) return null;
  }

  const spend = readAmount(raw.costInLocalCurrency);
  const impressions = readCount(raw.impressions);
  const clicks = readCount(raw.clicks);
  const linkClicks = readCount(raw.landingPageClicks);
  const conversions = readAmount(raw.externalWebsiteConversions);
  const conversionValue = readAmount(raw.conversionValueInLocalCurrency);
  const leads = readCount(raw.oneClickLeads);
  const videoViews = readCount(raw.videoViews);

  if (
    spend === null ||
    impressions === null ||
    clicks === null ||
    linkClicks === null ||
    conversions === null ||
    conversionValue === null ||
    leads === null ||
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
    entityExternalId,
    campaignExternalId,
    metricDate,
    accountTimezone: context.accountTimezone,
    currency: context.currency,
    attributionSetting: 'account_default',
    spend,
    impressions,
    reach: null,
    clicks,
    linkClicks,
    leads,
    conversions,
    conversionValue,
    videoViews,
    messagingConversations: null,
    thruplays: null,
    videoAvgWatchSeconds: null,
    actions: { mappingVersion: 'linkedin_ads_v1', extras: {} },
    isPartial: context.isPartial,
    syncedAt: context.syncedAt,
  };
}
