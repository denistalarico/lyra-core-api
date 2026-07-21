import { Injectable } from '@nestjs/common';

export const INBOX_AUTONOMY_POLICY_VERSION = 'inbox-autonomy-policy-v1';

export type InboxGovernedActionType =
  | 'reply'
  | 'ensure_contact'
  | 'ensure_opportunity'
  | 'set_stage'
  | 'add_tag'
  | 'set_summary'
  | 'set_service'
  | 'set_urgency'
  | 'close'
  | 'handoff';

export type InboxGovernedPolicyOutcome =
  | 'allowed'
  | 'blocked'
  | 'requires_human'
  | 'stale'
  | 'invalid';

export type InboxGovernedPolicyResult = {
  policyVersion: typeof INBOX_AUTONOMY_POLICY_VERSION;
  tenantId: string;
  workspaceId: string;
  conversationId: string;
  ownershipVersion: number;
  decisionId: string;
  decisionSchemaVersion: number;
  promptVersion: string | null;
  modelVersion: string | null;
  actionType: InboxGovernedActionType;
  actionKey: string;
  outcome: InboxGovernedPolicyOutcome;
  reasonCode: string;
  canonicalRefs: string[];
  idempotencyKey: string;
  application: 'not_started';
  auditRef: string;
};

export type InboxGovernedPolicyInput = {
  tenantId: string;
  workspaceId: string;
  conversationId: string;
  ownershipVersion: number;
  currentOwnershipVersion: number;
  ownershipState: string;
  decisionId: string;
  decisionSchemaVersion: number;
  promptVersion: string | null;
  modelVersion: string | null;
  actionType: InboxGovernedActionType;
  actionKey: string;
  actionValue?: string | null;
  canonicalRefs: string[];
  auditRef: string;
  pilotMode: boolean;
  effectEnabled: boolean;
  recipientAllowed: boolean;
  channelEligible: boolean;
  agentPublished: boolean;
  companyContextPublished: boolean;
  latestContext: boolean;
  schemaValid: boolean;
  idempotencyAvailable: boolean;
  budgetAvailable: boolean;
  channelWindowOpen: boolean;
  promptInjectionDetected?: boolean;
  sensitiveTopicDetected?: boolean;
  factualClaimsSupported?: boolean;
  canonicalTargetResolved?: boolean;
  transitionAllowed?: boolean;
  humanRouteConfigured?: boolean;
  leadEligible?: boolean;
};

@Injectable()
export class InboxGovernedAutonomyPolicyService {
  evaluate(input: InboxGovernedPolicyInput): InboxGovernedPolicyResult {
    const idempotencyKey = `decision:${input.decisionId}:action:${input.actionKey}:policy:${INBOX_AUTONOMY_POLICY_VERSION}`;
    const result = (
      outcome: InboxGovernedPolicyOutcome,
      reasonCode: string,
    ): InboxGovernedPolicyResult => ({
      policyVersion: INBOX_AUTONOMY_POLICY_VERSION,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      ownershipVersion: input.ownershipVersion,
      decisionId: input.decisionId,
      decisionSchemaVersion: input.decisionSchemaVersion,
      promptVersion: input.promptVersion,
      modelVersion: input.modelVersion,
      actionType: input.actionType,
      actionKey: input.actionKey,
      outcome,
      reasonCode,
      canonicalRefs: [...new Set(input.canonicalRefs)].sort(),
      idempotencyKey,
      application: 'not_started',
      auditRef: input.auditRef,
    });

    if (!this.hasCanonicalScope(input))
      return result('invalid', 'canonical_scope_invalid');
    if (input.decisionSchemaVersion !== 1 || !input.schemaValid)
      return result('invalid', 'decision_schema_invalid');
    if (!input.actionKey.trim()) return result('invalid', 'action_key_missing');
    if (
      input.currentOwnershipVersion !== input.ownershipVersion ||
      !input.latestContext
    )
      return result('stale', 'decision_context_stale');
    if (input.ownershipState !== 'ai_active')
      return result('stale', 'ai_not_owner');
    if (!input.pilotMode) return result('blocked', 'pilot_mode_disabled');
    if (!input.effectEnabled) return result('blocked', 'effect_kill_switch');
    if (!input.recipientAllowed)
      return result('blocked', 'recipient_not_allowlisted');
    if (!input.channelEligible)
      return result('blocked', 'channel_not_eligible');
    if (!input.agentPublished)
      return result('blocked', 'published_agent_unavailable');
    if (!input.companyContextPublished)
      return result('blocked', 'published_context_unavailable');
    if (!input.idempotencyAvailable)
      return result('blocked', 'effect_already_applied');
    if (!input.budgetAvailable)
      return result('blocked', 'circuit_breaker_open');
    if (input.promptInjectionDetected)
      return result('requires_human', 'prompt_injection_detected');

    if (input.actionType === 'reply') {
      if (!input.actionValue?.trim()) return result('invalid', 'reply_empty');
      if (!input.channelWindowOpen)
        return result('requires_human', 'channel_window_closed');
      if (input.sensitiveTopicDetected)
        return result('requires_human', 'sensitive_topic');
      if (input.factualClaimsSupported !== true)
        return result('requires_human', 'factual_support_missing');
      return result('allowed', 'safe_reply');
    }

    if (input.actionType === 'close')
      return result('requires_human', 'destructive_action');

    if (input.actionType === 'handoff') {
      if (!input.actionValue?.trim())
        return result('requires_human', 'handoff_reason_missing');
      if (!input.humanRouteConfigured)
        return result('requires_human', 'human_route_unavailable');
      return result('allowed', 'handoff_trigger_valid');
    }

    if (input.actionType === 'ensure_contact')
      return input.canonicalTargetResolved
        ? result('allowed', 'canonical_identity_resolved')
        : result('requires_human', 'canonical_identity_ambiguous');

    if (input.actionType === 'ensure_opportunity') {
      if (!input.leadEligible) return result('blocked', 'lead_not_eligible');
      return input.canonicalTargetResolved
        ? result('allowed', 'opportunity_defaults_resolved')
        : result('requires_human', 'opportunity_defaults_ambiguous');
    }

    if (!input.canonicalTargetResolved)
      return result('requires_human', 'canonical_target_unresolved');
    if (input.actionType === 'set_stage' && !input.transitionAllowed)
      return result('requires_human', 'stage_transition_not_allowed');
    return result('allowed', 'low_risk_crm_action');
  }

  private hasCanonicalScope(input: InboxGovernedPolicyInput): boolean {
    return Boolean(
      input.tenantId &&
      input.workspaceId &&
      input.conversationId &&
      input.decisionId &&
      input.auditRef,
    );
  }
}
