import type {
  LinkedInRawPage,
  LinkedInRawRow,
} from '../services/linkedin-ads-reader.service';
import type {
  NormalizedAdEntity,
  NormalizedAdEntityPage,
} from './meta-ads-entity.contract';
import { parseScaledAmount } from './metric-number';

const ID_PATTERN = /^\d{1,20}$/;
const URN_ID_PATTERN = /^urn:li:[A-Za-z]+:(\d{1,20})$/;
/** `parseScaledAmount` keeps six decimals; a minor unit is two. */
const SCALED_PER_MINOR = 10_000n;

export type LinkedInEntityContext = {
  /** The ad account id (digits); the account node's identity. */
  accountId: string;
  currency: string | null;
};

function record(value: unknown): LinkedInRawRow {
  return typeof value === 'object' && value !== null
    ? (value as LinkedInRawRow)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** A numeric id or an id URN (`urn:li:sponsoredCampaign:123`) → digits. */
export function linkedInId(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  }

  const candidate = text(value);

  if (!candidate) return null;
  if (ID_PATTERN.test(candidate)) return candidate;

  return URN_ID_PATTERN.exec(candidate)?.[1] ?? null;
}

function epoch(value: unknown): Date | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** `{amount:"18", currencyCode}` → minor units of a two-decimal currency. */
function moneyToMinor(value: unknown): string | null {
  const scaled = parseScaledAmount(record(value).amount);

  return scaled === null ? null : (scaled / SCALED_PER_MINOR).toString();
}

/**
 * LinkedIn's vocabulary into the one the campaign filter already reads
 * (`ACTIVE` / `PAUSED` / `ARCHIVED`). The provider's own word stays in
 * `metadata`.
 */
export function mapLinkedInStatus(raw: string | null): string | null {
  switch (raw) {
    case 'ACTIVE':
    case 'PAUSED':
    case 'DRAFT':
      return raw;
    case 'ARCHIVED':
    case 'CANCELED':
    case 'CANCELLED':
    case 'REMOVED':
    case 'PENDING_DELETION':
      return 'ARCHIVED';
    default:
      return raw;
  }
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

function auditTimes(row: LinkedInRawRow) {
  const stamps = record(row.changeAuditStamps);

  return {
    providerCreatedTime: epoch(record(stamps.created).time),
    providerUpdatedTime: epoch(record(stamps.lastModified).time),
  };
}

/** Ad account → the account node. Empty when LinkedIn answered nothing usable. */
export function normalizeLinkedInAccount(
  page: LinkedInRawPage,
  context: LinkedInEntityContext,
): NormalizedAdEntityPage {
  const account = page.rows[0] ?? {};
  const id = linkedInId(account.id) ?? context.accountId;

  if (!ID_PATTERN.test(id)) {
    return { rows: [], truncated: false, skipped: 0, apiCalls: page.apiCalls };
  }

  const status = text(account.status);

  return {
    rows: [
      {
        ...BASE,
        entityLevel: 'account',
        externalId: id,
        parentExternalId: null,
        campaignExternalId: null,
        name: text(account.name),
        status: mapLinkedInStatus(status),
        effectiveStatus: mapLinkedInStatus(status),
        currency: text(account.currency) ?? context.currency,
        ...auditTimes(account),
        metadata: { linkedinStatus: status, accountType: text(account.type) },
      },
    ],
    truncated: false,
    skipped: 0,
    apiCalls: page.apiCalls,
  };
}

/** Campaign group → `campaign` (D-I8). */
export function normalizeLinkedInCampaignGroups(
  page: LinkedInRawPage,
  context: LinkedInEntityContext,
): NormalizedAdEntityPage {
  const rows: NormalizedAdEntity[] = [];
  let skipped = 0;

  for (const raw of page.rows) {
    const externalId = linkedInId(raw.id);

    if (!externalId) {
      skipped += 1;
      continue;
    }

    const status = text(raw.status);
    const schedule = record(raw.runSchedule);

    rows.push({
      ...BASE,
      entityLevel: 'campaign',
      externalId,
      parentExternalId: context.accountId,
      campaignExternalId: externalId,
      name: text(raw.name),
      status: mapLinkedInStatus(status),
      effectiveStatus: mapLinkedInStatus(status),
      objective: text(raw.objectiveType),
      lifetimeBudgetMinor: moneyToMinor(raw.totalBudget),
      currency: text(record(raw.totalBudget).currencyCode) ?? context.currency,
      startTime: epoch(schedule.start),
      stopTime: epoch(schedule.end),
      ...auditTimes(raw),
      metadata: {
        linkedinStatus: status,
        servingStatuses: Array.isArray(raw.servingStatuses)
          ? raw.servingStatuses.filter((item) => typeof item === 'string')
          : [],
      },
    });
  }

  return { rows, truncated: page.truncated, skipped, apiCalls: page.apiCalls };
}

/** Campaign → `adset` (D-I8); the parent is its campaign group. */
export function normalizeLinkedInCampaigns(
  page: LinkedInRawPage,
  context: LinkedInEntityContext,
): NormalizedAdEntityPage {
  const rows: NormalizedAdEntity[] = [];
  let skipped = 0;

  for (const raw of page.rows) {
    const externalId = linkedInId(raw.id);
    const groupId = linkedInId(raw.campaignGroup);

    if (!externalId || !groupId) {
      skipped += 1;
      continue;
    }

    const status = text(raw.status);
    const schedule = record(raw.runSchedule);

    rows.push({
      ...BASE,
      entityLevel: 'adset',
      externalId,
      parentExternalId: groupId,
      campaignExternalId: groupId,
      name: text(raw.name),
      status: mapLinkedInStatus(status),
      effectiveStatus: mapLinkedInStatus(status),
      objective: text(raw.objectiveType),
      optimizationGoal: text(raw.optimizationTargetType),
      billingEvent: text(raw.costType),
      dailyBudgetMinor: moneyToMinor(raw.dailyBudget),
      lifetimeBudgetMinor: moneyToMinor(raw.totalBudget),
      currency:
        text(record(raw.dailyBudget).currencyCode) ??
        text(record(raw.totalBudget).currencyCode) ??
        context.currency,
      startTime: epoch(schedule.start),
      stopTime: epoch(schedule.end),
      ...auditTimes(raw),
      metadata: {
        linkedinStatus: status,
        campaignType: text(raw.type),
        servingStatuses: Array.isArray(raw.servingStatuses)
          ? raw.servingStatuses.filter((item) => typeof item === 'string')
          : [],
      },
    });
  }

  return { rows, truncated: page.truncated, skipped, apiCalls: page.apiCalls };
}

/** campaign id → campaign group id, from the raw campaigns of the same sweep. */
export function campaignGroupIndex(page: LinkedInRawPage): Map<string, string> {
  const index = new Map<string, string>();

  for (const raw of page.rows) {
    const id = linkedInId(raw.id);
    const groupId = linkedInId(raw.campaignGroup);

    if (id && groupId) index.set(id, groupId);
  }

  return index;
}

/** Creative → `ad` (D-I8); the parent is its campaign. */
export function normalizeLinkedInCreatives(
  page: LinkedInRawPage,
  context: LinkedInEntityContext & { groupByCampaign: Map<string, string> },
): NormalizedAdEntityPage {
  const rows: NormalizedAdEntity[] = [];
  let skipped = 0;

  for (const raw of page.rows) {
    const externalId = linkedInId(raw.id);
    const campaignId = linkedInId(raw.campaign);
    const groupId = campaignId ? context.groupByCampaign.get(campaignId) : null;

    if (!externalId || !campaignId || !groupId) {
      skipped += 1;
      continue;
    }

    const status = text(raw.intendedStatus);

    rows.push({
      ...BASE,
      entityLevel: 'ad',
      externalId,
      parentExternalId: campaignId,
      campaignExternalId: groupId,
      // Creatives carry no name; the id is the honest fallback label.
      name: `Criativo ${externalId}`,
      status: mapLinkedInStatus(status),
      effectiveStatus: mapLinkedInStatus(status),
      creativeId: externalId,
      currency: context.currency,
      providerCreatedTime: epoch(raw.createdAt),
      providerUpdatedTime: epoch(raw.lastModifiedAt),
      metadata: {
        linkedinStatus: status,
        isServing: raw.isServing === true,
      },
    });
  }

  return { rows, truncated: page.truncated, skipped, apiCalls: page.apiCalls };
}
