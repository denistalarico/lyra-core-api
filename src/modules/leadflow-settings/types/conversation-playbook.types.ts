import type { LeadFlowJsonObject } from './leadflow-settings.types';

export type ConversationPlaybookCtaStatus =
  | 'pending'
  | 'presented'
  | 'accepted'
  | 'refused';

export type ConversationPlaybookPhase = {
  key: string;
  objective: string;
  entryCriteria: string[];
  essentialFields: string[];
  optionalFields: string[];
  exitCriteria: string[];
  allowedCtas: string[];
  guidance: string[];
};

export type ConversationQualificationFieldRule = {
  key: string;
  source: 'channel' | 'conversation' | 'company_context' | 'backend';
  requiredFor: string[];
  crmTarget?: string;
  valueType: 'string' | 'number' | 'boolean';
  allowedValuesSource?: string;
  overwritePolicy: 'fill_empty' | 'governed_only' | 'human_verified_wins';
};

export type ConversationPlaybook = {
  version: number;
  businessModeKey: string;
  primaryGoal: string;
  successOutcomes: string[];
  phases: ConversationPlaybookPhase[];
  qualificationFields: ConversationQualificationFieldRule[];
  ctaPolicy: {
    allowed: string[];
    minimumContextFields: number;
    requiredContextFields?: string[];
    maxAgentRepliesWithoutCta: number;
    requiresOperationalCapability: Record<string, string>;
  };
  handoffRules: Array<{ key: string; condition: string }>;
  refusalRules: Array<{ key: string; behavior: string }>;
};

export const CONVERSATION_PLAYBOOK_METADATA_KEY = 'conversationPlaybook';

export function readConversationPlaybook(
  metadata: LeadFlowJsonObject | null | undefined,
): ConversationPlaybook | null {
  const value = metadata?.[CONVERSATION_PLAYBOOK_METADATA_KEY];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as unknown as ConversationPlaybook;
  if (
    ![1, 2].includes(candidate.version) ||
    !candidate.businessModeKey ||
    !Array.isArray(candidate.phases) ||
    !Array.isArray(candidate.qualificationFields) ||
    !candidate.ctaPolicy ||
    !Array.isArray(candidate.ctaPolicy.allowed) ||
    (candidate.ctaPolicy.requiredContextFields !== undefined &&
      !Array.isArray(candidate.ctaPolicy.requiredContextFields))
  ) {
    return null;
  }
  return candidate;
}
