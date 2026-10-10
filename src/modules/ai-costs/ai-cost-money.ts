/**
 * CS6-B — exact money for the AI cost ledger. Amounts are `numeric(18,6)` in
 * the database and decimal strings here; they never pass through a JS float.
 * Different currencies are never added together: there is no FX (see the
 * CS6-B currency policy), so a total is always a list, one entry per currency.
 */

export const AI_COST_SCALE = 6;

export type AiCostCurrencyAmount = {
  readonly currency: string;
  readonly amount: string;
};

const DECIMAL = /^\d{1,14}(\.\d+)?$/;

/** Decimal string → integer of 10^-scale units (extra digits truncated). */
export function toScaled(value: string, scale = AI_COST_SCALE): bigint {
  if (!DECIMAL.test(value)) throw new Error('invalid decimal');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole + fraction.padEnd(scale, '0').slice(0, scale));
}

export function fromScaled(value: bigint, scale = AI_COST_SCALE): string {
  const digits = value.toString().padStart(scale + 1, '0');
  return `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

/** Exact per-currency sum, currencies sorted for a stable contract. */
export function sumByCurrency(
  amounts: readonly { currency: string | null; amount: string | null }[],
): AiCostCurrencyAmount[] {
  const totals = new Map<string, bigint>();
  for (const { currency, amount } of amounts) {
    if (currency === null || amount === null) continue;
    totals.set(currency, (totals.get(currency) ?? 0n) + toScaled(amount));
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, total]) => ({ currency, amount: fromScaled(total) }));
}
