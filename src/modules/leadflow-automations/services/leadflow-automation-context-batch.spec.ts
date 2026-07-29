import type { LeadFlowEventDeliveryEntity } from '../../leadflow-events/entities/leadflow-event-delivery.entity';
import {
  getRecipeByKey,
  type LeadFlowAutomationRecipeCatalogItem,
} from '../catalog/automation-recipes.catalog';
import type { LeadFlowAutomationEntity } from '../entities/leadflow-automation.entity';
import { LeadFlowAutomationContextSignal } from '../types/leadflow-automation-context.types';
import { LeadFlowAutomationContextService } from './leadflow-automation-context.service';
import type {
  LeadFlowAutomationContextLoaderService,
  LeadFlowAutomationLoadedContext,
} from './leadflow-automation-context-loader.service';

const idleLead = getRecipeByKey(
  'followup_idle_lead',
) as LeadFlowAutomationRecipeCatalogItem;

const CONVERSATION = '20000000-0000-4000-8000-000000000001';

function automation(
  id: string,
  overrides: Partial<LeadFlowAutomationEntity> = {},
): LeadFlowAutomationEntity {
  return {
    id,
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

function delivery(
  overrides: Partial<LeadFlowEventDeliveryEntity> = {},
): LeadFlowEventDeliveryEntity {
  return {
    id: 'delivery-1',
    sourceEventId: 'event-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    eventName: 'leadflow.inbox.conversation.created',
    eventVersion: 1,
    aggregateType: 'inbox_conversation',
    aggregateId: CONVERSATION,
    payload: {},
    occurredAt: new Date(),
    ...overrides,
  } as LeadFlowEventDeliveryEntity;
}

function loaded(
  overrides: Partial<LeadFlowAutomationLoadedContext> = {},
): LeadFlowAutomationLoadedContext {
  return {
    shared: {},
    perAutomation: new Map(),
    derivedSubjects: {},
    gaps: [],
    cost: { queryCount: 0, durationMs: 0, sources: [] },
    ...overrides,
  };
}

function build(result: LeadFlowAutomationLoadedContext) {
  const load = jest.fn().mockResolvedValue(result);
  const service = new LeadFlowAutomationContextService({
    load,
  } as unknown as LeadFlowAutomationContextLoaderService);
  /** First load request, typed. */
  const requested = (): { signals: Set<LeadFlowAutomationContextSignal> } => {
    const args = load.mock.calls[0] as unknown[];
    return args[0] as { signals: Set<LeadFlowAutomationContextSignal> };
  };
  return { service, load, requested };
}

describe('LeadFlowAutomationContextService.resolveForDelivery', () => {
  it('loads once for every automation matched by the delivery', async () => {
    const { service, load } = build(loaded());

    await service.resolveForDelivery(
      [automation('a-1'), automation('a-2'), automation('a-3')],
      delivery(),
    );

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('requests only the union of the signals the automations consult', async () => {
    const { service, requested } = build(loaded());

    await service.resolveForDelivery(
      [
        automation('a-1', {
          conditionConfig: { stopIfReplied: true },
          actionConfig: {},
          schedulePolicy: {},
        }),
        automation('a-2', {
          conditionConfig: { stopIfHandoff: true },
          actionConfig: {},
          schedulePolicy: {},
        }),
      ],
      delivery(),
    );

    expect(requested().signals).toEqual(
      new Set([
        LeadFlowAutomationContextSignal.LeadReplied,
        LeadFlowAutomationContextSignal.HandoffActive,
      ]),
    );
  });

  it('issues no load work for automations that consult nothing', async () => {
    const { service, requested } = build(loaded());

    await service.resolveForDelivery(
      [
        automation('a-1', {
          conditionConfig: {},
          actionConfig: {},
          schedulePolicy: {},
        }),
      ],
      delivery(),
    );

    expect(requested().signals.size).toBe(0);
  });

  it('requests the score from the canonical query now that the engine exists', async () => {
    const { service, requested } = build(
      loaded({ shared: { [LeadFlowAutomationContextSignal.LeadScore]: 45 } }),
    );

    const resolutions = await service.resolveForDelivery(
      [
        automation('a-1', {
          conditionConfig: { minScore: 30 },
          actionConfig: {},
          schedulePolicy: {},
        }),
      ],
      delivery(),
    );

    expect(
      requested().signals.has(LeadFlowAutomationContextSignal.LeadScore),
    ).toBe(true);
    expect(
      resolutions.get('a-1')?.snapshot.resolved[
        LeadFlowAutomationContextSignal.LeadScore
      ],
    ).toEqual({ origin: 'canonical_read', value: 45 });
  });

  it('marks loaded values as canonical reads', async () => {
    const { service } = build(
      loaded({
        shared: { [LeadFlowAutomationContextSignal.LeadReplied]: true },
      }),
    );

    const resolutions = await service.resolveForDelivery(
      [
        automation('a-1', {
          conditionConfig: { stopIfReplied: true },
          actionConfig: {},
          schedulePolicy: {},
        }),
      ],
      delivery(),
    );

    const resolution = resolutions.get('a-1');
    expect(
      resolution?.snapshot.resolved[
        LeadFlowAutomationContextSignal.LeadReplied
      ],
    ).toEqual({ origin: 'canonical_read', value: true });
    expect(resolution?.context.leadReplied).toBe(true);
  });

  it('prefers event evidence over a canonical read', async () => {
    // The event that says the lead replied is itself the proof; the loader's
    // answer describes now, the event describes what happened.
    const { service, requested } = build(
      loaded({
        shared: { [LeadFlowAutomationContextSignal.LeadReplied]: false },
      }),
    );

    const resolutions = await service.resolveForDelivery(
      [
        automation('a-1', {
          conditionConfig: { stopIfReplied: true },
          actionConfig: {},
          schedulePolicy: {},
        }),
      ],
      delivery({
        eventName: 'leadflow.inbox.conversation.message.received',
      }),
    );

    expect(
      requested().signals.has(LeadFlowAutomationContextSignal.LeadReplied),
    ).toBe(false);
    expect(
      resolutions.get('a-1')?.snapshot.resolved[
        LeadFlowAutomationContextSignal.LeadReplied
      ],
    ).toEqual({ origin: 'from_event', value: true });
  });

  it('gives each automation its own history signals', async () => {
    const { service } = build(
      loaded({
        perAutomation: new Map([
          ['a-1', { [LeadFlowAutomationContextSignal.AttemptsSoFar]: 2 }],
          ['a-2', { [LeadFlowAutomationContextSignal.AttemptsSoFar]: 0 }],
        ]),
      }),
    );

    const resolutions = await service.resolveForDelivery(
      [
        automation('a-1', {
          conditionConfig: {},
          actionConfig: { maxAttempts: 3 },
          schedulePolicy: {},
        }),
        automation('a-2', {
          conditionConfig: {},
          actionConfig: { maxAttempts: 3 },
          schedulePolicy: {},
        }),
      ],
      delivery(),
    );

    expect(resolutions.get('a-1')?.context.attemptsSoFar).toBe(2);
    expect(resolutions.get('a-2')?.context.attemptsSoFar).toBe(0);
  });

  it('propagates loader gaps to the automations that needed the signal', async () => {
    const { service } = build(
      loaded({
        gaps: [
          {
            signal: LeadFlowAutomationContextSignal.InsideBusinessHours,
            gap: 'missing_context',
            detail: 'O horário comercial deste workspace não está configurado.',
            dependency: null,
          },
        ],
      }),
    );

    const resolutions = await service.resolveForDelivery(
      [
        automation('a-1', {
          conditionConfig: { businessHoursOnly: true },
          actionConfig: {},
          schedulePolicy: {},
        }),
      ],
      delivery(),
    );

    expect(
      resolutions.get('a-1')?.gaps[
        LeadFlowAutomationContextSignal.InsideBusinessHours
      ]?.detail,
    ).toContain('não está configurado');
  });

  it('marks canonical reads as stale when the event waited too long', async () => {
    const { service } = build(
      loaded({
        shared: { [LeadFlowAutomationContextSignal.LeadReplied]: false },
      }),
    );

    const resolutions = await service.resolveForDelivery(
      [
        automation('a-1', {
          conditionConfig: { stopIfReplied: true },
          actionConfig: {},
          schedulePolicy: {},
        }),
      ],
      delivery({ occurredAt: new Date(Date.now() - 16 * 60 * 1000) }),
    );

    expect(
      resolutions.get('a-1')?.gaps[LeadFlowAutomationContextSignal.LeadReplied]
        ?.gap,
    ).toBe('stale_context');
  });

  it('records the delivery-level cost on every resolution', async () => {
    const { service } = build(
      loaded({
        shared: { [LeadFlowAutomationContextSignal.LeadReplied]: true },
        cost: {
          queryCount: 3,
          durationMs: 12,
          sources: [
            { source: 'inbox_message_reply', queryCount: 1, durationMs: 4 },
          ],
        },
      }),
    );

    const resolutions = await service.resolveForDelivery(
      [
        automation('a-1', {
          conditionConfig: { stopIfReplied: true },
          actionConfig: {},
          schedulePolicy: {},
        }),
      ],
      delivery(),
    );

    const cost = resolutions.get('a-1')?.snapshot.cost;
    expect(cost?.queryCount).toBe(3);
    expect(cost?.sources).toHaveLength(1);
  });
});
