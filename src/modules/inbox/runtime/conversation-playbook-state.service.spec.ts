import { LEADFLOW_BUSINESS_MODE_TEMPLATES } from '../../leadflow-settings/catalog/business-mode-templates.catalog';
import { LeadFlowBusinessMode } from '../../leadflow-settings/enums/leadflow-business-mode.enum';
import { readConversationPlaybook } from '../../leadflow-settings/types/conversation-playbook.types';
import type { AgentDecisionV1 } from './inbox-runtime.contracts';
import { ConversationPlaybookStateService } from './conversation-playbook-state.service';

function decision(overrides: Partial<AgentDecisionV1> = {}): AgentDecisionV1 {
  return {
    schema_version: 1,
    reply: 'Entendi. Podemos avançar para um diagnóstico?',
    follow_text: null,
    stage_key: null,
    stage_name: null,
    tags: [],
    handoff: false,
    handoff_reason: null,
    agent_summary: 'Lead busca apoio comercial.',
    service: null,
    urgency: 'normal',
    close_reason: null,
    confidence: 0.9,
    evidence_refs: ['message:1'],
    extracted_facts: [
      {
        field_key: 'niche',
        proposed_target: 'ignored.by.backend',
        value: 'varejo local',
        evidence_refs: ['message:1'],
        confidence: 0.9,
        requires_confirmation: false,
        update_intent: 'enrich',
      },
      {
        field_key: 'paid_ads_experience',
        proposed_target: 'ignored.by.backend',
        value: false,
        evidence_refs: ['message:1'],
        confidence: 0.95,
        requires_confirmation: false,
        update_intent: 'enrich',
      },
    ],
    recommended_cta: {
      key: 'schedule_diagnostic',
      status: 'presented',
      evidence_refs: ['message:1'],
    },
    proposed_phase: 'qualify',
    proposed_actions: [],
    ...overrides,
  };
}

describe('ConversationPlaybookStateService', () => {
  const template = LEADFLOW_BUSINESS_MODE_TEMPLATES.find(
    (item) => item.key === LeadFlowBusinessMode.AgencyServices,
  )!;
  const playbook = readConversationPlaybook(template.metadata)!;

  it('persists evidenced facts, phase and allowed CTA without trusting the proposed target', () => {
    const state = new ConversationPlaybookStateService().apply({
      previous: null,
      playbook,
      decision: decision(),
      decisionId: 'decision-1',
      conversionKey: 'conversion-1',
      contactId: 'contact-1',
      opportunityId: null,
      canonicalFacts: {
        lead_name: {
          value: 'Lead Sintético',
          evidenceRefs: ['channel:profile_name'],
          confidence: 1,
        },
      },
    });

    expect(state.phase).toBe('qualify');
    expect(state.facts.niche).toMatchObject({
      value: 'varejo local',
      evidenceRefs: ['message:1'],
    });
    expect(state.cta).toMatchObject({
      key: 'schedule_diagnostic',
      status: 'presented',
    });
    expect(state.decisionHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('does not skip phases or accept a CTA outside the published playbook', () => {
    const state = new ConversationPlaybookStateService().apply({
      previous: null,
      playbook,
      decision: decision({
        proposed_phase: 'convert',
        recommended_cta: {
          key: 'confirm_order_without_backend',
          status: 'accepted',
          evidence_refs: ['message:1'],
        },
      }),
      decisionId: 'decision-2',
      conversionKey: 'conversion-2',
      contactId: null,
      opportunityId: null,
    });

    expect(state.phase).toBe('understand');
    expect(state.cta).toBeNull();
  });

  it('requires a valid CTA after the configured conversational limit and rejects interrogations', () => {
    const service = new ConversationPlaybookStateService();
    expect(() =>
      service.assertDecision({
        previous: null,
        playbook,
        decision: decision({ recommended_cta: null }),
        priorAgentReplies: 3,
        canonicalFacts: {
          lead_name: {
            value: 'Lead Sintético',
            evidenceRefs: ['channel:profile_name'],
            confidence: 1,
          },
        },
      }),
    ).toThrow('decision_playbook_invalid');
    expect(() =>
      service.assertDecision({
        previous: null,
        playbook,
        decision: decision({
          reply: 'Qual nicho? Qual prazo? Qual orçamento?',
        }),
        priorAgentReplies: 0,
        canonicalFacts: {
          lead_name: {
            value: 'Lead Sintético',
            evidenceRefs: ['channel:profile_name'],
            confidence: 1,
          },
        },
      }),
    ).toThrow('decision_playbook_invalid');
  });

  it('rejects an agency CTA until name, niche and paid ads history are known', () => {
    const service = new ConversationPlaybookStateService();

    expect(() =>
      service.assertDecision({
        previous: null,
        playbook,
        decision: decision({ extracted_facts: [] }),
        priorAgentReplies: 0,
        canonicalFacts: {
          lead_name: {
            value: 'Lead Sintético',
            evidenceRefs: ['channel:profile_name'],
            confidence: 1,
          },
        },
      }),
    ).toThrow('decision_playbook_invalid');

    expect(() =>
      service.assertDecision({
        previous: null,
        playbook,
        decision: decision({ recommended_cta: null, extracted_facts: [] }),
        priorAgentReplies: 4,
        canonicalFacts: {},
      }),
    ).not.toThrow();
  });
});
