import type { SocialAdProvider } from '../entities/social-ad-account-connection.entity';
import {
  TIKTOK_LEVEL,
  type TikTokRawPage,
} from '../services/tiktok-ads-reader.service';
import type {
  NormalizedAdMetricDaily,
  NormalizedAdMetricPage,
  SocialAdInsightsLevel,
} from './meta-ads-insights.contract';
import { parseAmountText, parseCountText } from './metric-number';

const DAY = /^(\d{4}-\d{2}-\d{2})(?: 00:00:00)?$/;
const ID_PATTERN = /^\d{1,20}$/;

type Row = Record<string, unknown>;

export type TikTokInsightsContext = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  connectionId: string;
  provider: SocialAdProvider;
  entityLevel: SocialAdInsightsLevel;
  advertiserId: string;
  /** The advertiser's zone; the report's days are in it. */
  accountTimezone: string;
  currency: string | null;
  /** adset/ad level: entity id → its campaign id, from the mirror. */
  campaignByEntity: ReadonlyMap<string, string>;
  /** Stated by the run mode, never inferred from the date. */
  isPartial: boolean;
  syncedAt: Date;
};

function record(value: unknown): Row {
  return typeof value === 'object' && value !== null ? (value as Row) : {};
}

/** TikTok writes metrics as strings; omitted → zero, malformed → skip. */
function readCount(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return '0';

  return parseCountText(value);
}

function readAmount(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return '0.000000';

  return parseAmountText(value);
}

/**
 * Daily rows of the integrated report into mirror facts.
 *
 * `reach` is stored (TikTok measures it, daily). `frequency`, a ratio, has no
 * column and goes to `actions`. `link_clicks` is `clicks` (TikTok's clicks are
 * destination clicks); `leads` is `0` and `conversions` is `conversion` (the
 * optimization event); `video_views` is `video_play_actions`.
 */
export function normalizeTikTokMetrics(
  page: TikTokRawPage,
  context: TikTokInsightsContext,
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
  context: TikTokInsightsContext,
): NormalizedAdMetricDaily | null {
  const dimensions = record(raw.dimensions);
  const metrics = record(raw.metrics);
  const day = DAY.exec(
    typeof dimensions.stat_time_day === 'string'
      ? dimensions.stat_time_day
      : '',
  );

  if (!day) return null;

  const rawId: unknown =
    dimensions[TIKTOK_LEVEL[context.entityLevel].idDimension];
  const entityExternalId =
    typeof rawId === 'number'
      ? String(rawId)
      : typeof rawId === 'string'
        ? rawId
        : '';

  if (!ID_PATTERN.test(entityExternalId)) return null;

  let campaignExternalId: string | null;
  switch (context.entityLevel) {
    case 'account':
      campaignExternalId = null;
      break;
    case 'campaign':
      campaignExternalId = entityExternalId;
      break;
    default:
      campaignExternalId =
        context.campaignByEntity.get(entityExternalId) ?? null;
      // An entity the mirror does not know yet cannot be attributed.
      if (!campaignExternalId) return null;
  }

  const spend = readAmount(metrics.spend);
  const impressions = readCount(metrics.impressions);
  const clicks = readCount(metrics.clicks);
  const reach = readCount(metrics.reach);
  const conversions = readAmount(metrics.conversion);
  const videoViews = readCount(metrics.video_play_actions);

  if (
    spend === null ||
    impressions === null ||
    clicks === null ||
    reach === null ||
    conversions === null ||
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
    metricDate: day[1],
    accountTimezone: context.accountTimezone,
    currency: context.currency,
    attributionSetting: 'account_default',
    spend,
    impressions,
    reach,
    clicks,
    linkClicks: clicks,
    leads: '0',
    conversions,
    conversionValue: '0.000000',
    videoViews,
    messagingConversations: null,
    thruplays: null,
    videoAvgWatchSeconds: null,
    actions: {
      mappingVersion: 'tiktok_ads_v1',
      extras: { frequency: readAmount(metrics.frequency) },
    },
    isPartial: context.isPartial,
    syncedAt: context.syncedAt,
  };
}
