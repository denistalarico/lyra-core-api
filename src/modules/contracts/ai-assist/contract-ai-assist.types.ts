import type {
  ContractAppliedMapping,
  ContractUnresolvedMapping,
  ContractVariableMapping,
} from './contract-ai-assist-apply';

export interface ContractAiAssistUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
}

export interface ContractAiAssistSuggestions {
  name: string | null;
  description: string | null;
  category: string | null;
  defaultSignatureMode: 'manual' | 'digital' | null;
  jurisdictionRegion: string | null;
  countryCode: string | null;
  locale: string | null;
}

export interface ContractAiAssistReviewNote {
  kind: 'missing_variable' | 'ambiguous' | 'legal_attention';
  message: string;
  excerpt: string | null;
}

export interface ContractAiAssistOutput {
  replacements: ContractVariableMapping[];
  headings: string[];
  suggestions: ContractAiAssistSuggestions;
  reviewNotes: ContractAiAssistReviewNote[];
}

export interface ContractAiAssistProviderResult {
  output: ContractAiAssistOutput;
  model: string;
  usage: ContractAiAssistUsage;
  paid: boolean;
}

export interface ContractAiAssistResult {
  runId: string;
  model: string;
  promptVersion: string;
  bodyHtml: string;
  suggestions: ContractAiAssistSuggestions;
  replacements: ContractAppliedMapping[];
  unresolved: ContractUnresolvedMapping[];
  reviewNotes: ContractAiAssistReviewNote[];
  usage: { inputTokens: number | null; outputTokens: number | null };
}

/** Contains safe codes and counters only, never a provider body or legal text. */
export class ContractAiAssistProviderError extends Error {
  constructor(
    readonly reason: string,
    readonly paid = false,
    readonly usage: ContractAiAssistUsage = {},
  ) {
    super('contract_ai_provider_failed');
  }
}
