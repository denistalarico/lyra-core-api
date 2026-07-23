import type { DataSource } from 'typeorm';
import { LeadFlowEventDeliveryEntity } from '../../leadflow-events/entities';
import { LeadFlowAutomationEventIngressService } from './leadflow-automation-event-ingress.service';
import type { LeadFlowAutomationShadowEvaluatorService } from './leadflow-automation-shadow-evaluator.service';

type Decision = { status: 'delivered' } | { status: 'skipped'; reason: string };

describe('LeadFlowAutomationEventIngressService contract acceptance', () => {
  // `accept` is pure contract acceptance and touches neither collaborator.
  const service = new LeadFlowAutomationEventIngressService(
    {} as DataSource,
    {} as LeadFlowAutomationShadowEvaluatorService,
  );
  const accept = (
    service as unknown as {
      accept(delivery: LeadFlowEventDeliveryEntity): Decision;
    }
  ).accept.bind(service);

  const delivery = (
    eventName: string,
    eventVersion = 1,
  ): LeadFlowEventDeliveryEntity =>
    Object.assign(new LeadFlowEventDeliveryEntity(), {
      eventName,
      eventVersion,
    });

  it('acknowledges an active catalog event mapped to an event trigger', () => {
    expect(
      accept(delivery('leadflow.inbox.conversation.message.received')),
    ).toEqual({ status: 'delivered' });
  });

  it('skips a catalog event that no automation trigger consumes', () => {
    expect(accept(delivery('leadflow.crm.opportunity.copied'))).toEqual({
      status: 'skipped',
      reason: 'event_not_mapped_to_automation',
    });
  });

  it('skips unknown and unsupported-version events without retrying', () => {
    expect(accept(delivery('leadflow.unknown.fact.created'))).toEqual({
      status: 'skipped',
      reason: 'event_not_catalogued',
    });
    expect(
      accept(delivery('leadflow.crm.opportunity.stage.changed', 99)),
    ).toEqual({
      status: 'skipped',
      reason: 'event_version_not_supported',
    });
  });
});

describe('LeadFlowAutomationEventIngressService shadow acknowledgement', () => {
  function build(evaluateDelivery: jest.Mock) {
    const delivery = Object.assign(new LeadFlowEventDeliveryEntity(), {
      id: '10000000-0000-4000-8000-000000000001',
      sourceEventId: '20000000-0000-4000-8000-000000000002',
      tenantId: '30000000-0000-4000-8000-000000000003',
      workspaceId: '40000000-0000-4000-8000-000000000004',
      consumerKey: 'leadflow.automations',
      status: 'processing',
      lockedBy: expect.any(String),
      attempts: 1,
      eventName: 'leadflow.crm.opportunity.created',
      eventVersion: 1,
      payload: {},
      occurredAt: new Date('2026-07-22T12:00:00Z'),
    });
    const update = jest.fn().mockResolvedValue({ affected: 1 });
    const repository = {
      findOneBy: jest.fn().mockImplementation((where: { lockedBy: string }) => {
        delivery.lockedBy = where.lockedBy;
        return Promise.resolve(delivery);
      }),
      update,
    };
    const dataSource = {
      getRepository: jest.fn().mockReturnValue(repository),
    } as unknown as DataSource;
    const service = new LeadFlowAutomationEventIngressService(dataSource, {
      evaluateDelivery,
    } as unknown as LeadFlowAutomationShadowEvaluatorService);

    return {
      delivery,
      update,
      processOne: (
        service as unknown as { processOne(id: string): Promise<void> }
      ).processOne.bind(service),
      snapshot: () => service.snapshot(),
    };
  }

  it('acknowledges only after all shadow runs have been persisted', async () => {
    const order: string[] = [];
    const evaluateDelivery = jest.fn().mockImplementation(async () => {
      order.push('evaluated');
      return [{ runId: 'run-1' }];
    });
    const harness = build(evaluateDelivery);
    harness.update.mockImplementation(async () => {
      order.push('acknowledged');
      return { affected: 1 };
    });

    await harness.processOne(harness.delivery.id);

    expect(order).toEqual(['evaluated', 'acknowledged']);
    expect(harness.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: harness.delivery.id }),
      expect.objectContaining({ status: 'delivered' }),
    );
    expect(harness.snapshot()).toMatchObject({
      delivered: 1,
      shadowEvaluated: 1,
      failed: 0,
    });
  });

  it('returns the delivery to pending when shadow persistence fails', async () => {
    const harness = build(
      jest.fn().mockRejectedValue(new Error('shadow_persistence_failed')),
    );

    await harness.processOne(harness.delivery.id);

    expect(harness.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: harness.delivery.id }),
      expect.objectContaining({
        status: 'pending',
        lastError: 'shadow_persistence_failed',
      }),
    );
    expect(harness.snapshot()).toMatchObject({
      delivered: 0,
      failed: 1,
      shadowEvaluated: 0,
    });
  });
});
