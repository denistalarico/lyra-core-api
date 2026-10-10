/**
 * CS6-B — versioned price table for image generation, by token.
 *
 * The Images API returns no money, only usage (CS3.3), so the cost is
 * `lyra_calculated`: provider-reported tokens × the price of the version in
 * force when the generation happened. Each version has an `effectiveFrom`; a
 * generation is priced by the latest version whose `effectiveFrom` is not
 * after its `occurred_at`, and by nothing else. A generation older than every
 * version, a model no version lists, or a nonzero metric no version prices is
 * left `unknown` — never partially priced, never zero.
 *
 * Changing a price = appending a version with a later `effectiveFrom`. Never
 * edit a published version: ledger rows already carry its name.
 *
 * `openai.images.standard.2026-10-06`: the official OpenAI pricing page as consulted
 * and recorded in the CS3.3 report on 2026-10-06, Standard processing (per 1M
 * tokens, Flare / Sunburst / gpt-image-2): text input US$ 5.00, image input
 * US$ 8.00, image output US$ 30.00 — reconfirmed by the operator on
 * 2026-10-09. The usage the adapter persists has no cached-token metric
 * (no input cache on the Images API, CS3.4.2), so the cached rates are not
 * listed; a nonzero unlisted metric would make the call `unknown`. Only the model that actually runs in Lyra is listed; the
 * others are not, because their exact snapshot ids were never recorded.
 */

/**
 * OpenAI processing tier the prices apply to. Lyra calls the synchronous
 * Images API (`/v1/images/generations`, `/v1/images/edits`): Standard. Batch
 * has other prices and is not used, so no Batch version exists.
 */
export type ImagePricingTier = 'standard';

export type ImageTokenPricingVersion = {
  readonly version: string;
  readonly provider: string;
  readonly tier: ImagePricingTier;
  readonly effectiveFrom: string;
  readonly currency: string;
  /** Models priced by this version: exact snapshot id or its alias. */
  readonly models: readonly string[];
  /** USD per 1M tokens, keyed by the persisted usage metric. */
  readonly perMillionTokens: Readonly<Record<string, string>>;
};

export const IMAGE_TOKEN_PRICING: readonly ImageTokenPricingVersion[] = [
  {
    version: 'openai.images.standard.2026-10-06',
    provider: 'openai',
    tier: 'standard',
    effectiveFrom: '2026-10-06T00:00:00.000Z',
    currency: 'USD',
    models: ['gpt-image-2.5-flare-2026-09-08', 'gpt-image-2.5-flare'],
    perMillionTokens: {
      input_text_tokens: '5.00',
      input_image_tokens: '8.00',
      output_image_tokens: '30.00',
    },
  },
];

/**
 * Metrics that are totals or counts of what the priced metrics already
 * describe; never priced on their own (would double count).
 */
const DERIVED_METRICS = new Set([
  'input_tokens',
  'output_tokens',
  'total_tokens',
  'images',
]);

const SCALE = 6;
const RATE_SCALE = 6;

export type ImageCostCalculation =
  | {
      status: 'known';
      version: string;
      tier: ImagePricingTier;
      currency: string;
      amount: string;
      tokens: string;
      rates: Readonly<Record<string, string>>;
    }
  | { status: 'unknown'; reason: 'unpriced' | 'usage_missing' };

export function priceImageGeneration(input: {
  provider: string;
  model: string | null;
  metrics: Record<string, number> | null;
  occurredAt: Date;
  table?: readonly ImageTokenPricingVersion[];
}): ImageCostCalculation {
  if (!input.metrics || !Object.keys(input.metrics).length)
    return { status: 'unknown', reason: 'usage_missing' };
  const version = versionAt(
    input.table ?? IMAGE_TOKEN_PRICING,
    input.provider,
    input.model,
    input.occurredAt,
  );
  if (!version) return { status: 'unknown', reason: 'unpriced' };
  // Σ tokens × price-per-1M, kept exact as an integer of 10^-(RATE_SCALE)
  // units × tokens, divided by 10^6 once and rounded half-up to 6 places.
  let numerator = 0n;
  let tokens = 0n;
  for (const [metric, raw] of Object.entries(input.metrics)) {
    if (DERIVED_METRICS.has(metric)) continue;
    if (!Number.isSafeInteger(raw) || raw < 0)
      return { status: 'unknown', reason: 'usage_missing' };
    if (raw === 0) continue;
    const rate = version.perMillionTokens[metric];
    if (rate === undefined) return { status: 'unknown', reason: 'unpriced' };
    numerator += BigInt(raw) * scaled(rate, RATE_SCALE);
    tokens += BigInt(raw);
  }
  // numerator is in 10^-RATE_SCALE USD per 1M tokens → /10^6 tokens.
  const divisor = 10n ** BigInt(6 + RATE_SCALE - SCALE);
  const amount = (numerator + divisor / 2n) / divisor;
  return {
    status: 'known',
    version: version.version,
    tier: version.tier,
    currency: version.currency,
    amount: decimal(amount, SCALE),
    tokens: tokens.toString(),
    rates: version.perMillionTokens,
  };
}

function versionAt(
  table: readonly ImageTokenPricingVersion[],
  provider: string,
  model: string | null,
  at: Date,
): ImageTokenPricingVersion | null {
  if (!model) return null;
  let found: ImageTokenPricingVersion | null = null;
  for (const version of table) {
    if (version.provider !== provider || !version.models.includes(model))
      continue;
    if (Date.parse(version.effectiveFrom) > at.getTime()) continue;
    if (!found || version.effectiveFrom > found.effectiveFrom) found = version;
  }
  return found;
}

function scaled(value: string, scale: number): bigint {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole + fraction.padEnd(scale, '0').slice(0, scale));
}

function decimal(value: bigint, scale: number): string {
  const digits = value.toString().padStart(scale + 1, '0');
  return `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}
