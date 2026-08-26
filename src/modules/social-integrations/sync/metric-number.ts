/**
 * Number parsing for ad facts, in decimal, never in floating point.
 *
 * Every value Meta reports arrives as a string — `"13.42"`, `"5351"`, `"4"` —
 * and every column it lands in is `numeric` or `bigint`. Routing those through
 * a JS number would introduce two separate errors on the way: binary rounding
 * on the money columns, and silent precision loss above 2^53 on the counts.
 * Both are invisible until a quarter is summed and the total is off by cents.
 *
 * So the values stay decimal end to end. Fractional amounts are carried as
 * `bigint` scaled to the column's six decimal places, counts as `bigint`
 * outright, and both are formatted back to a decimal string for TypeORM, which
 * is what `numeric` and `bigint` columns take and give back anyway.
 *
 * The other rule here is that a value this module cannot read is `null`, never
 * a substitute. A malformed payload turning into a valid-looking `0` is how a
 * parsing bug becomes a client-facing number that nobody can tell is wrong.
 */

/** Decimal places of the `numeric(18,6)` fact columns. */
const SCALE = 6;
const SCALE_FACTOR = 10n ** BigInt(SCALE);

/** `9223372036854775807` — the `bigint` column ceiling. */
const MAX_BIGINT = 9_223_372_036_854_775_807n;

/** Ceiling of `numeric(18,6)`: eighteen digits total, six of them fractional. */
const MAX_SCALED = 10n ** 18n - 1n;

const DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/;
const INTEGER_PATTERN = /^\d+$/;

/**
 * A decimal amount, scaled to six places, or `null` if it cannot be read.
 *
 * Negative values are refused rather than stored. The table's CHECK constraint
 * would reject them anyway, and every one of these columns is a count or an
 * amount of money spent: a negative is a parsing failure upstream (a currency
 * string read as signed, a subtraction against a missing baseline), not a fact.
 *
 * More than six fractional digits are rounded half-up, which is exactly what
 * Postgres does on insert into `numeric(18,6)`. Rounding here rather than there
 * keeps the value this code believes it wrote identical to the stored one.
 */
export function parseScaledAmount(value: unknown): bigint | null {
  const candidate = readNumericText(value);

  if (candidate === null || !DECIMAL_PATTERN.test(candidate)) return null;

  const [whole, fraction = ''] = candidate.split('.');

  // One extra digit is kept to decide the rounding, then dropped.
  const padded = fraction.padEnd(SCALE + 1, '0');
  const kept = padded.slice(0, SCALE);
  const next = padded.charCodeAt(SCALE) - 48;

  let scaled = BigInt(whole) * SCALE_FACTOR + BigInt(kept);

  if (next >= 5) scaled += 1n;

  return scaled > MAX_SCALED ? null : scaled;
}

/** A scaled amount back to the decimal string a `numeric` column accepts. */
export function formatScaledAmount(scaled: bigint): string {
  const whole = scaled / SCALE_FACTOR;
  const fraction = (scaled % SCALE_FACTOR).toString().padStart(SCALE, '0');

  return `${whole}.${fraction}`;
}

/** Parse straight to the stored string, for callers that do no arithmetic. */
export function parseAmountText(value: unknown): string | null {
  const scaled = parseScaledAmount(value);

  return scaled === null ? null : formatScaledAmount(scaled);
}

/**
 * A whole count, as the string a `bigint` column takes.
 *
 * Fractional input is refused. Impressions and clicks are events; a fractional
 * one means the field being read is not the field that was expected — Meta's
 * attribution-split values are fractional, and they belong in the `numeric`
 * columns, not here.
 */
export function parseCountText(value: unknown): string | null {
  const candidate = readNumericText(value);

  if (candidate === null || !INTEGER_PATTERN.test(candidate)) return null;

  const parsed = BigInt(candidate);

  return parsed > MAX_BIGINT ? null : parsed.toString();
}

/**
 * The text of a numeric payload value, whatever shape it arrived in.
 *
 * Meta's own responses are consistently strings, but the shape is not part of
 * any contract it publishes, so a number is accepted too — as long as it is a
 * safe integer, since a float that already lost precision cannot be recovered
 * by reading it more carefully here.
 */
function readNumericText(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && Number.isSafeInteger(value)
      ? String(value)
      : null;
  }

  if (typeof value !== 'string') return null;

  const trimmed = value.trim();

  return trimmed.length ? trimmed : null;
}
