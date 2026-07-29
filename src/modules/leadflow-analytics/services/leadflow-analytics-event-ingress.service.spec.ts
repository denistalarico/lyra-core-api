import type { DataSource } from 'typeorm';
import type { LeadFlowEventDeliveryEntity } from '../../leadflow-events/entities';
import { LeadFlowAnalyticsEventIngressService } from './leadflow-analytics-event-ingress.service';

function delivery(
  overrides: Partial<LeadFlowEventDeliveryEntity> = {},
): LeadFlowEventDeliveryEntity {
  return {
    id: 'delivery-1',
    sourceEventId: 'event-1',
    consumerKey: 'leadflow.analytics',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    eventName: 'leadflow.crm.opportunity.created',
    eventVersion: 1,
    aggregateType: 'crm_opportunity',
    aggregateId: '30000000-0000-4000-8000-000000000001',
    payload: {},
    occurredAt: new Date(),
    attempts: 1,
    status: 'processing',
    ...overrides,
  } as LeadFlowEventDeliveryEntity;
}

function build(row = delivery()) {
  const updates: Array<Record<string, unknown>> = [];
  const repository = {
    findOneBy: jest.fn().mockResolvedValue(row),
    update: jest.fn().mockImplementation((_where, patch) => {
      updates.push(patch as Record<string, unknown>);
      return Promise.resolve({ affected: 1 });
    }),
  };
  const dataSource = {
    getRepository: jest.fn().mockReturnValue(repository),
  } as unknown as DataSource;
  const csat = {
    observeInboundDelivery: jest.fn().mockResolvedValue(null),
  };
  return {
    service: new LeadFlowAnalyticsEventIngressService(
      dataSource,
      csat as never,
    ),
    repository,
    updates,
    csat,
  };
}

async function process(
  service: LeadFlowAnalyticsEventIngressService,
): Promise<void> {
  await (
    service as unknown as { processOne(id: string): Promise<void> }
  ).processOne('delivery-1');
}

describe('LeadFlowAnalyticsEventIngressService', () => {
  it('drains an active supported event without projecting data', async () => {
    const { service, updates } = build();

    await process(service);

    expect(updates[0]).toMatchObject({ status: 'delivered' });
    expect(service.snapshot()).toMatchObject({ delivered: 1, skipped: 0 });
  });

  it('skips an event outside the published catalog', async () => {
    const { service, updates, csat } = build(
      delivery({ eventName: 'leadflow.crm.opportunity.unknown' }),
    );

    await process(service);

    expect(updates[0]).toMatchObject({
      status: 'skipped',
      skipReason: 'event_not_catalogued',
    });
    expect(csat.observeInboundDelivery).not.toHaveBeenCalled();
  });

  it('skips a planned contract until its owning phase activates it', async () => {
    const { service, updates } = build(
      delivery({ eventName: 'leadflow.automations.execution.started' }),
    );

    await process(service);

    expect(updates[0]).toMatchObject({
      status: 'skipped',
      skipReason: 'event_contract_not_active',
    });
  });

  it('skips an unsupported event version', async () => {
    const { service, updates } = build(delivery({ eventVersion: 2 }));

    await process(service);

    expect(updates[0]).toMatchObject({
      status: 'skipped',
      skipReason: 'event_version_not_supported',
    });
  });

  it('retries a transient persistence failure and dead-letters at the limit', async () => {
    const row = delivery({ attempts: 8 });
    const { service, repository } = build(row);
    repository.update
      .mockRejectedValueOnce(new Error('db_down'))
      .mockResolvedValueOnce({ affected: 1 });

    await process(service);

    expect(repository.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: row.id }),
      expect.objectContaining({
        status: 'dead_letter',
        lastError: 'db_down',
      }),
    );
  });
});
