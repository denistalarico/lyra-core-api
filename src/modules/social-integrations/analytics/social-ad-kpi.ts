import { formatScaledAmount } from '../sync/metric-number';

/**
 * KPI derivation, in exact decimal, at read time only.
 *
 * None of these values is stored, and the reason is the same one the fact table
 * gives for having no ratio columns: a stored quotient is only correct for the
 * grain it was computed at. A CTR saved per day cannot be summed, averaged or
 * re-sliced — averaging a thousand-impression day against a million-impression
 * one weights them equally and produces a number that is not the CTR of
 * anything. Derived here, every KPI is the quotient of two sums, which is the
 * only definition that survives an arbitrary date range.
 *
 * Everything is `bigint` scaled to six decimal places, matching the
 * `numeric(18,6)` columns the sums come from. No `Number` appears in any
 * arithmetic path: a quarter of ad spend in binary floating point drifts, and
 * these numbers are what a client is invoiced against.
 */

/** Decimal places carried by every derived value, as in the fact columns. */
const SCALE = 6;
const SCALE_FACTOR = 10n ** BigInt(SCALE);

/** Impressions per CPM unit. */
const CPM_BASIS = 1000n;

/** Percentages are reported as a percentage, so the quotient is scaled by 100. */
const PERCENT_BASIS = 100n;

/**
 * Divides two scaled decimals, or answers `null`.
 *
 * A zero denominator is `null`, never `0` and never `Infinity`. "No clicks yet"
 * and "a cost per click of zero" are different facts about a campaign, and a
 * dashboard that renders the first as `R$ 0.00` tells the reader the campaign is
 * free. `null` is the only honest answer, and it is what the API contract
 * promises for every KPI.
 *
 * Rounds half-up at the sixth decimal, which is what Postgres does on insert
 * into `numeric(18,6)` — so a derived value and a stored one of the same
 * quantity agree.
 */
export function divideScaled(
  numerator: bigint,
  denominator: bigint,
): bigint | null {
  if (denominator === 0n) return null;

  // Multiply before dividing: the scale has to survive the division, and doing
  // it the other way truncates every fractional result to zero.
  const scaled = numerator * SCALE_FACTOR;
  const quotient = scaled / denominator;
  const remainder = scaled % denominator;

  // Half-up on the absolute remainder. Every input here is non-negative — the
  // fact table's CHECK constraint guarantees it — but comparing doubled
  // remainders keeps the rule correct rather than merely correct-for-now.
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

/** A derived value as the decimal string the API returns, or `null`. */
export function formatDerived(value: bigint | null): string | null {
  return value === null ? null : formatScaledAmount(value);
}

/**
 * The eight aggregated inputs every KPI is derived from.
 *
 * Counts and amounts are both `bigint` here, but they mean different things:
 * counts are whole units, amounts are already scaled by 1e6. Mixing them up is
 * the one error this module can make silently, so the field names say which is
 * which and the functions below never take a bare pair.
 */
export type SocialAdKpiInputs = {
  /** Scaled to 1e6. */
  spend: bigint;
  impressions: bigint;
  clicks: bigint;
  linkClicks: bigint;
  leads: bigint;
  /** Scaled to 1e6 — Meta's action values are fractional under attribution. */
  conversions: bigint;
  /** Scaled to 1e6. */
  conversionValue: bigint;
  videoViews: bigint;
};

export type SocialAdKpis = {
  ctr: string | null;
  cpc: string | null;
  cpm: string | null;
  cpl: string | null;
  cpa: string | null;
  roas: string | null;
};

/**
 * Every KPI for one aggregate, each `null` where its denominator is zero.
 *
 * The denominators are chosen deliberately and each one is a claim:
 *
 * - **CTR** uses `clicks`, all of them, not `link_clicks`. Meta's own `ctr`
 *   field is all-clicks, and reporting a different definition under the same
 *   name is how a number stops reconciling with Ads Manager.
 * - **CPC** uses `clicks` for the same reason.
 * - **CPL** divides by `leads`, the promoted column the action-family rules
 *   already de-duplicated — Meta reports one lead under up to seven type names,
 *   and dividing by a naive sum of those would understate cost per lead
 *   sevenfold.
 * - **CPA** divides by `conversions`, which is fractional and scaled: a
 *   conversion credited across two ads is two halves, and rounding it to a whole
 *   before dividing would inflate the cost of every split conversion.
 * - **ROAS** is a ratio of two money columns, so the scales cancel and the
 *   result is a bare multiplier — `3.500000` means three and a half times, not
 *   R$ 3.50.
 */
export function deriveSocialAdKpis(inputs: SocialAdKpiInputs): SocialAdKpis {
  return {
    ctr: formatDerived(
      divideScaled(inputs.clicks * PERCENT_BASIS, inputs.impressions),
    ),
    cpc: formatDerived(divideCost(inputs.spend, inputs.clicks)),
    cpm: formatDerived(
      divideCost(inputs.spend * CPM_BASIS, inputs.impressions),
    ),
    cpl: formatDerived(divideCost(inputs.spend, inputs.leads)),
    // Both operands are scaled, so the denominator is un-scaled first to keep
    // the quotient in money rather than in money-per-1e6-conversions.
    cpa: formatDerived(divideScaled(inputs.spend, inputs.conversions)),
    roas: formatDerived(divideScaled(inputs.conversionValue, inputs.spend)),
  };
}

/**
 * Cost per whole unit: a scaled amount over an unscaled count.
 *
 * The count is scaled up to meet the amount rather than the amount scaled down,
 * because scaling the amount down would discard the six decimals before the
 * division that needs them.
 */
function divideCost(scaledAmount: bigint, count: bigint): bigint | null {
  return divideScaled(scaledAmount, count * SCALE_FACTOR);
}

/**
 * The period-over-period movement of one metric.
 *
 * `absolute` is always present — a difference of two known numbers is always
 * knowable. `percent` is `null` when the previous value is zero, and that case
 * is not an edge case: it is every campaign's first period. Growth from nothing
 * has no percentage, and rendering it as `+100%` or `+∞%` are both inventions.
 */
export type SocialAdChange = {
  absolute: string;
  percent: string | null;
};

export function deriveChange(
  current: bigint,
  previous: bigint,
): SocialAdChange {
  const absolute = current - previous;

  return {
    absolute: formatSigned(absolute),
    percent: formatSigned(
      divideScaled(absolute * PERCENT_BASIS, previous) ?? undefined,
    ),
  };
}

/**
 * A signed scaled decimal as a string.
 *
 * `formatScaledAmount` is unsigned by design — it serves the fact columns,
 * which a CHECK constraint keeps non-negative. A change can legitimately be
 * negative, so the sign is handled here and the magnitude is delegated, rather
 * than reimplementing the digit assembly and risking a second, different
 * rounding rule.
 */
function formatSigned(value: bigint): string;
function formatSigned(value: bigint | undefined): string | null;
function formatSigned(value: bigint | undefined): string | null {
  if (value === undefined) return null;

  return value < 0n
    ? `-${formatScaledAmount(-value)}`
    : formatScaledAmount(value);
}
