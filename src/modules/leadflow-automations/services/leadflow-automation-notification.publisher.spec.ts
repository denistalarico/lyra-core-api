import type { Repository } from 'typeorm';
import type { CrmOpportunityEntity } from '../../crm/entities/crm-opportunity.entity';
import type { NotificationEventProcessorService } from '../../notifications/services';
import {
  LeadFlowAutomationNotificationPublisher,
  type AutomationNotificationInput,
} from './leadflow-automation-notification.publisher';

function input(
  overrides: Partial<AutomationNotificationInput> = {},
): AutomationNotificationInput {
  return {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    idempotencyKey: 'effect:abc',
    opportunityId: 'opportunity-1',
    targetUserId: null,
    title: 'Lead quente',
    body: 'Um lead cruzou o limiar.',
    actionUrl: '/leadflow/crm',
    ...overrides,
  };
}

function build(options: {
  process?: jest.Mock;
  findOne?: jest.Mock;
}) {
  const process =
    options.process ??
    jest.fn().mockResolvedValue({
      status: 'created',
      notificationId: 'notif-1',
      recipientCount: 1,
    });
  const processor = {
    process,
  } as unknown as NotificationEventProcessorService;
  const findOne = options.findOne ?? jest.fn();
  const opportunities = {
    findOne,
  } as unknown as Repository<CrmOpportunityEntity>;
  const publisher = new LeadFlowAutomationNotificationPublisher(
    processor,
    opportunities,
  );
  return { publisher, process, findOne };
}

describe('LeadFlowAutomationNotificationPublisher', () => {
  it('sends to the configured target without reading the opportunity', async () => {
    const { publisher, process, findOne } = build({});

    const outcome = await publisher.publish(input({ targetUserId: 'user-9' }));

    expect(outcome).toEqual({
      status: 'sent',
      notificationId: 'notif-1',
      recipientUserId: 'user-9',
    });
    expect(findOne).not.toHaveBeenCalled();

    const event = process.mock.calls[0][0] as {
      eventId: string;
      eventType: string;
      recipients: Array<{ userId: string }>;
    };
    expect(event.eventId).toBe('effect:abc');
    expect(event.eventType).toBe('leadflow.automation.notify');
    expect(event.recipients[0].userId).toBe('user-9');
  });

  it('falls back to the opportunity owner when no target is configured', async () => {
    const findOne = jest
      .fn()
      .mockResolvedValue({ id: 'opportunity-1', assignedUserId: 'user-owner' });
    const { publisher, process } = build({ findOne });

    const outcome = await publisher.publish(input());

    expect(outcome).toMatchObject({
      status: 'sent',
      recipientUserId: 'user-owner',
    });
    expect(process.mock.calls[0][0].recipients[0].userId).toBe('user-owner');
  });

  it('reports no recipient when the opportunity has no owner and no target', async () => {
    const findOne = jest
      .fn()
      .mockResolvedValue({ id: 'opportunity-1', assignedUserId: null });
    const { publisher, process } = build({ findOne });

    const outcome = await publisher.publish(input());

    expect(outcome).toEqual({ status: 'no_recipient' });
    expect(process).not.toHaveBeenCalled();
  });

  it('reports no recipient when there is neither a target nor an opportunity', async () => {
    const { publisher, process, findOne } = build({});

    const outcome = await publisher.publish(
      input({ opportunityId: null, targetUserId: null }),
    );

    expect(outcome).toEqual({ status: 'no_recipient' });
    expect(findOne).not.toHaveBeenCalled();
    expect(process).not.toHaveBeenCalled();
  });

  it('treats a processor skip as no recipient rather than a phantom send', async () => {
    const process = jest
      .fn()
      .mockResolvedValue({ status: 'skipped', reason: 'no_recipients' });
    const { publisher } = build({ process });

    const outcome = await publisher.publish(input({ targetUserId: 'user-9' }));

    expect(outcome).toEqual({ status: 'no_recipient' });
  });
});
