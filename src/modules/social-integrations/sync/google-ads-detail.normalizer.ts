import { createHash } from 'node:crypto';
import type { SocialAdProvider } from '../entities/social-ad-account-connection.entity';
import type { GoogleAdsDetailBreakdownKind } from '../entities/social-ad-breakdown-daily.entity';
import type { SocialAdSearchTermKind } from '../entities/social-ad-search-term-daily.entity';
import type { GoogleAdsRawPage } from '../services/google-ads-reader.service';
import {
  objectId,
  readCount,
  readDouble,
  readMicros,
  record,
} from './google-ads-insights.normalizer';
import type { NormalizedAdBreakdownDaily } from './meta-ads-breakdown.contract';
import { formatScaledAmount, parseScaledAmount } from './metric-number';

/**
 * GA-DET (D-G3, D-G4): Google campaign details into stored rows. Pure.
 *
 * Every dimension is aggregated on its identity before it leaves here: Google
 * may split one (campaign, day, bucket) across several result rows (a search
 * term per ad group, a keyword per match type), and the writers upsert on that
 * identity, so two rows with the same key in one statement would fail it.
 */

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ENUM_PATTERN = /^[A-Z][A-Z0-9_]{0,59}$/;
const CONVERSION_ACTION_PATTERN = /\/conversionActions\/(\d{1,20})$/;
const MAX_TERM_LENGTH = 512;
const MAX_LABEL_LENGTH = 200;
const MAPPING_VERSION = 'google_ads_v1';

export type GoogleAdsDetailContext = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  connectionId: string;
  provider: SocialAdProvider;
  accountTimezone: string;
  currency: string | null;
  isPartial: boolean;
  syncedAt: Date;
};

export type NormalizedAdSearchTermDaily = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  connectionId: string;
  provider: SocialAdProvider;
  campaignExternalId: string;
  metricDate: string;
  accountTimezone: string;
  currency: string | null;
  termKind: SocialAdSearchTermKind;
  /** As Google reported it, bounded. `''` is PMax's catch-all category. */
  termText: string;
  termHash: string;
  impressions: string;
  clicks: string;
  /** NULL where Google reports no cost for the resource (PMax categories). */
  spend: string | null;
  conversions: string;
  conversionValue: string;
  isPartial: boolean;
  syncedAt: Date;
};

export type GoogleAdsDetailPage<Row> = {
  rows: Row[];
  /** Unreadable result rows: counted, never coerced into zeros. */
  skipped: number;
};

/** A campaign's channel, as seen in the `ad_network` read (no extra query). */
export type GoogleAdsCampaignChannel = {
  campaignId: string;
  channelType: string;
};

type Sums = {
  spend: bigint | null;
  impressions: bigint;
  clicks: bigint;
  conversions: bigint;
  conversionValue: bigint;
};

type Measured = {
  spend: string | null;
  impressions: string;
  clicks: string;
  conversions: string;
  conversionValue: string;
};

function readDay(raw: Record<string, unknown>): string | null {
  const day = record(raw.segments).date;
  return typeof day === 'string' && DAY_PATTERN.test(day) ? day : null;
}

function readEnum(value: unknown): string | null {
  return typeof value === 'string' && ENUM_PATTERN.test(value) ? value : null;
}

/** `withSpend=false` for resources that cannot report cost (PMax insight). */
function readMeasures(
  metrics: Record<string, unknown>,
  withSpend: boolean,
  withDelivery: boolean,
): Measured | null {
  const spend = withSpend ? readMicros(metrics.costMicros ?? '0') : null;
  const impressions = withDelivery ? readCount(metrics.impressions) : '0';
  const clicks = withDelivery ? readCount(metrics.clicks) : '0';
  const conversions = readDouble(metrics.conversions);
  const conversionValue = readDouble(metrics.conversionsValue);

  if (
    (withSpend && spend === null) ||
    impressions === null ||
    clicks === null ||
    conversions === null ||
    conversionValue === null
  ) {
    return null;
  }

  return { spend, impressions, clicks, conversions, conversionValue };
}

function add(target: Sums | undefined, measured: Measured): Sums {
  const scaled = (value: string) => parseScaledAmount(value) ?? 0n;
  const spend =
    measured.spend === null
      ? (target?.spend ?? null)
      : (target?.spend ?? 0n) + scaled(measured.spend);

  return {
    spend,
    impressions: (target?.impressions ?? 0n) + BigInt(measured.impressions),
    clicks: (target?.clicks ?? 0n) + BigInt(measured.clicks),
    conversions: (target?.conversions ?? 0n) + scaled(measured.conversions),
    conversionValue:
      (target?.conversionValue ?? 0n) + scaled(measured.conversionValue),
  };
}

/** Cut by code points, so a multi-byte character is never split in half. */
function bounded(text: string, max: number): string {
  const chars = Array.from(text.trim());
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('');
}

export function hashSearchTerm(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function breakdownRow(
  context: GoogleAdsDetailContext,
  identity: {
    campaignId: string;
    day: string;
    kind: GoogleAdsDetailBreakdownKind;
    key: string;
    actions: Record<string, unknown>;
  },
  sums: Sums,
): NormalizedAdBreakdownDaily {
  const clicks = sums.clicks.toString();
  return {
    tenantId: context.tenantId,
    workspaceId: context.workspaceId,
    agencyClientId: context.agencyClientId,
    connectionId: context.connectionId,
    provider: context.provider,
    entityLevel: 'campaign',
    entityExternalId: identity.campaignId,
    metricDate: identity.day,
    accountTimezone: context.accountTimezone,
    currency: context.currency,
    breakdownKind: identity.kind,
    breakdownKey: identity.key,
    spend: formatScaledAmount(sums.spend ?? 0n),
    impressions: sums.impressions.toString(),
    clicks,
    linkClicks: clicks,
    reach: null,
    actions: identity.actions,
    conversions: formatScaledAmount(sums.conversions),
    conversionValue: formatScaledAmount(sums.conversionValue),
    isPartial: context.isPartial,
    syncedAt: context.syncedAt,
  };
}

/**
 * `ad_network`: where the campaign served. The key is Google's enum value
 * lowercased (`search`, `youtube`, `content`…); labels belong to the read.
 * Also returns each campaign's `advertising_channel_type`, so the sync knows
 * which campaigns need term reads without asking Google again.
 */
export function normalizeGoogleAdsNetworkBreakdown(
  page: GoogleAdsRawPage,
  context: GoogleAdsDetailContext,
): GoogleAdsDetailPage<NormalizedAdBreakdownDaily> & {
  channels: GoogleAdsCampaignChannel[];
} {
  const sums = new Map<
    string,
    { campaignId: string; day: string; key: string; sums: Sums }
  >();
  const channels = new Map<string, string>();
  let skipped = 0;

  for (const raw of page.rows) {
    const campaign = record(raw.campaign);
    const campaignId = objectId(campaign.id);
    const day = readDay(raw);
    const network = readEnum(record(raw.segments).adNetworkType);
    const measured = readMeasures(record(raw.metrics), true, true);

    if (!campaignId || !day || !network || !measured) {
      skipped += 1;
      continue;
    }

    const channelType = readEnum(campaign.advertisingChannelType);
    if (channelType) channels.set(campaignId, channelType);

    const key = network.toLowerCase();
    const id = `${campaignId}|${day}|${key}`;
    const current = sums.get(id);
    sums.set(id, { campaignId, day, key, sums: add(current?.sums, measured) });
  }

  return {
    rows: [...sums.values()].map((entry) =>
      breakdownRow(
        context,
        {
          campaignId: entry.campaignId,
          day: entry.day,
          kind: 'ad_network',
          key: entry.key,
          actions: { mappingVersion: MAPPING_VERSION },
        },
        entry.sums,
      ),
    ),
    skipped,
    channels: [...channels].map(([campaignId, channelType]) => ({
      campaignId,
      channelType,
    })),
  };
}

/**
 * `conversion_action`: which conversion it was. The key is the action id (from
 * the resource name); its name and category go in `actions`. Spend, impressions
 * and clicks are stored as 0 because the segment cannot carry them: the read
 * returns them as null, never as a measured zero.
 */
export function normalizeGoogleAdsConversionActionBreakdown(
  page: GoogleAdsRawPage,
  context: GoogleAdsDetailContext,
): GoogleAdsDetailPage<NormalizedAdBreakdownDaily> {
  const sums = new Map<
    string,
    {
      campaignId: string;
      day: string;
      key: string;
      label: string;
      category: string | null;
      sums: Sums;
    }
  >();
  let skipped = 0;

  for (const raw of page.rows) {
    const segments = record(raw.segments);
    const campaignId = objectId(record(raw.campaign).id);
    const day = readDay(raw);
    const resource = segments.conversionAction;
    const match =
      typeof resource === 'string'
        ? CONVERSION_ACTION_PATTERN.exec(resource)
        : null;
    const measured = readMeasures(record(raw.metrics), false, false);

    if (!campaignId || !day || !match || !measured) {
      skipped += 1;
      continue;
    }

    const key = match[1];
    const name = segments.conversionActionName;
    const id = `${campaignId}|${day}|${key}`;
    const current = sums.get(id);
    sums.set(id, {
      campaignId,
      day,
      key,
      label:
        typeof name === 'string' && name.trim()
          ? bounded(name, MAX_LABEL_LENGTH)
          : (current?.label ?? key),
      category:
        readEnum(segments.conversionActionCategory) ??
        current?.category ??
        null,
      sums: add(current?.sums, measured),
    });
  }

  return {
    rows: [...sums.values()].map((entry) =>
      breakdownRow(
        context,
        {
          campaignId: entry.campaignId,
          day: entry.day,
          kind: 'conversion_action',
          key: entry.key,
          actions: {
            mappingVersion: MAPPING_VERSION,
            label: entry.label,
            category: entry.category,
          },
        },
        entry.sums,
      ),
    ),
    skipped,
  };
}

function readTermText(
  raw: Record<string, unknown>,
  kind: SocialAdSearchTermKind,
) {
  switch (kind) {
    case 'search_term':
      return record(raw.searchTermView).searchTerm;
    case 'keyword':
      return record(record(raw.adGroupCriterion).keyword).text;
    case 'pmax_category':
      return record(raw.campaignSearchTermInsight).categoryLabel ?? '';
  }
}

/**
 * Terms of one kind. `campaignId` is given for PMax categories (the query is
 * per campaign and the insight row does not repeat it); the other kinds read
 * `campaign.id` from each row.
 */
export function normalizeGoogleAdsSearchTerms(
  page: GoogleAdsRawPage,
  kind: SocialAdSearchTermKind,
  context: GoogleAdsDetailContext,
  campaignId?: string,
): GoogleAdsDetailPage<NormalizedAdSearchTermDaily> {
  const withSpend = kind !== 'pmax_category';
  const sums = new Map<
    string,
    { campaignId: string; day: string; text: string; hash: string; sums: Sums }
  >();
  let skipped = 0;

  for (const raw of page.rows) {
    const rowCampaignId = campaignId ?? objectId(record(raw.campaign).id);
    const day = readDay(raw);
    const text = readTermText(raw, kind);
    const measured = readMeasures(record(raw.metrics), withSpend, true);

    if (!rowCampaignId || !day || typeof text !== 'string' || !measured) {
      skipped += 1;
      continue;
    }
    // Only PMax's catch-all category may be empty; an empty search term or
    // keyword is not a term.
    const termText = bounded(text, MAX_TERM_LENGTH);
    if (!termText && kind !== 'pmax_category') {
      skipped += 1;
      continue;
    }

    const hash = hashSearchTerm(termText);
    const id = `${rowCampaignId}|${day}|${hash}`;
    const current = sums.get(id);
    sums.set(id, {
      campaignId: rowCampaignId,
      day,
      text: termText,
      hash,
      sums: add(current?.sums, measured),
    });
  }

  return {
    rows: [...sums.values()].map((entry) => ({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      agencyClientId: context.agencyClientId,
      connectionId: context.connectionId,
      provider: context.provider,
      campaignExternalId: entry.campaignId,
      metricDate: entry.day,
      accountTimezone: context.accountTimezone,
      currency: context.currency,
      termKind: kind,
      termText: entry.text,
      termHash: entry.hash,
      impressions: entry.sums.impressions.toString(),
      clicks: entry.sums.clicks.toString(),
      spend:
        withSpend && entry.sums.spend !== null
          ? formatScaledAmount(entry.sums.spend)
          : null,
      conversions: formatScaledAmount(entry.sums.conversions),
      conversionValue: formatScaledAmount(entry.sums.conversionValue),
      isPartial: context.isPartial,
      syncedAt: context.syncedAt,
    })),
    skipped,
  };
}
