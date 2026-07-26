import type { Repository } from 'typeorm';
import type { LeadFlowEventDeliveryEntity } from '../../leadflow-events/entities';
import type { InboxDomainOutboxEntity } from '../../inbox/entities/inbox-domain-outbox.entity';
import type { InboxSettingsEntity } from '../../inbox/entities/inbox-settings.entity';
import { LeadFlowBusinessHoursClosedDetectorService } from './leadflow-business-hours-closed-detector.service';

function build(businessHours: Record<string, unknown> | null) {
  const execute = jest.fn().mockResolvedValue({});
  const values = jest.fn().mockReturnThis();
  const orIgnore = jest.fn().mockReturnThis();
  const insert = jest.fn().mockReturnThis();
  const createQueryBuilder = jest.fn(() => ({
    insert,
    values,
    orIgnore,
    execute,
  }));
  const settings = {
    findOne: jest
      .fn()
      .mockResolvedValue(
        businessHours === null ? null : { id: 'settings-1', businessHours },
      ),
  } as unknown as Repository<InboxSettingsEntity>;
  const outbox = {
    createQueryBuilder,
  } as unknown as Repository<InboxDomainOutboxEntity>;
  return {
    detector: new LeadFlowBusinessHoursClosedDetectorService(settings, outbox),
    values,
    execute,
  };
}

function handoff(): LeadFlowEventDeliveryEntity {
  return {
    sourceEventId: '10000000-0000-4000-8000-000000000001',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    aggregateType: 'inbox_conversation',
    aggregateId: 'conversation-1',
    eventName: 'leadflow.inbox.conversation.handoff.requested',
    payload: { ownershipVersion: 4 },
  } as unknown as LeadFlowEventDeliveryEntity;
}

describe('LeadFlowBusinessHoursClosedDetectorService', () => {
  it('emits a derived canonical event only when a handoff is outside hours', async () => {
    const { detector, values, execute } = build({
      enabled: true,
      timezone: 'UTC',
      days: [
        {
          day: new Intl.DateTimeFormat('en-US', {
            timeZone: 'UTC',
            weekday: 'long',
          })
            .format(new Date())
            .toLowerCase(),
          enabled: false,
          start: '08:00',
          end: '18:00',
        },
      ],
    });

    await detector.observeDelivery(handoff());

    expect(execute).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'leadflow.inbox.business_hours.closed',
        aggregateId: 'conversation-1',
        idempotencyKey:
          'business-hours-closed:10000000-0000-4000-8000-000000000001',
      }),
    );
  });

  it('does not derive from ordinary messages or missing official settings', async () => {
    const { detector, execute } = build(null);

    await detector.observeDelivery({
      ...handoff(),
      eventName: 'leadflow.inbox.conversation.message.received',
    });
    await detector.observeDelivery(handoff());

    expect(execute).not.toHaveBeenCalled();
  });
});
