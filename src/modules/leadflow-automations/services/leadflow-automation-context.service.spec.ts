import type { LeadFlowEventDeliveryEntity } from '../../leadflow-events/entities/leadflow-event-delivery.entity';
import {
  getRecipeByKey,
  type LeadFlowAutomationRecipeCatalogItem,
} from '../catalog/automation-recipes.catalog';
import { requiredContextSignals } from '../catalog/automation-context-requirements.catalog';
import type { LeadFlowAutomationEntity } from '../entities/leadflow-automation.entity';
import { LeadFlowAutomationDependency } from '../enums/leadflow-automation-dependency.enum';
import {
  LEADFLOW_AUTOMATION_CONTEXT_MAX_EVENT_AGE_MS,
  LeadFlowAutomationContextSignal,
} from '../types/leadflow-automation-context.types';
import { LeadFlowAutomationContextService } from './leadflow-automation-context.service';

const idleLead = getRecipeByKey(
  'followup_idle_lead',
) as LeadFlowAutomationRecipeCatalogItem;

const CONVERSATION_A = '20000000-0000-4000-8000-00000000000a';
const CONVERSATION_B = '20000000-0000-4000-8000-00000000000b';
const OPPORTUNITY_A = '30000000-0000-4000-8000-00000000000a';

function buildAutomation(
  overrides: Partial<LeadFlowAutomationEntity> = {},
): LeadFlowAutomationEntity {
  return {
    id: 'automation-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    recipeKey: idleLead.key,
    businessModeKey: 'agency_services',
    conditionConfig: { ...idleLead.defaultConditionConfig },
    actionConfig: { ...idleLead.defaultActionConfig },
    schedulePolicy: { ...idleLead.defaultSchedulePolicy },
    ...overrides,
  } as LeadFlowAutomationEntity;
}

function buildDelivery(
  overrides: Partial<LeadFlowEventDeliveryEntity> = {},
): LeadFlowEventDeliveryEntity {
  return {
    id: 'delivery-1',
    sourceEventId: 'event-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    eventName: 'leadflow.crm.opportunity.created',
    eventVersion: 1,
    aggregateType: 'crm_opportunity',
    aggregateId: OPPORTUNITY_A,
    payload: {},
    occurredAt: new Date(),
    ...overrides,
  } as LeadFlowEventDeliveryEntity;
}

describe('requiredContextSignals', () => {
  it('asks for nothing when the configuration consults nothing', () => {
    const automation = buildAutomation({
      conditionConfig: {},
      actionConfig: {},
      schedulePolicy: {},
    });

    expect(requiredContextSignals(automation)).toEqual([]);
  });

  it('derives requirements from the configuration, not from the recipe', () => {
    // Two instances of the same recipe legitimately need different context.
    const strict = buildAutomation();
    const relaxed = buildAutomation({
      conditionConfig: { stopIfReplied: true },
      actionConfig: {},
      schedulePolicy: {},
    });

    expect(requiredContextSignals(strict).length).toBeGreaterThan(
      requiredContextSignals(relaxed).length,
    );
    expect(requiredContextSignals(relaxed)).toEqual([
      LeadFlowAutomationContextSignal.LeadReplied,
    ]);
  });

  it('ignores an empty keyword list', () => {
    const automation = buildAutomation({
      conditionConfig: { keywords: [], intents: ['  '] },
      actionConfig: {},
      schedulePolicy: {},
    });

    expect(requiredContextSignals(automation)).toEqual([]);
  });
});

describe('LeadFlowAutomationContextService', () => {
  const service = new LeadFlowAutomationContextService();

  describe('resolveFromEnvelope', () => {
    it('performs no reads', () => {
      const resolution = service.resolveFromEnvelope(
        buildAutomation(),
        buildDelivery(),
      );

      expect(resolution.snapshot.cost.queryCount).toBe(0);
      expect(resolution.snapshot.cost.sources).toEqual([]);
    });

    it('takes the subject from the envelope, never from the payload alone', () => {
      // Scope and subject must not be forgeable through event content.
      const resolution = service.resolveFromEnvelope(
        buildAutomation(),
        buildDelivery({ payload: { opportunityId: 'attacker' } }),
      );

      expect(resolution.snapshot.subjects.crm_opportunity).toBeUndefined();
    });

    it('accepts a linked subject of a different kind from the same event', () => {
      // A CRM event names its own conversation; that reference was written by
      // the same domain in the same transaction, so it costs no extra hop.
      const resolution = service.resolveFromEnvelope(
        buildAutomation(),
        buildDelivery({ payload: { conversationId: CONVERSATION_A } }),
      );

      expect(resolution.snapshot.subjects.inbox_conversation).toBe(
        CONVERSATION_A,
      );
      expect(resolution.snapshot.subjects.crm_opportunity).toBe(OPPORTUNITY_A);
    });

    it('trusts neither reference when two disagree', () => {
      const resolution = service.resolveFromEnvelope(
        buildAutomation(),
        buildDelivery({
          aggregateType: 'inbox_conversation',
          aggregateId: CONVERSATION_A,
          payload: { conversationId: CONVERSATION_B },
        }),
      );

      expect(resolution.snapshot.subjects.inbox_conversation).toBeUndefined();
      expect(
        resolution.gaps[LeadFlowAutomationContextSignal.LeadReplied]?.gap,
      ).toBe('ambiguous_context');
    });

    it('treats the event as evidence for what it reports', () => {
      const resolution = service.resolveFromEnvelope(
        buildAutomation(),
        buildDelivery({
          aggregateType: 'inbox_conversation',
          aggregateId: CONVERSATION_A,
          eventName: 'leadflow.inbox.conversation.message.received',
        }),
      );

      expect(resolution.context.leadReplied).toBe(true);
      expect(
        resolution.snapshot.resolved[
          LeadFlowAutomationContextSignal.LeadReplied
        ]?.origin,
      ).toBe('from_event');
    });

    it('keeps an event-evidenced signal even when the delivery is stale', () => {
      // The event reports something that did happen; delay does not undo it.
      const resolution = service.resolveFromEnvelope(
        buildAutomation(),
        buildDelivery({
          aggregateType: 'inbox_conversation',
          aggregateId: CONVERSATION_A,
          eventName: 'leadflow.inbox.conversation.message.received',
          occurredAt: new Date(
            Date.now() - LEADFLOW_AUTOMATION_CONTEXT_MAX_EVENT_AGE_MS - 1000,
          ),
        }),
      );

      expect(resolution.context.leadReplied).toBe(true);
      expect(
        resolution.gaps[LeadFlowAutomationContextSignal.HandoffActive]?.gap,
      ).toBe('stale_context');
    });

    it('reports a signal with no producing capability as a dependency gap', () => {
      const resolution = service.resolveFromEnvelope(
        buildAutomation({
          conditionConfig: { minScore: 70 },
          actionConfig: {},
          schedulePolicy: {},
        }),
        buildDelivery(),
      );

      expect(
        resolution.gaps[LeadFlowAutomationContextSignal.LeadScore],
      ).toEqual(
        expect.objectContaining({
          gap: 'dependency_unavailable',
          dependency: LeadFlowAutomationDependency.LeadScoreEngine,
        }),
      );
    });

    it('records the age of the event it evaluated', () => {
      const occurredAt = new Date(Date.now() - 60_000);
      const resolution = service.resolveFromEnvelope(
        buildAutomation(),
        buildDelivery({ occurredAt }),
      );

      expect(resolution.snapshot.eventAgeMs).toBeGreaterThanOrEqual(60_000);
    });
  });

  describe('resolveForSimulation', () => {
    it('marks stand-in values as simulated rather than observed', () => {
      const resolution = service.resolveForSimulation(buildAutomation());

      expect(
        resolution.snapshot.resolved[
          LeadFlowAutomationContextSignal.InsideBusinessHours
        ],
      ).toEqual({ origin: 'simulated_default', value: true });
    });

    it('records an operator assertion as such', () => {
      const resolution = service.resolveForSimulation(buildAutomation(), {
        attemptsSoFar: 2,
      });

      expect(
        resolution.snapshot.resolved[
          LeadFlowAutomationContextSignal.AttemptsSoFar
        ],
      ).toEqual({ origin: 'operator', value: 2 });
    });

    it('never stands in for a signal with no canonical source', () => {
      const resolution = service.resolveForSimulation(
        buildAutomation({
          conditionConfig: { minScore: 70 },
          actionConfig: {},
          schedulePolicy: {},
        }),
        { leadScore: 90 },
      );

      expect(resolution.context.leadScore).toBeUndefined();
      expect(
        resolution.gaps[LeadFlowAutomationContextSignal.LeadScore]?.gap,
      ).toBe('dependency_unavailable');
    });

    it('leaves a signal the simulator cannot invent as an explicit gap', () => {
      const resolution = service.resolveForSimulation(
        buildAutomation({
          conditionConfig: { keywords: ['orçamento'] },
          actionConfig: {},
          schedulePolicy: {},
        }),
      );

      expect(
        resolution.gaps[LeadFlowAutomationContextSignal.MatchedKeywords]?.gap,
      ).toBe('missing_context');
    });
  });
});
