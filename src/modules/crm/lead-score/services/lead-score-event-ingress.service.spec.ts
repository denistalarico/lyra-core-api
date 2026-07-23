import type { DataSource } from 'typeorm';
import type { LeadFlowEventDeliveryEntity } from '../../../leadflow-events/entities';
import { CrmOpportunityEntity } from '../../entities/crm-opportunity.entity';
import type { LeadScoreEngineService } from './lead-score-engine.service';
import { LeadScoreEventIngressService } from './lead-score-event-ingress.service';

const CONVERSATION = '20000000-0000-4000-8000-000000000001';
const OPPORTUNITY = '30000000-0000-4000-8000-000000000001';

function delivery(
  overrides: Partial<LeadFlowEventDeliveryEntity> = {},
): LeadFlowEventDeliveryEntity {
  return {
    id: 'delivery-1',
    sourceEventId: 'event-1',
    consumerKey: 'leadflow.crm.lead_score',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    eventName: 'leadflow.inbox.conversation.message.received',
    eventVersion: 1,
    aggregateType: 'inbox_conversation',
    aggregateId: CONVERSATION,
    payload: {},
    occurredAt: new Date(),
    attempts: 1,
    status: 'processing',
    ...overrides,
  } as LeadFlowEventDeliveryEntity;
}

/**
 * Wires the ingress to an in-memory delivery row and a stubbed opportunity
 * lookup, so a test can drive `processOne` through its private path by claiming
 * a single id.
 */
function build(options: {
  row?: LeadFlowEventDeliveryEntity;
  opportunity?: { id: string } | null;
  recalculate?: jest.Mock;
}) {
  const row = options.row ?? delivery();
  const recalculate = options.recalculate ?? jest.fn().mockResolvedValue({});
  const updates: Array<Record<string, unknown>> = [];

  const deliveryRepo = {
    findOneBy: jest.fn().mockResolvedValue(row),
    update: jest.fn().mockImplementation((_where, patch) => {
      updates.push(patch as Record<string, unknown>);
      return Promise.resolve({ affected: 1 });
    }),
  };
  const opportunityRepo = {
    findOne: jest
      .fn()
      .mockResolvedValue(
        options.opportunity === undefined
          ? { id: OPPORTUNITY }
          : options.opportunity,
      ),
  };

  const dataSource = {
    getRepository: (entity: unknown) =>
      entity === CrmOpportunityEntity ? opportunityRepo : deliveryRepo,
    transaction: jest.fn(),
  } as unknown as DataSource;

  const service = new LeadScoreEventIngressService(dataSource, {
    recalculate,
  } as unknown as LeadScoreEngineService);

  /** The recalculation input from the nth engine call, typed. */
  const recalcInput = (call = 0): Record<string, unknown> => {
    const args = recalculate.mock.calls[call] as unknown[];
    return args[1] as Record<string, unknown>;
  };

  return { service, recalculate, recalcInput, updates, opportunityRepo };
}

/** Drives a single delivery through the private processing path. */
async function process(service: LeadScoreEventIngressService): Promise<void> {
  await (
    service as unknown as { processOne(id: string): Promise<void> }
  ).processOne('delivery-1');
}

describe('LeadScoreEventIngressService', () => {
  it('recalculates the linked opportunity on an inbound message', async () => {
    const { service, recalculate, recalcInput, updates } = build({});

    await process(service);

    expect(recalculate).toHaveBeenCalledTimes(1);
    expect(recalcInput()).toMatchObject({
      opportunityId: OPPORTUNITY,
      reason: 'inbound_message',
      sourceEventId: 'event-1',
    });
    expect(updates[0].status).toBe('delivered');
  });

  it('carries the source event id so a redelivery is idempotent at the engine', async () => {
    // The consumer does not dedupe itself; it hands the engine the event id and
    // relies on the engine's key. This asserts the id actually flows through.
    const { service, recalcInput } = build({});

    await process(service);

    expect(recalcInput().sourceEventId).toBe('event-1');
  });

  it('skips an inbox event that changes no scoring feature', async () => {
    const { service, recalculate, updates } = build({
      row: delivery({ eventName: 'leadflow.inbox.conversation.closed' }),
    });

    await process(service);

    expect(recalculate).not.toHaveBeenCalled();
    expect(updates[0]).toMatchObject({
      status: 'skipped',
      skipReason: 'event_not_scored',
    });
  });

  it('never recalculates on the score events it would itself emit', async () => {
    // The trigger already excludes these, but a defence in depth: a score event
    // reaching this consumer must not start a recalculation loop.
    const { service, recalculate, updates } = build({
      row: delivery({
        eventName: 'leadflow.crm.opportunity.score.changed',
        aggregateType: 'crm_opportunity',
        aggregateId: OPPORTUNITY,
      }),
    });

    await process(service);

    expect(recalculate).not.toHaveBeenCalled();
    expect(updates[0].skipReason).toBe('event_not_scored');
  });

  it('skips a conversation with no opportunity', async () => {
    const { service, recalculate, updates } = build({ opportunity: null });

    await process(service);

    expect(recalculate).not.toHaveBeenCalled();
    expect(updates[0]).toMatchObject({
      status: 'skipped',
      skipReason: 'no_linked_opportunity',
    });
  });

  it('scopes the opportunity lookup to the delivery tenant and workspace', async () => {
    const { service, opportunityRepo } = build({});

    await process(service);

    const call = opportunityRepo.findOne.mock.calls[0] as unknown[];
    const where = (call[0] as { where: Record<string, unknown> }).where;
    expect(where).toMatchObject({
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      inboxConversationId: CONVERSATION,
    });
  });

  it('returns a delivery to pending when the engine fails, until it dead-letters', async () => {
    const failing = jest.fn().mockRejectedValue(new Error('db_down'));
    const { service, updates } = build({ recalculate: failing });

    await process(service);

    expect(updates[0]).toMatchObject({
      status: 'pending',
      lastError: 'db_down',
    });
  });

  it('dead-letters after too many attempts', async () => {
    const failing = jest.fn().mockRejectedValue(new Error('db_down'));
    const { service, updates } = build({
      recalculate: failing,
      row: delivery({ attempts: 8 }),
    });

    await process(service);

    expect(updates[0].status).toBe('dead_letter');
  });
});
