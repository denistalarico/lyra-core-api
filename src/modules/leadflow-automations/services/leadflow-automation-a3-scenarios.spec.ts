import type { LeadFlowEventDeliveryEntity } from '../../leadflow-events/entities/leadflow-event-delivery.entity';
import {
  getRecipeByKey,
  type LeadFlowAutomationRecipeCatalogItem,
} from '../catalog/automation-recipes.catalog';
import type { LeadFlowAutomationEntity } from '../entities/leadflow-automation.entity';
import type { LeadFlowAutomationVersionEntity } from '../entities/leadflow-automation-version.entity';
import { LeadFlowAutomationStatus } from '../enums/leadflow-automation-status.enum';
import { LeadFlowAutomationContextService } from './leadflow-automation-context.service';
import { LeadFlowAutomationContextLoaderService } from './leadflow-automation-context-loader.service';
import { LeadFlowAutomationEvaluationService } from './leadflow-automation-evaluation.service';
import type { LeadFlowAutomationExecutionService } from './leadflow-automation-execution.service';
import type { LeadFlowAutomationRunService } from './leadflow-automation-run.service';
import { LeadFlowAutomationShadowEvaluatorService } from './leadflow-automation-shadow-evaluator.service';
import type {
  LeadFlowAutomationTriggerMatch,
  LeadFlowAutomationTriggerMatcherService,
} from './leadflow-automation-trigger-matcher.service';

/**
 * A3 — representative scenarios with measured cost.
 *
 * These exercise the whole enrichment path (matcher → batched loader → evaluator
 * → run), with the canonical repositories mocked to return realistic shapes.
 * The point is twofold: that verdicts over the real triggers are explainable —
 * every signal is either observed or an explicit gap — and that the cost of
 * assembling the context is actually measured and recorded on the run.
 */

const idleLead = getRecipeByKey(
  'followup_idle_lead',
) as LeadFlowAutomationRecipeCatalogItem;

const CONVERSATION = '20000000-0000-4000-8000-000000000001';
const OPPORTUNITY = '30000000-0000-4000-8000-000000000001';
const VERSION = '10000000-0000-4000-8000-000000000001';

interface CanonicalState {
  inboundCount?: number;
  ownershipState?: string;
  businessHours?: Record<string, unknown> | null;
  leadScore?: number | null;
}

/** Builds the loader over repositories stubbed from a canonical-state fixture. */
function buildLoader(state: CanonicalState) {
  const queries: string[] = [];
  const conversations = {
    findOne: jest.fn().mockImplementation(() => {
      queries.push('conversation');
      return Promise.resolve(
        state.ownershipState
          ? { id: CONVERSATION, ownershipState: state.ownershipState }
          : null,
      );
    }),
  };
  const messages = {
    findOne: jest.fn().mockImplementation(() => {
      queries.push('message');
      return Promise.resolve(
        (state.inboundCount ?? 0) > 0 ? { id: 'message-1' } : null,
      );
    }),
  };
  const inboxSettings = {
    findOne: jest.fn().mockImplementation(() => {
      queries.push('settings');
      return Promise.resolve(
        state.businessHours === undefined
          ? { businessHours: { enabled: false } }
          : { businessHours: state.businessHours },
      );
    }),
  };
  const opportunities = { findOne: jest.fn() };
  const runs = {
    createQueryBuilder: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockImplementation(() => {
        queries.push('runs');
        return Promise.resolve([]);
      }),
    }),
  };
  const leadScore = {
    getForOpportunity: jest.fn().mockImplementation(() => {
      queries.push('lead_score');
      return Promise.resolve(
        state.leadScore === undefined || state.leadScore === null
          ? { availability: 'not_calculated', score: null }
          : { availability: 'available', score: state.leadScore },
      );
    }),
  };
  const fieldCatalog = { listFields: jest.fn(), essentialFields: jest.fn() };

  const loader = new LeadFlowAutomationContextLoaderService(
    conversations as never,
    messages as never,
    inboxSettings as never,
    opportunities as never,
    runs as never,
    leadScore as never,
    fieldCatalog as never,
  );
  return { loader, queries };
}

function automation(
  overrides: Partial<LeadFlowAutomationEntity> = {},
): LeadFlowAutomationEntity {
  return {
    id: 'automation-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    recipeKey: idleLead.key,
    businessModeKey: 'agency_services',
    templateVersion: 1,
    publishedVersionId: VERSION,
    status: LeadFlowAutomationStatus.Active,
    triggerConfig: { ...idleLead.defaultTriggerConfig },
    conditionConfig: { ...idleLead.defaultConditionConfig },
    actionConfig: { ...idleLead.defaultActionConfig },
    messageConfig: { ...idleLead.defaultMessageConfig },
    crmPolicy: { ...idleLead.defaultCrmPolicy },
    schedulePolicy: { ...idleLead.defaultSchedulePolicy },
    ...overrides,
  } as LeadFlowAutomationEntity;
}

function match(
  overrides: Partial<LeadFlowAutomationEntity> = {},
): LeadFlowAutomationTriggerMatch {
  const entity = automation(overrides);
  return {
    source: entity,
    automation: entity,
    version: {
      id: VERSION,
      automationId: entity.id,
      tenantId: entity.tenantId,
      version: 1,
    } as LeadFlowAutomationVersionEntity,
  };
}

function delivery(
  overrides: Partial<LeadFlowEventDeliveryEntity> = {},
): LeadFlowEventDeliveryEntity {
  return {
    id: 'delivery-1',
    sourceEventId: 'event-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    eventName: 'leadflow.inbox.conversation.message.received',
    eventVersion: 1,
    aggregateType: 'inbox_conversation',
    aggregateId: CONVERSATION,
    payload: {},
    occurredAt: new Date(),
    ...overrides,
  } as LeadFlowEventDeliveryEntity;
}

/** Wires the whole path and captures what recordShadowRun was given. */
function build(
  state: CanonicalState,
  matches: LeadFlowAutomationTriggerMatch[],
) {
  const { loader, queries } = buildLoader(state);
  const recordShadowRun = jest
    .fn()
    .mockResolvedValue({ run: { id: 'run-1' }, attempts: [] });
  const matcher = {
    findMatching: jest.fn().mockResolvedValue(matches),
  } as unknown as LeadFlowAutomationTriggerMatcherService;

  const service = new LeadFlowAutomationShadowEvaluatorService(
    matcher,
    new LeadFlowAutomationContextService(loader),
    new LeadFlowAutomationEvaluationService(),
    { recordShadowRun } as unknown as LeadFlowAutomationRunService,
    // Gate closed: A3 measures the shadow enrichment path, not execution.
    {
      execute: jest
        .fn()
        .mockResolvedValue({ executed: false, reason: 'execution_disabled' }),
    } as unknown as LeadFlowAutomationExecutionService,
  );

  const snapshotOf = () => {
    const args = recordShadowRun.mock.calls[0] as unknown[];
    return (
      args[4] as {
        contextSnapshot: {
          cost: { queryCount: number; durationMs: number };
          gaps: unknown[];
        };
      }
    ).contextSnapshot;
  };

  return { service, recordShadowRun, queries, snapshotOf };
}

describe('A3 representative scenarios', () => {
  it('an engaged inbound message produces an observed verdict', async () => {
    // The lead has replied several times and it is inside business hours; every
    // signal the recipe consults is observed.
    const { service, recordShadowRun, snapshotOf } = build(
      { inboundCount: 3, ownershipState: 'ai_active' },
      [match()],
    );

    const summaries = await service.evaluateDelivery(delivery());

    expect(summaries[0].contextGapCount).toBe(0);
    const snapshot = snapshotOf();
    expect(snapshot.gaps).toHaveLength(0);
    // leadReplied came from the event itself; the rest from canonical reads.
    expect(recordShadowRun).toHaveBeenCalledTimes(1);
  });

  it('measures the cost of the reads it performed', async () => {
    const { service, snapshotOf } = build(
      { inboundCount: 1, ownershipState: 'ai_active' },
      [match()],
    );

    await service.evaluateDelivery(delivery());

    const cost = snapshotOf().cost;
    expect(cost.queryCount).toBeGreaterThan(0);
    expect(typeof cost.durationMs).toBe('number');
  });

  it('shares the reads across automations reacting to the same event', async () => {
    // Three follow-up automations on one conversation must not triple the cost.
    const { service, queries } = build(
      { inboundCount: 2, ownershipState: 'ai_active' },
      [match({ id: 'a-1' }), match({ id: 'a-2' }), match({ id: 'a-3' })],
    );

    await service.evaluateDelivery(delivery());

    // The conversation, message and settings were each read at most once for
    // the whole delivery, not once per automation.
    expect(
      queries.filter((q) => q === 'conversation').length,
    ).toBeLessThanOrEqual(1);
    expect(queries.filter((q) => q === 'settings').length).toBeLessThanOrEqual(
      1,
    );
  });

  it('records a gap, not a guess, when business hours are unconfigured', async () => {
    const { service, snapshotOf } = build(
      { inboundCount: 1, ownershipState: 'ai_active', businessHours: null },
      [match()],
    );

    await service.evaluateDelivery(delivery());

    const gaps = snapshotOf().gaps as Array<{ signal: string; gap: string }>;
    expect(gaps.find((g) => g.signal === 'inside_business_hours')?.gap).toBe(
      'missing_context',
    );
  });

  /**
   * A CRM event names the opportunity in its envelope; a conversation event
   * does not. The score lives on the opportunity, so only an
   * opportunity-scoped delivery can read it — for a bare conversation event it
   * is correctly a gap.
   */
  const opportunityDelivery = () =>
    delivery({
      eventName: 'leadflow.crm.opportunity.score.changed',
      aggregateType: 'crm_opportunity',
      aggregateId: OPPORTUNITY,
    });

  it('reads the canonical lead score when a recipe requires it', async () => {
    const { service, queries, snapshotOf } = build(
      {
        inboundCount: 1,
        ownershipState: 'ai_active',
        leadScore: 40,
      },
      [
        match({
          conditionConfig: {
            ...idleLead.defaultConditionConfig,
            minScore: 30,
          },
        }),
      ],
    );

    await service.evaluateDelivery(opportunityDelivery());

    expect(queries).toContain('lead_score');
    const snapshot = snapshotOf() as unknown as {
      resolved: Record<string, { origin: string; value: unknown }>;
    };
    expect(snapshot.resolved.lead_score).toEqual({
      origin: 'canonical_read',
      value: 40,
    });
  });

  it('reports an unscored opportunity as missing context, not a low score', async () => {
    const { service, snapshotOf } = build(
      {
        inboundCount: 1,
        ownershipState: 'ai_active',
        leadScore: null,
      },
      [
        match({
          conditionConfig: {
            ...idleLead.defaultConditionConfig,
            minScore: 30,
          },
        }),
      ],
    );

    await service.evaluateDelivery(opportunityDelivery());

    const gaps = snapshotOf().gaps as Array<{ signal: string; gap: string }>;
    expect(gaps.find((g) => g.signal === 'lead_score')?.gap).toBe(
      'missing_context',
    );
  });
});
