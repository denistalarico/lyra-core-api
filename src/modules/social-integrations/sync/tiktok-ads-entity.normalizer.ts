import type {
  TikTokRawPage,
  TikTokRawRow,
} from '../services/tiktok-ads-reader.service';
import type {
  NormalizedAdEntity,
  NormalizedAdEntityPage,
} from './meta-ads-entity.contract';
import { parseScaledAmount } from './metric-number';

const ID_PATTERN = /^\d{1,20}$/;
/** `parseScaledAmount` keeps six decimals; a minor unit is two (D-I8: × 100). */
const SCALED_PER_MINOR = 10_000n;
const STAMP = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/;

export type TikTokEntityContext = {
  /** The advertiser id; the account node's identity. */
  advertiserId: string;
  currency: string | null;
};

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function tikTokId(value: unknown): string | null {
  const candidate =
    typeof value === 'number' && Number.isSafeInteger(value)
      ? String(value)
      : text(value);

  return candidate && ID_PATTERN.test(candidate) ? candidate : null;
}

/** `YYYY-MM-DD HH:mm:ss` (as TikTok writes it) read as UTC. */
function stamp(value: unknown): Date | null {
  const match = STAMP.exec(text(value) ?? '');

  if (!match) return null;

  const parsed = new Date(`${match[1]}T${match[2]}.000Z`);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Budget in the currency's major unit (a number) → minor units. */
export function budgetToMinor(value: unknown): string | null {
  const textValue =
    typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? value.toFixed(6)
      : text(value);
  const scaled = parseScaledAmount(textValue);

  return scaled === null ? null : (scaled / SCALED_PER_MINOR).toString();
}

/**
 * TikTok's statuses into the vocabulary the campaign filter reads
 * (`ACTIVE` / `PAUSED` / `ARCHIVED`). A deleted entity reports a secondary
 * status ending in `_DELETE`; otherwise the switch the advertiser controls
 * (`operation_status`) decides. The provider's own words stay in `metadata`.
 */
export function mapTikTokStatus(row: TikTokRawRow): string | null {
  const secondary = text(row.secondary_status);

  if (secondary?.endsWith('_DELETE')) return 'ARCHIVED';

  switch (text(row.operation_status)) {
    case 'ENABLE':
      return 'ACTIVE';
    case 'DISABLE':
      return 'PAUSED';
    case 'FROZEN':
      return 'PAUSED';
    default:
      return text(row.operation_status);
  }
}

function budgets(row: TikTokRawRow) {
  const mode = text(row.budget_mode);
  const minor = budgetToMinor(row.budget);

  return {
    dailyBudgetMinor: mode === 'BUDGET_MODE_DAY' ? minor : null,
    lifetimeBudgetMinor: mode === 'BUDGET_MODE_TOTAL' ? minor : null,
  };
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

function tikTokMetadata(row: TikTokRawRow) {
  return {
    operationStatus: text(row.operation_status),
    secondaryStatus: text(row.secondary_status),
  };
}

export function normalizeTikTokAdvertiser(
  page: TikTokRawPage,
  context: TikTokEntityContext,
): NormalizedAdEntityPage {
  const row = page.rows[0] ?? {};
  const id = tikTokId(row.advertiser_id) ?? context.advertiserId;

  if (!ID_PATTERN.test(id)) {
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
        name: text(row.name),
        currency: text(row.currency) ?? context.currency,
        metadata: { tiktokStatus: text(row.status) },
      },
    ],
    truncated: false,
    skipped: 0,
    apiCalls: page.apiCalls,
  };
}

export function normalizeTikTokCampaigns(
  page: TikTokRawPage,
  context: TikTokEntityContext,
): NormalizedAdEntityPage {
  const rows: NormalizedAdEntity[] = [];
  let skipped = 0;

  for (const raw of page.rows) {
    const externalId = tikTokId(raw.campaign_id);

    if (!externalId) {
      skipped += 1;
      continue;
    }

    const status = mapTikTokStatus(raw);

    rows.push({
      ...BASE,
      entityLevel: 'campaign',
      externalId,
      parentExternalId: context.advertiserId,
      campaignExternalId: externalId,
      name: text(raw.campaign_name),
      status,
      effectiveStatus: status,
      objective: text(raw.objective_type),
      ...budgets(raw),
      currency: context.currency,
      providerCreatedTime: stamp(raw.create_time),
      providerUpdatedTime: stamp(raw.modify_time),
      metadata: { ...tikTokMetadata(raw), budgetMode: text(raw.budget_mode) },
    });
  }

  return { rows, truncated: page.truncated, skipped, apiCalls: page.apiCalls };
}

export function normalizeTikTokAdGroups(
  page: TikTokRawPage,
  context: TikTokEntityContext,
): NormalizedAdEntityPage {
  const rows: NormalizedAdEntity[] = [];
  let skipped = 0;

  for (const raw of page.rows) {
    const externalId = tikTokId(raw.adgroup_id);
    const campaignId = tikTokId(raw.campaign_id);

    if (!externalId || !campaignId) {
      skipped += 1;
      continue;
    }

    const status = mapTikTokStatus(raw);

    rows.push({
      ...BASE,
      entityLevel: 'adset',
      externalId,
      parentExternalId: campaignId,
      campaignExternalId: campaignId,
      name: text(raw.adgroup_name),
      status,
      effectiveStatus: status,
      optimizationGoal: text(raw.optimization_goal),
      billingEvent: text(raw.billing_event),
      ...budgets(raw),
      currency: context.currency,
      startTime: stamp(raw.schedule_start_time),
      stopTime: stamp(raw.schedule_end_time),
      providerCreatedTime: stamp(raw.create_time),
      providerUpdatedTime: stamp(raw.modify_time),
      metadata: { ...tikTokMetadata(raw), budgetMode: text(raw.budget_mode) },
    });
  }

  return { rows, truncated: page.truncated, skipped, apiCalls: page.apiCalls };
}

export function normalizeTikTokAds(
  page: TikTokRawPage,
  context: TikTokEntityContext,
): NormalizedAdEntityPage {
  const rows: NormalizedAdEntity[] = [];
  let skipped = 0;

  for (const raw of page.rows) {
    const externalId = tikTokId(raw.ad_id);
    const adGroupId = tikTokId(raw.adgroup_id);
    const campaignId = tikTokId(raw.campaign_id);

    if (!externalId || !adGroupId || !campaignId) {
      skipped += 1;
      continue;
    }

    const status = mapTikTokStatus(raw);

    rows.push({
      ...BASE,
      entityLevel: 'ad',
      externalId,
      parentExternalId: adGroupId,
      campaignExternalId: campaignId,
      name: text(raw.ad_name) ?? `Anúncio ${externalId}`,
      status,
      effectiveStatus: status,
      currency: context.currency,
      providerCreatedTime: stamp(raw.create_time),
      providerUpdatedTime: stamp(raw.modify_time),
      metadata: tikTokMetadata(raw),
    });
  }

  return { rows, truncated: page.truncated, skipped, apiCalls: page.apiCalls };
}
