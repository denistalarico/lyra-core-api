import { normalizeAdAccountId } from '../meta-ad-account-id';
import { isNonEmptyString, isRecord } from '../oauth/meta-ads-oauth.support';
import type { NormalizedAdEntity } from './meta-ads-entity.contract';
import { resolvePaidMediaDestination } from './paid-media-destination';

/**
 * Turns Meta payloads into `NormalizedAdEntity` rows.
 *
 * Pure functions, no I/O, no repository: the mapping is where the provider's
 * quirks are actually handled, and it should be testable by handing it a
 * payload rather than by standing up a sync. Every function returns `null` for
 * a row it cannot key — an object with no id could not be upserted, matched on
 * a later run, or deleted afterwards, so storing it would create a row nothing
 * can ever reach.
 */

/** Column widths, so a provider string can never abort a write. */
const MAX_STATUS = 40;
const MAX_LONG_ENUM = 60;
const MAX_EXTERNAL_ID = 180;
const MAX_CURRENCY = 8;

/**
 * Reads a Meta timestamp.
 *
 * Meta sends ISO 8601 with a compact offset (`2026-08-20T13:45:00-0700`), which
 * is legal ISO but not the form `Date` is specified to parse — engines accept
 * it by extension, and an engine that stops doing so would silently turn every
 * campaign's dates into NULL. Expanding the offset to `-07:00` first makes the
 * parse standard rather than lucky.
 */
export function parseMetaTime(value: unknown): Date | null {
  if (!isNonEmptyString(value)) return null;

  const normalized = value.trim().replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const parsed = new Date(normalized);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Reads a Meta money field, which is always an integer count of minor units.
 *
 * The Marketing API documents budgets as "defined in your account currency's
 * minimum denomination" — `"1000"` on a BRL account is R$ 10,00, and the
 * account's own `currency` node carries the offset that says so. Nothing here
 * divides: a float conversion at ingest time is a rounding error that then
 * propagates into every derived KPI, and the column is `bigint` precisely so
 * the provider's own integer survives intact.
 *
 * Anything that is not a non-negative integer becomes `null`. That covers the
 * absent field, and it also covers a value this parser does not understand —
 * writing an unparsed budget would either violate the non-negative check and
 * abort the batch, or store a number nobody can explain.
 */
export function parseMinorUnits(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  }

  if (!isNonEmptyString(value)) return null;

  const candidate = value.trim();

  if (!/^\d+$/.test(candidate)) return null;

  // Canonical form, so `"0010"` and `"10"` are the same stored value and a
  // re-read of the same budget does not look like a change.
  return BigInt(candidate).toString();
}

/** A provider id, trimmed and length-bounded. Empty and non-strings drop out. */
export function parseExternalId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return String(value);
  }

  if (!isNonEmptyString(value)) return null;

  const candidate = value.trim();

  return candidate.length && candidate.length <= MAX_EXTERNAL_ID
    ? candidate
    : null;
}

function text(value: unknown, max: number): string | null {
  if (typeof value === 'number') return String(value).slice(0, max);
  if (!isNonEmptyString(value)) return null;

  const candidate = value.trim();

  return candidate.length ? candidate.slice(0, max) : null;
}

/** Everything every level shares, so no level can forget one of them. */
function base(
  payload: Record<string, unknown>,
  currency: string | null,
): Omit<
  NormalizedAdEntity,
  'entityLevel' | 'externalId' | 'parentExternalId' | 'campaignExternalId'
> {
  return {
    name: text(payload.name, 4000),
    status: text(payload.status, MAX_STATUS),
    effectiveStatus: text(payload.effective_status, MAX_LONG_ENUM),
    objective: text(payload.objective, MAX_LONG_ENUM),
    optimizationGoal: text(payload.optimization_goal, MAX_LONG_ENUM),
    billingEvent: text(payload.billing_event, MAX_LONG_ENUM),
    // Null for every level by default. Only the ad set overrides these, because
    // it is the only level whose payload carries `destination_type` at all.
    destinationType: null,
    destinationRaw: null,
    destinationObservedAt: null,
    destinationObserved: false,
    dailyBudgetMinor: parseMinorUnits(payload.daily_budget),
    lifetimeBudgetMinor: parseMinorUnits(payload.lifetime_budget),
    budgetRemainingMinor: parseMinorUnits(payload.budget_remaining),
    currency,
    startTime: parseMetaTime(payload.start_time),
    // Campaigns end at `stop_time`, ad sets at `end_time`. Two names for one
    // column, read in the order that lets either edge fill it.
    stopTime: parseMetaTime(payload.stop_time ?? payload.end_time),
    providerCreatedTime: parseMetaTime(payload.created_time),
    providerUpdatedTime: parseMetaTime(payload.updated_time),
    metadata: {},
  };
}

/**
 * The account node.
 *
 * `external_id` is the canonical `act_<digits>` handle rather than whatever
 * spelling the payload happened to use — Meta sends `id` prefixed and
 * `account_id` bare, and the two must not become two rows for one account.
 *
 * The account's `status` is Meta's numeric `account_status` kept verbatim (1 is
 * active, 2 disabled, 101 closed…). Mapping those numbers to words here would
 * be inventing a vocabulary the provider does not publish as stable; the raw
 * code is at least unambiguous, and S1 already stores it the same way.
 */
export function normalizeAccount(
  payload: unknown,
  fallbackAccountId: string,
): NormalizedAdEntity | null {
  if (!isRecord(payload)) return null;

  const externalId =
    normalizeAdAccountId(payload.id) ??
    normalizeAdAccountId(payload.account_id) ??
    normalizeAdAccountId(fallbackAccountId);

  if (!externalId) return null;

  const currency = text(payload.currency, MAX_CURRENCY)?.toUpperCase() ?? null;
  const business = isRecord(payload.business) ? payload.business : null;

  return {
    ...base(payload, currency),
    entityLevel: 'account',
    externalId,
    // The root of the tree: a parent here would mean the sync mistook a
    // campaign for its account, and the table's check constraint refuses it.
    parentExternalId: null,
    campaignExternalId: null,
    name: text(payload.name, 4000),
    status: text(payload.account_status, MAX_STATUS),
    metadata: {
      // Auxiliary because there is no column for either, and both answer
      // questions a reader would otherwise pay another Graph call for.
      ...(text(payload.timezone_name, 64)
        ? { timezone: text(payload.timezone_name, 64) }
        : {}),
      ...(business && isNonEmptyString(business.id)
        ? { businessId: business.id.trim() }
        : {}),
      ...(business && isNonEmptyString(business.name)
        ? { businessName: business.name.trim() }
        : {}),
    },
  };
}

/**
 * A campaign, parented to the account it was read from.
 *
 * The account id comes from the caller rather than from the payload: the
 * campaigns edge does not return one, and the account being synced is known
 * with certainty by whoever issued the read.
 */
export function normalizeCampaign(
  payload: unknown,
  context: { accountExternalId: string; currency: string | null },
): NormalizedAdEntity | null {
  if (!isRecord(payload)) return null;

  const externalId = parseExternalId(payload.id);

  if (!externalId) return null;

  return {
    ...base(payload, context.currency),
    entityLevel: 'campaign',
    externalId,
    parentExternalId: context.accountExternalId,
    // A campaign is its own campaign. Filling this at every level below the
    // account is what lets "spend by campaign" read one column instead of
    // walking the tree upward.
    campaignExternalId: externalId,
  };
}

/**
 * An ad set, parented to its campaign.
 *
 * A missing `campaign_id` degrades to a rootless row rather than dropping the
 * ad set or aborting the run: the object exists, it will carry spend, and a
 * name attached to nothing is still better than spend attached to nothing. The
 * table deliberately does not constrain this (only an account may not have a
 * parent).
 *
 * The only level that resolves a destination, because it is the only level Meta
 * states one for — asking the campaigns or ads edge for `destination_type`
 * returns rows without the field rather than rows with a null.
 */
export function normalizeAdSet(
  payload: unknown,
  context: { currency: string | null; observedAt: Date },
): NormalizedAdEntity | null {
  if (!isRecord(payload)) return null;

  const externalId = parseExternalId(payload.id);

  if (!externalId) return null;

  const campaignExternalId = parseExternalId(payload.campaign_id);
  const destination = resolvePaidMediaDestination(payload);

  return {
    ...base(payload, context.currency),
    entityLevel: 'adset',
    externalId,
    parentExternalId: campaignExternalId,
    campaignExternalId,
    destinationType: destination.canonical,
    destinationRaw: destination.providerValue,
    /**
     * The provider said something about the destination.
     *
     * A non-null `providerValue` is exactly that test, and it deliberately
     * includes Meta's explicit `UNDEFINED` — an advertiser who configured no
     * destination is a real, observed state — while excluding an absent field,
     * which is provider silence and no evidence at all.
     */
    destinationObserved: destination.providerValue !== null,
    /**
     * Stamped whenever the ad set was read, including when the destination came
     * back unknown.
     *
     * "Meta was asked at time T and had nothing to say" is itself a fact worth
     * keeping: without the stamp, an unknown destination is indistinguishable
     * from an ad set that predates this feature and was never asked at all.
     */
    destinationObservedAt: context.observedAt,
  };
}

/**
 * An ad, parented to its ad set.
 *
 * `campaign_id` is taken from the payload when Meta sends it and otherwise
 * resolved through the ad sets read moments earlier in the same sync. That
 * lookup is the point: the alternative is one extra Graph call per ad, which on
 * an account with a few thousand ads is a few thousand calls against a shared
 * business quota to learn something the previous level already said.
 */
export function normalizeAd(
  payload: unknown,
  context: {
    currency: string | null;
    campaignByAdSetId: ReadonlyMap<string, string>;
  },
): NormalizedAdEntity | null {
  if (!isRecord(payload)) return null;

  const externalId = parseExternalId(payload.id);

  if (!externalId) return null;

  const adSetExternalId = parseExternalId(payload.adset_id);
  const campaignExternalId =
    parseExternalId(payload.campaign_id) ??
    (adSetExternalId
      ? (context.campaignByAdSetId.get(adSetExternalId) ?? null)
      : null);

  return {
    ...base(payload, context.currency),
    entityLevel: 'ad',
    externalId,
    parentExternalId: adSetExternalId,
    campaignExternalId,
  };
}
