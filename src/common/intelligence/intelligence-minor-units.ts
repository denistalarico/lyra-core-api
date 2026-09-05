/**
 * Money as an exact integer count of a currency's smallest unit.
 *
 * The anonymous contribution table stores every metric in one `bigint` column
 * (`leadflow_product_telemetry_daily.metric_value`), and that column is shared
 * with consent and audit data this slice may not migrate. Spend, however,
 * arrives from `social_ad_metrics_daily.spend` as PostgreSQL `numeric` — a
 * decimal. Something has to bridge the two, and the only bridge that does not
 * lose money is an exact decimal→integer conversion.
 *
 * ## Why not just multiply by 100
 *
 * Two reasons, and the second is the one that bites.
 *
 * `6.64 * 100` is `663.9999999999999` in IEEE-754. Rounding that back is
 * correct *here* and wrong often enough elsewhere that the arithmetic below
 * never converts to a float at all: it works on the decimal string the driver
 * already returns, shifting the point by moving characters.
 *
 * And the exponent is not universally 2. ISO 4217 assigns JPY and KRW zero
 * decimal places, and BHD, JOD, KWD and TND three. A hardcoded `* 100` reports
 * a Japanese advertiser's ¥1.000 spend as ¥100.000 — a hundredfold error that
 * looks entirely plausible in a benchmark and would never be questioned. The
 * decisions for this slice say explicitly: *"não assumir universalmente que
 * minor unit = centavos / 2 casas"*.
 *
 * ## Relationship to `parseMinorUnits`
 *
 * `meta-ads-entity.normalizer.ts` already has `parseMinorUnits`, and this is
 * deliberately not a replacement for it. That function reads Meta *budget*
 * fields, which the Marketing API already delivers as integer minor units — its
 * job is to validate an integer, and it correctly never divides or multiplies.
 * This function reads *insights spend*, which arrives as a decimal amount in
 * major units. Different input shape, different job; sharing one function would
 * mean one of the two callers passing a flag to say which kind of number it
 * holds, which is how a budget eventually gets multiplied by a hundred.
 */

/**
 * Currencies whose minor-unit exponent is not 2, per ISO 4217.
 *
 * Only the exceptions are listed; everything absent uses the default of 2. A
 * complete table would be 180 rows that mostly say "2" and would still need
 * this same fallback for a currency added after it was written.
 *
 * The list is not exhaustive of all ISO exceptions — it covers the zero- and
 * three-decimal currencies a Meta ad account can actually bill in. An unlisted
 * currency is not guessed at beyond the default: see `minorUnitExponent`.
 */
const MINOR_UNIT_EXPONENTS: ReadonlyMap<string, number> = new Map([
  // Zero-decimal: the amount *is* the minor unit.
  ['JPY', 0],
  ['KRW', 0],
  ['VND', 0],
  ['CLP', 0],
  ['ISK', 0],
  ['PYG', 0],
  ['UGX', 0],
  ['RWF', 0],
  ['XAF', 0],
  ['XOF', 0],
  ['XPF', 0],
  ['KMF', 0],
  ['DJF', 0],
  ['GNF', 0],
  ['BIF', 0],
  ['VUV', 0],
  // Three-decimal.
  ['BHD', 3],
  ['IQD', 3],
  ['JOD', 3],
  ['KWD', 3],
  ['LYD', 3],
  ['OMR', 3],
  ['TND', 3],
]);

/** The exponent every currency not listed above uses. */
export const DEFAULT_MINOR_UNIT_EXPONENT = 2;

/**
 * How many decimal places this currency's minor unit implies.
 *
 * An unknown code returns the default rather than throwing. That is the safe
 * direction for a benchmark: the alternative is that a currency Meta starts
 * reporting tomorrow takes the contribution path down, and a contribution that
 * fails is a contributor silently missing from a cohort — which changes a
 * benchmark's numbers without changing anything visible.
 */
export function minorUnitExponent(currency: string): number {
  return (
    MINOR_UNIT_EXPONENTS.get(currency.trim().toUpperCase()) ??
    DEFAULT_MINOR_UNIT_EXPONENT
  );
}

/**
 * A decimal amount in major units → an exact integer count of minor units.
 *
 * Returns a `bigint` because the destination column is `bigint` and because the
 * intermediate value must never be a `number`: a large account's yearly spend in
 * a zero-decimal currency can exceed `Number.MAX_SAFE_INTEGER` once summed, and
 * the failure mode of exceeding it is a silently wrong total rather than an
 * error.
 *
 * ## Rounding
 *
 * The conversion is exact whenever the input has no more decimal places than the
 * currency allows, which is the case for every value this pipeline has seen —
 * Meta reports spend at the currency's own precision. When the input carries
 * *more* precision than the currency (a fractional cent, which Meta does emit
 * for very small spends under some optimisation modes), the extra digits are
 * rounded half-up rather than truncated. Truncation biases every conversion
 * toward zero, and a benchmark of a thousand truncated contributions understates
 * spend systematically — a bias, not noise, and therefore not one that averages
 * out across contributors.
 *
 * Throws on anything that is not a finite non-negative decimal. Spend cannot be
 * negative, and a caller holding `NaN` has a bug that must not become a `0` in
 * a shared cohort.
 */
export function toMinorUnits(
  amount: string | number,
  currency: string,
): bigint {
  const exponent = minorUnitExponent(currency);
  const text =
    typeof amount === 'number' ? decimalFromNumber(amount) : amount.trim();

  if (!/^\d+(\.\d+)?$/.test(text)) {
    throw new Error(
      `toMinorUnits: expected a non-negative decimal, received "${text}".`,
    );
  }

  const [whole, fraction = ''] = text.split('.');

  // Pad or round the fractional part to exactly `exponent` digits. Padding is
  // the common case; the slice only does work when the provider sent more
  // precision than the currency has.
  const kept = fraction.slice(0, exponent).padEnd(exponent, '0');
  const shifted = BigInt(whole + kept);

  const nextDigit = fraction.charCodeAt(exponent);
  // charCodeAt returns NaN past the end, and NaN >= 53 is false — so an input
  // with no excess precision takes no rounding, without a length check.
  const roundsUp = nextDigit >= 0x35; // '5'

  return roundsUp ? shifted + 1n : shifted;
}

/**
 * The inverse, for presentation only.
 *
 * Returns a decimal *string*, never a number: handing back a float would undo
 * the exactness the whole file exists for, one caller at a time. Nothing in the
 * benchmark read path calls this — it exists so a UI or a test can render a
 * stored value without reimplementing the exponent table.
 */
export function fromMinorUnits(
  minor: bigint | string,
  currency: string,
): string {
  const exponent = minorUnitExponent(currency);
  const value = typeof minor === 'bigint' ? minor : BigInt(minor);

  if (exponent === 0) return value.toString();

  const negative = value < 0n;
  const digits = (negative ? -value : value)
    .toString()
    .padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = digits.slice(digits.length - exponent);

  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/**
 * `String(n)` for a number known to be finite, without exponential notation.
 *
 * `String(1e21)` is `"1e+21"`, which the decimal pattern above rejects — and
 * rejecting it is right, but the message would be confusing. `toFixed(20)`
 * keeps the digits positional; the trailing zeros are stripped so the value
 * reaching `toMinorUnits` looks like what the caller passed.
 */
function decimalFromNumber(amount: number): string {
  if (!Number.isFinite(amount)) {
    throw new Error(
      `toMinorUnits: expected a finite amount, received ${amount}.`,
    );
  }

  return amount.toFixed(20).replace(/0+$/, '').replace(/\.$/, '');
}
