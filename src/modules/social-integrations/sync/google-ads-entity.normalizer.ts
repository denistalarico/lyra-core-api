import type { GoogleAdsRawPage } from '../services/google-ads-reader.service';
import type {
  NormalizedAdEntity,
  NormalizedAdEntityPage,
} from './meta-ads-entity.contract';

const CUSTOMER_ID_PATTERN = /^\d{10}$/;
const OBJECT_ID_PATTERN = /^\d{1,20}$/;
const MICROS_PATTERN = /^\d{1,19}$/;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** Google's "no end date" sentinel. */
const NO_END_DATE = '2037-12-30';
/** Budget micros → minor units of a two-decimal currency (D-G6, A-07). */
const MICROS_PER_MINOR = 10_000n;

type Row = Record<string, unknown>;

export type GoogleAdsEntityContext = {
  /** The 10-digit customer id; the account node's identity. */
  customerId: string;
  currency: string | null;
};

/**
 * Google's vocabulary into the one the campaign filter already reads
 * (`ACTIVE` / `PAUSED` / `ARCHIVED`), so the mirror needs no provider branch.
 * The provider's own words stay in `metadata`.
 */
function mapStatus(raw: string | null): string | null {
  switch (raw) {
    case 'ENABLED':
      return 'ACTIVE';
    case 'PAUSED':
      return 'PAUSED';
    case 'REMOVED':
      return 'ARCHIVED';
    default:
      return raw;
  }
}

function record(value: unknown): Row {
  return typeof value === 'object' && value !== null ? (value as Row) : {};
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function objectId(value: unknown): string | null {
  const candidate = typeof value === 'number' ? String(value) : text(value);

  return candidate && OBJECT_ID_PATTERN.test(candidate) ? candidate : null;
}

function day(value: unknown): Date | null {
  const candidate = text(value);

  if (!candidate || !DAY_PATTERN.test(candidate)) return null;

  const parsed = new Date(`${candidate}T00:00:00.000Z`);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** `/ 10_000` in BigInt, so a large budget never passes through a float. */
export function microsToMinor(value: unknown): string | null {
  const candidate =
    typeof value === 'number' && Number.isSafeInteger(value)
      ? String(value)
      : text(value);

  if (!candidate || !MICROS_PATTERN.test(candidate)) return null;

  return (BigInt(candidate) / MICROS_PER_MINOR).toString();
}

const BASE: Omit<
  NormalizedAdEntity,
  'entityLevel' | 'externalId' | 'parentExternalId' | 'campaignExternalId'
> = {
  name: null,
  status: null,
  effectiveStatus: null,
  objective: null,
  optimizationGoal: null,
  billingEvent: null,
  destinationType: null,
  destinationRaw: null,
  destinationObservedAt: null,
  destinationObserved: false,
  creativeId: null,
  effectiveObjectStoryId: null,
  effectiveInstagramMediaId: null,
  dailyBudgetMinor: null,
  lifetimeBudgetMinor: null,
  budgetRemainingMinor: null,
  currency: null,
  startTime: null,
  stopTime: null,
  providerCreatedTime: null,
  providerUpdatedTime: null,
  metadata: {},
};

/** Customer row → the account node. `null` when Google answered nothing. */
export function normalizeGoogleAdsAccount(
  page: GoogleAdsRawPage,
  context: GoogleAdsEntityContext,
): NormalizedAdEntityPage {
  const customer = record(page.rows[0]?.customer);
  const id = objectId(customer.id) ?? context.customerId;

  if (!CUSTOMER_ID_PATTERN.test(id)) {
    return { rows: [], truncated: false, skipped: 0, apiCalls: page.apiCalls };
  }

  return {
    rows: [
      {
        ...BASE,
        entityLevel: 'account',
        externalId: id,
        parentExternalId: null,
        campaignExternalId: null,
        name: text(customer.descriptiveName),
        currency: text(customer.currencyCode) ?? context.currency,
        metadata: { timeZone: text(customer.timeZone) },
      },
    ],
    truncated: false,
    skipped: 0,
    apiCalls: page.apiCalls,
  };
}

export function normalizeGoogleAdsCampaigns(
  page: GoogleAdsRawPage,
  context: GoogleAdsEntityContext,
): NormalizedAdEntityPage {
  const rows: NormalizedAdEntity[] = [];
  let skipped = 0;

  for (const raw of page.rows) {
    const campaign = record(raw.campaign);
    const budget = record(raw.campaignBudget);
    const externalId = objectId(campaign.id);

    if (!externalId) {
      skipped += 1;
      continue;
    }

    const status = text(campaign.status);
    const period = text(budget.period);
    const budgetMinor = microsToMinor(budget.amountMicros);
    const endDate = text(campaign.endDate);

    rows.push({
      ...BASE,
      entityLevel: 'campaign',
      externalId,
      parentExternalId: context.customerId,
      campaignExternalId: externalId,
      name: text(campaign.name),
      status: mapStatus(status),
      effectiveStatus: mapStatus(status),
      // The campaign type is the nearest thing Google has to an objective.
      objective: text(campaign.advertisingChannelType),
      dailyBudgetMinor: period === 'DAILY' ? budgetMinor : null,
      lifetimeBudgetMinor: period === 'CUSTOM_PERIOD' ? budgetMinor : null,
      currency: context.currency,
      startTime: day(campaign.startDate),
      stopTime:
        endDate && endDate !== NO_END_DATE ? endOfDay(day(endDate)) : null,
      metadata: {
        channelType: text(campaign.advertisingChannelType),
        googleStatus: status,
        servingStatus: text(campaign.servingStatus),
        budgetPeriod: period,
      },
    });
  }

  return {
    rows,
    truncated: page.truncated,
    skipped,
    apiCalls: page.apiCalls,
  };
}

export function normalizeGoogleAdsAdGroups(
  page: GoogleAdsRawPage,
  context: GoogleAdsEntityContext,
): NormalizedAdEntityPage {
  const rows: NormalizedAdEntity[] = [];
  let skipped = 0;

  for (const raw of page.rows) {
    const group = record(raw.adGroup);
    const externalId = objectId(group.id);
    const campaignExternalId = objectId(record(raw.campaign).id);

    if (!externalId || !campaignExternalId) {
      skipped += 1;
      continue;
    }

    const status = text(group.status);

    rows.push({
      ...BASE,
      entityLevel: 'adset',
      externalId,
      parentExternalId: campaignExternalId,
      campaignExternalId,
      name: text(group.name),
      status: mapStatus(status),
      effectiveStatus: mapStatus(status),
      currency: context.currency,
      metadata: { googleStatus: status },
    });
  }

  return { rows, truncated: page.truncated, skipped, apiCalls: page.apiCalls };
}

export function normalizeGoogleAdsAds(
  page: GoogleAdsRawPage,
  context: GoogleAdsEntityContext,
): NormalizedAdEntityPage {
  const rows: NormalizedAdEntity[] = [];
  let skipped = 0;

  for (const raw of page.rows) {
    const adGroupAd = record(raw.adGroupAd);
    const ad = record(adGroupAd.ad);
    const externalId = objectId(ad.id);
    const adGroupId = objectId(record(raw.adGroup).id);
    const campaignExternalId = objectId(record(raw.campaign).id);

    if (!externalId || !adGroupId || !campaignExternalId) {
      skipped += 1;
      continue;
    }

    const status = text(adGroupAd.status);

    rows.push({
      ...BASE,
      entityLevel: 'ad',
      externalId,
      parentExternalId: adGroupId,
      campaignExternalId,
      // Responsive ads carry no name; the id is the honest fallback label.
      name: text(ad.name) ?? `Anúncio ${externalId}`,
      status: mapStatus(status),
      effectiveStatus: mapStatus(status),
      currency: context.currency,
      metadata: { googleStatus: status },
    });
  }

  return { rows, truncated: page.truncated, skipped, apiCalls: page.apiCalls };
}

function endOfDay(value: Date | null): Date | null {
  return value ? new Date(value.getTime() + 86_400_000 - 1) : null;
}
