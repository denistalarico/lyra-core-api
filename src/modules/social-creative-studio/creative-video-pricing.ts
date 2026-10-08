/**
 * CS4-B — raw AI cost of a video operation, as a SNAPSHOT.
 *
 * Talarico Labs bills clients exactly the AI cost (conversion, markup and
 * invoicing are CS6). So every operation persists enough to recompute or audit
 * its own cost forever, without reading today's price list:
 *
 *   units          what the provider consumed (Vidu credits; HeyGen seconds);
 *   unit_kind      what those units are;
 *   unit_price     price of ONE unit at the time, in `currency`;
 *   pricing_version which table that price came from;
 *   cost_amount    the money, exact decimal;
 *   cost_source    `provider_reported` (the provider returned money) or
 *                  `lyra_calculated` (units × unit_price).
 *
 * Neither provider returns money today (audited 2026-10): Vidu reports
 * `credits` on the task; HeyGen v3 reports the output `duration` and bills
 * per second by engine and avatar type. Both are therefore `lyra_calculated`
 * from provider-reported units. If a provider ever reports an official cost,
 * the adapter fills `reportedCost` and it wins (`provider_reported`), with the
 * units still kept.
 *
 * Currency is the provider's (USD). No BRL conversion here (CS6).
 *
 * Money never passes through a JS float: amounts are fixed-point integers of
 * 10^-SCALE units (`bigint`) and leave as decimal strings for `numeric`.
 */

/** Decimal places of every persisted amount (`numeric(18,6)`). */
const SCALE = 6;
/** Unit prices are kept with more precision (`numeric(18,8)`). */
const PRICE_SCALE = 8;

export type CreativeVideoCostSource = 'provider_reported' | 'lyra_calculated';

export type CreativeVideoCostSnapshot = {
  readonly units: string;
  readonly unitKind: string;
  readonly unitPrice: string;
  readonly pricingVersion: string;
  readonly costAmount: string;
  readonly costCurrency: string;
  readonly costSource: CreativeVideoCostSource;
};

/**
 * Vidu — one API credit. platform.vidu.com/docs/overview/pricing states
 * credits per second per model/resolution and that failed tasks consume no
 * credits (audited 2026-10-08: Q3 turbo 720p 12 cr/s; Q2 turbo extension
 * 720p "Starting at 15 credits, +5 credits/second" → +7 s ≈ 50 cr). Lyra
 * never estimates credits from that table: the ledger records the `credits`
 * Vidu reports for each finished task; the international account recharge page prices credits in USD
 * ($0.005 at audit time; the docs' Chinese table quotes ¥0.03125). The task
 * response already carries `credits`, so only the unit price is Lyra's.
 *
 * The operator MUST confirm this price against the account's own recharge
 * page before enabling (`CREATIVE_VIDEO_PRICING_CONFIRMED`); a negotiated or
 * package price is set with `CREATIVE_VIDEO_VIDU_CREDIT_PRICE_USD`, which
 * yields its own pricing version, so history never mixes the two.
 */
export const VIDU_PRICING = {
  version: 'vidu.credits.2026-10',
  currency: 'USD',
  unitKind: 'vidu_credit',
  creditPrice: '0.005',
} as const;

/**
 * HeyGen v3 pay-as-you-go, USD per second of output, by engine × avatar type.
 * Source: HeyGen API pricing (developers.heygen.com enterprise table converts
 * credits at $0.50; PAYG prices shown in app.heygen.com/developers/api
 * pricing modal, as audited 2026-10). Unknown combinations have NO price, and
 * a look whose combination is unpriced is never offered (the domain refuses
 * rather than bill an unknown amount).
 */
export const HEYGEN_PRICING = {
  version: 'heygen.payg.2026-10',
  currency: 'USD',
  unitKind: 'output_second',
  perSecond: {
    avatar_iii: {
      digital_twin: '0.0167',
      studio_avatar: '0.0167',
      photo_avatar: '0.0433',
    },
    avatar_iv: {
      digital_twin: '0.0667',
      studio_avatar: '0.0667',
      photo_avatar: '0.05',
    },
    avatar_v: {
      digital_twin: '0.0667',
    },
  } as Record<string, Record<string, string>>,
} as const;

export function viduPricing(override: string | null) {
  if (override === null) return { ...VIDU_PRICING };
  return {
    ...VIDU_PRICING,
    version: `vidu.credits.override-${override}`,
    creditPrice: override,
  };
}

export function heygenSecondPrice(engine: string, avatarType: string) {
  const engineTable = Object.hasOwn(HEYGEN_PRICING.perSecond, engine)
    ? HEYGEN_PRICING.perSecond[engine]
    : undefined;
  if (!engineTable || !Object.hasOwn(engineTable, avatarType)) return null;
  return engineTable[avatarType];
}

/** Vidu: provider-reported credits × the credit price of the snapshot. */
export function viduCostSnapshot(
  credits: number,
  pricing: ReturnType<typeof viduPricing>,
): CreativeVideoCostSnapshot {
  return calculated(
    String(credits),
    pricing.unitKind,
    pricing.creditPrice,
    pricing.version,
    pricing.currency,
  );
}

/**
 * HeyGen: billed seconds × per-second price. Seconds are the provider's own
 * `duration`, kept to the millisecond; HeyGen documents no rounding, so none
 * is invented here — the amount is rounded once, half-up, to 6 places.
 */
export function heygenCostSnapshot(
  seconds: number,
  engine: string,
  avatarType: string,
): CreativeVideoCostSnapshot | null {
  const price = heygenSecondPrice(engine, avatarType);
  if (price === null) return null;
  return calculated(
    seconds.toFixed(3),
    `${HEYGEN_PRICING.unitKind}:${engine}:${avatarType}`,
    price,
    HEYGEN_PRICING.version,
    HEYGEN_PRICING.currency,
  );
}

/** Official money from the provider wins; units are still recorded. */
export function providerReportedSnapshot(input: {
  units: string;
  unitKind: string;
  amount: string;
  currency: string;
  pricingVersion: string;
}): CreativeVideoCostSnapshot {
  return {
    units: input.units,
    unitKind: input.unitKind,
    unitPrice: '0',
    pricingVersion: input.pricingVersion,
    costAmount: toDecimal(toFixed(input.amount, SCALE), SCALE),
    costCurrency: input.currency,
    costSource: 'provider_reported',
  };
}

/**
 * Sum of operation costs, exact. Refuses to add currencies together (a
 * provider answering in a second currency is a contract change, not a sum).
 */
export function sumCosts(
  costs: readonly { costAmount: string | null; costCurrency: string | null }[],
): { amount: string; currency: string } | null {
  let total = 0n;
  let currency: string | null = null;
  for (const cost of costs) {
    if (cost.costAmount === null || cost.costCurrency === null) continue;
    if (currency !== null && currency !== cost.costCurrency)
      throw new Error('video cost currencies differ');
    currency = cost.costCurrency;
    total += toFixed(cost.costAmount, SCALE);
  }
  return currency === null
    ? null
    : { amount: toDecimal(total, SCALE), currency };
}

function calculated(
  units: string,
  unitKind: string,
  unitPrice: string,
  pricingVersion: string,
  currency: string,
): CreativeVideoCostSnapshot {
  // units (3 dp) × price (8 dp) = 11 dp, rounded half-up to 6.
  const product = toFixed(units, 3) * toFixed(unitPrice, PRICE_SCALE);
  const divisor = 10n ** BigInt(3 + PRICE_SCALE - SCALE);
  const amount = (product + divisor / 2n) / divisor;
  return {
    units: toDecimal(toFixed(units, 3), 3),
    unitKind,
    unitPrice: toDecimal(toFixed(unitPrice, PRICE_SCALE), PRICE_SCALE),
    pricingVersion,
    costAmount: toDecimal(amount, SCALE),
    costCurrency: currency,
    costSource: 'lyra_calculated',
  };
}

const DECIMAL = /^\d{1,12}(\.\d+)?$/;

export function isNonNegativeDecimal(value: string) {
  return DECIMAL.test(value);
}

/** Decimal string → fixed-point bigint, truncating digits beyond `scale`. */
function toFixed(value: string, scale: number): bigint {
  if (!DECIMAL.test(value)) throw new Error('invalid decimal');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole + fraction.padEnd(scale, '0').slice(0, scale));
}

function toDecimal(value: bigint, scale: number): string {
  const digits = value.toString().padStart(scale + 1, '0');
  return `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}
