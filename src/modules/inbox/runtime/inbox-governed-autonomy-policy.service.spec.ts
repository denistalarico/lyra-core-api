import {
  InboxGovernedAutonomyPolicyService,
  InboxGovernedPolicyInput,
} from './inbox-governed-autonomy-policy.service';

describe('InboxGovernedAutonomyPolicyService', () => {
  const service = new InboxGovernedAutonomyPolicyService();
  const base: InboxGovernedPolicyInput = {
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    conversationId: 'conversation-a',
    ownershipVersion: 3,
    currentOwnershipVersion: 3,
    ownershipState: 'ai_active',
    decisionId: 'decision-a',
    decisionSchemaVersion: 1,
    promptVersion: 'prompt-v2',
    modelVersion: 'model-v1',
    actionType: 'reply',
    actionKey: 'reply',
    actionValue: 'Posso ajudar com isso.',
    canonicalRefs: ['context:3', 'message:a'],
    auditRef: 'audit-a',
    pilotMode: true,
    effectEnabled: true,
    recipientAllowed: true,
    channelEligible: true,
    agentPublished: true,
    companyContextPublished: true,
    latestContext: true,
    schemaValid: true,
    idempotencyAvailable: true,
    budgetAvailable: true,
    channelWindowOpen: true,
    factualClaimsSupported: true,
    canonicalTargetResolved: true,
    transitionAllowed: true,
    humanRouteConfigured: true,
    leadEligible: true,
  };

  it('allows a supported reply and emits a stable policy envelope', () => {
    expect(service.evaluate(base)).toMatchObject({
      policyVersion: 'inbox-autonomy-policy-v1',
      outcome: 'allowed',
      reasonCode: 'safe_reply',
      idempotencyKey:
        'decision:decision-a:action:reply:policy:inbox-autonomy-policy-v1',
      application: 'not_started',
    });
  });

  it.each([
    [{ effectEnabled: false }, 'blocked', 'effect_kill_switch'],
    [{ recipientAllowed: false }, 'blocked', 'recipient_not_allowlisted'],
    [{ budgetAvailable: false }, 'blocked', 'circuit_breaker_open'],
    [{ schemaValid: false }, 'invalid', 'decision_schema_invalid'],
    [{ latestContext: false }, 'stale', 'decision_context_stale'],
    [{ currentOwnershipVersion: 4 }, 'stale', 'decision_context_stale'],
    [{ ownershipState: 'human_active' }, 'stale', 'ai_not_owner'],
    [
      { promptInjectionDetected: true },
      'requires_human',
      'prompt_injection_detected',
    ],
    [
      { factualClaimsSupported: false },
      'requires_human',
      'factual_support_missing',
    ],
    [{ channelWindowOpen: false }, 'requires_human', 'channel_window_closed'],
  ])('fails closed for %j', (patch, outcome, reasonCode) => {
    expect(service.evaluate({ ...base, ...patch })).toMatchObject({
      outcome,
      reasonCode,
    });
  });

  it('never authorizes destructive close automatically', () => {
    expect(
      service.evaluate({ ...base, actionType: 'close', actionKey: 'close' }),
    ).toMatchObject({
      outcome: 'requires_human',
      reasonCode: 'destructive_action',
    });
  });

  it('requires canonical CRM targets and an allowed stage transition', () => {
    expect(
      service.evaluate({
        ...base,
        actionType: 'add_tag',
        actionKey: 'tag:test',
        canonicalTargetResolved: false,
      }),
    ).toMatchObject({
      outcome: 'requires_human',
      reasonCode: 'canonical_target_unresolved',
    });
    expect(
      service.evaluate({
        ...base,
        actionType: 'set_stage',
        actionKey: 'stage',
        transitionAllowed: false,
      }),
    ).toMatchObject({
      outcome: 'requires_human',
      reasonCode: 'stage_transition_not_allowed',
    });
  });

  it('blocks a non-lead opportunity and handles duplicate handoff safely', () => {
    expect(
      service.evaluate({
        ...base,
        actionType: 'ensure_opportunity',
        actionKey: 'opportunity',
        leadEligible: false,
      }),
    ).toMatchObject({ outcome: 'blocked', reasonCode: 'lead_not_eligible' });
    expect(
      service.evaluate({
        ...base,
        actionType: 'handoff',
        actionKey: 'handoff',
        idempotencyAvailable: false,
      }),
    ).toMatchObject({
      outcome: 'blocked',
      reasonCode: 'effect_already_applied',
    });
  });

  it('requires a deterministic reason before automatic handoff', () => {
    expect(
      service.evaluate({
        ...base,
        actionType: 'handoff',
        actionKey: 'handoff',
        actionValue: null,
      }),
    ).toMatchObject({
      outcome: 'requires_human',
      reasonCode: 'handoff_reason_missing',
    });
  });

  it('keeps tenant and workspace in the deterministic idempotency scope', () => {
    const result = service.evaluate(base);
    expect(result).toMatchObject({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      conversationId: 'conversation-a',
    });
    expect(service.evaluate({ ...base, workspaceId: '' })).toMatchObject({
      outcome: 'invalid',
      reasonCode: 'canonical_scope_invalid',
    });
  });
});
