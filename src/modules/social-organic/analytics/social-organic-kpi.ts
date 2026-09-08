/**
 * KPI derivation for organic analytics, at read time only.
 *
 * A small from-scratch reimplementation of the paid module's
 * `divideScaled`/half-up-rounding, not an import of it — matching this
 * module's existing precedent of not cross-importing paid-module internals
 * (`social-organic-analytics-time.ts` already reimplements day arithmetic
 * independently rather than importing paid's). The two modules' numbers are
 * never allowed to secretly share an implementation that could drift one
 * without the other noticing.
 *
 * Nothing here is stored: engagement rate (and any future organic ratio) is
 * only ever the quotient of two sums over the requested period, which is the
 * only definition that survives an arbitrary date range.
 */

/** Decimal places carried by every derived value. */
const SCALE = 6;
const SCALE_FACTOR = 10n ** BigInt(SCALE);

/** Percentages are reported as a percentage, so the quotient is scaled by 100. */
const PERCENT_BASIS = 100n;

/**
 * Divides two integers scaled to `SCALE_FACTOR`, or answers `null`.
 *
 * A zero (or null) denominator is `null`, never `0` and never `Infinity` —
 * "no reach yet" and "an engagement rate of zero" are different facts, and a
 * dashboard that renders the first as `0.00%` tells the reader the post got
 * no engagement rather than that reach was never measured.
 *
 * Rounds half-up at the sixth decimal, matching what Postgres does on insert
 * into a `numeric(18,6)` column, so a derived value agrees with a stored one
 * of the same quantity.
 */
export function divideScaled(
  numerator: bigint,
  denominator: bigint,
): bigint | null {
  if (denominator === 0n) return null;

  const scaled = numerator * SCALE_FACTOR;
  const quotient = scaled / denominator;
  const remainder = scaled % denominator;

  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

/** A derived scaled value as the decimal string the API returns, or `null`. */
export function formatDerived(value: bigint | null): string | null {
  if (value === null) return null;

  const whole = value / SCALE_FACTOR;
  const fraction = (value % SCALE_FACTOR).toString().padStart(SCALE, '0');

  return `${whole}.${fraction}`;
}

export type SocialOrganicEngagementRateInputs = {
  likes: bigint;
  comments: bigint;
  shares: bigint;
  saves: bigint;
  reach: bigint | null;
};

/**
 * Engagement rate = `(likes + comments + shares + saves) / reach * 100`
 * (the approved formula), `null` when summed reach is `null` or zero.
 *
 * Post-level only: the account table this A3 first pass reads has no
 * likes/comments/shares/saves counters at all, so this function exists here
 * ready for the deferred post-level `posts()` read where those inputs
 * actually come from `social_organic_post_metrics_daily`.
 */
export function deriveEngagementRate(
  inputs: SocialOrganicEngagementRateInputs,
): string | null {
  if (inputs.reach === null || inputs.reach === 0n) return null;

  const engagement =
    inputs.likes + inputs.comments + inputs.shares + inputs.saves;

  return formatDerived(divideScaled(engagement * PERCENT_BASIS, inputs.reach));
}
