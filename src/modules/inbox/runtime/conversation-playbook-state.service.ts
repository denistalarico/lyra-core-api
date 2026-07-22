import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import type { ConversationPlaybook } from '../../leadflow-settings/types/conversation-playbook.types';
import type { AgentDecisionV1 } from './inbox-runtime.contracts';

export const PLAYBOOK_PROGRESS_METADATA_KEY = 'leadflowPlaybookProgress';

export type ConversationPlaybookProgress = {
  schemaVersion: 1;
  businessModeKey: string;
  playbookVersion: number;
  phase: string;
  facts: Record<
    string,
    {
      value: string | number | boolean;
      evidenceRefs: string[];
      confidence: number;
      requiresConfirmation: boolean;
      decisionId: string;
    }
  >;
  collectedEssentialFields: string[];
  missingEssentialFields: string[];
  cta: {
    key: string;
    status: 'pending' | 'presented' | 'accepted' | 'refused';
    evidenceRefs: string[];
  } | null;
  handoffNeeded: boolean;
  conversionKey: string;
  contactId: string | null;
  opportunityId: string | null;
  decisionId: string;
  decisionHash: string;
  updatedAt: string;
};

@Injectable()
export class ConversationPlaybookStateService {
  read(metadata: Record<string, unknown>): ConversationPlaybookProgress | null {
    const value = metadata[PLAYBOOK_PROGRESS_METADATA_KEY];
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return null;
    const progress = value as ConversationPlaybookProgress;
    return progress.schemaVersion === 1 ? progress : null;
  }

  assertDecision(input: {
    previous: ConversationPlaybookProgress | null;
    playbook: ConversationPlaybook;
    decision: AgentDecisionV1;
    priorAgentReplies: number;
  }) {
    const questions = input.decision.reply?.match(/\?/g)?.length ?? 0;
    if (questions > 2) throw new Error('decision_playbook_invalid');
    if (
      input.decision.proposed_phase &&
      !input.playbook.phases.some(
        (phase) => phase.key === input.decision.proposed_phase,
      )
    ) {
      throw new Error('decision_playbook_invalid');
    }
    if (
      input.decision.recommended_cta &&
      !input.playbook.ctaPolicy.allowed.includes(
        input.decision.recommended_cta.key,
      )
    ) {
      throw new Error('decision_playbook_invalid');
    }
    const alreadyAddressed =
      input.previous?.cta && input.previous.cta.status !== 'pending';
    const addressesNow =
      input.decision.recommended_cta &&
      input.decision.recommended_cta.status !== 'pending';
    if (
      input.priorAgentReplies >=
        input.playbook.ctaPolicy.maxAgentRepliesWithoutCta &&
      !alreadyAddressed &&
      !addressesNow
    ) {
      throw new Error('decision_playbook_invalid');
    }
  }

  apply(input: {
    previous: ConversationPlaybookProgress | null;
    playbook: ConversationPlaybook;
    decision: AgentDecisionV1;
    decisionId: string;
    conversionKey: string;
    contactId: string | null;
    opportunityId: string | null;
  }): ConversationPlaybookProgress {
    const phases = input.playbook.phases;
    const previousPhase = phases.find(
      (phase) => phase.key === input.previous?.phase,
    );
    const proposedIndex = phases.findIndex(
      (phase) => phase.key === input.decision.proposed_phase,
    );
    const previousIndex = previousPhase ? phases.indexOf(previousPhase) : 0;
    const phaseIndex =
      proposedIndex >= previousIndex && proposedIndex <= previousIndex + 1
        ? proposedIndex
        : previousIndex;
    const phase = phases[Math.max(0, phaseIndex)] ?? phases[0];
    const allowedFields = new Set(
      input.playbook.qualificationFields.map((rule) => rule.key),
    );
    const facts = { ...(input.previous?.facts ?? {}) };
    for (const fact of input.decision.extracted_facts) {
      if (
        !allowedFields.has(fact.field_key) ||
        fact.value === null ||
        fact.evidence_refs.length === 0 ||
        fact.confidence < 0.65
      ) {
        continue;
      }
      facts[fact.field_key] = {
        value: fact.value,
        evidenceRefs: [...new Set(fact.evidence_refs)],
        confidence: fact.confidence,
        requiresConfirmation: fact.requires_confirmation,
        decisionId: input.decisionId,
      };
    }
    const essentialFields = phase?.essentialFields ?? [];
    const collectedEssentialFields = essentialFields.filter(
      (key) => facts[key] && !facts[key].requiresConfirmation,
    );
    const missingEssentialFields = essentialFields.filter(
      (key) => !collectedEssentialFields.includes(key),
    );
    const proposedCta = input.decision.recommended_cta;
    const cta =
      proposedCta &&
      input.playbook.ctaPolicy.allowed.includes(proposedCta.key) &&
      (phase?.allowedCtas ?? []).includes(proposedCta.key)
        ? {
            key: proposedCta.key,
            status: proposedCta.status,
            evidenceRefs: [...new Set(proposedCta.evidence_refs)],
          }
        : (input.previous?.cta ?? null);
    const decisionHash = createHash('sha256')
      .update(JSON.stringify(input.decision))
      .digest('hex');
    return {
      schemaVersion: 1,
      businessModeKey: input.playbook.businessModeKey,
      playbookVersion: input.playbook.version,
      phase: phase?.key ?? 'understand',
      facts,
      collectedEssentialFields,
      missingEssentialFields,
      cta,
      handoffNeeded: input.decision.handoff,
      conversionKey: input.conversionKey,
      contactId: input.contactId,
      opportunityId: input.opportunityId,
      decisionId: input.decisionId,
      decisionHash,
      updatedAt: new Date().toISOString(),
    };
  }
}
