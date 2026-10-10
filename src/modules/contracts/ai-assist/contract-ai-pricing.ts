import type { AiCostEntryInput } from '../../ai-costs/ai-cost-ledger.service';

/** Append immutable versions only after the operator confirms text-model prices. */
export type ContractAiPricingVersion = {
  readonly version: string;
  readonly model: string;
  readonly effectiveFrom: string;
  readonly currency: string;
  readonly perMillionTokens: Readonly<
    Record<'input_tokens' | 'cached_input_tokens' | 'output_tokens', string>
  >;
};

export const CONTRACT_AI_PRICING_VERSIONS: readonly ContractAiPricingVersion[] =
  [];

/** E1 has no confirmed price, even when the response reports every token. */
export const CONTRACT_AI_UNPRICED_COST: AiCostEntryInput['cost'] =
  Object.freeze({ status: 'unknown', reason: 'unpriced' });
