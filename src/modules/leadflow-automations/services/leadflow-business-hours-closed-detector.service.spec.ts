import type { Repository } from 'typeorm';
import type { LeadFlowEventDeliveryEntity } from '../../leadflow-events/entities';
import type { InboxConversationEntity } from '../../inbox/entities/inbox-conversation.entity';
import type { InboxDomainOutboxEntity } from '../../inbox/entities/inbox-domain-outbox.entity';
import type { LeadFlowAutomationEntity } from '../entities/leadflow-automation.entity';
import { LeadFlowBusinessHoursClosedDetectorService } from './leadflow-business-hours-closed-detector.service';
import type { LeadFlowWorkspaceBusinessHoursService } from './leadflow-workspace-business-hours.service';
import { normalizeBusinessHoursSchedule } from './business-hours-schedule';

function utcWeekday(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
  })
    .format(date)
    .toLowerCase();
}

/**
 * Closed today, open every other day. Independent of when the suite runs: today
 * is always outside hours, and yesterday always supplies a closing time for the
 * current stretch to be named after.
 */
const CLOSED_TODAY = {
  enabled: true,
  timezone: 'UTC',
  days: [
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
  ].map((day) => ({
    day,
    enabled: day !== utcWeekday(new Date()),
    start: '08:00',
    end: '18:00',
  })),
};

function build(
  overrides: {
    workspaceHours?: Record<string, unknown> | null;
    automationSchedule?: Record<string, unknown> | null;
    ownershipState?: string;
  } = {},
) {
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
  const workspaceHours = {
    getSchedule: jest
      .fn()
      .mockResolvedValue(
        normalizeBusinessHoursSchedule(
          overrides.workspaceHours === undefined
            ? CLOSED_TODAY
            : overrides.workspaceHours,
        ),
      ),
  } as unknown as LeadFlowWorkspaceBusinessHoursService;
  const outbox = {
    createQueryBuilder,
  } as unknown as Repository<InboxDomainOutboxEntity>;
  const conversations = {
    findOne: jest.fn().mockResolvedValue({
      id: 'conversation-1',
      ownershipState: overrides.ownershipState ?? 'paused',
    }),
  } as unknown as Repository<InboxConversationEntity>;
  const automations = {
    findOne: jest.fn().mockResolvedValue(
      overrides.automationSchedule
        ? {
            id: 'automation-1',
            schedulePolicy: { businessHours: overrides.automationSchedule },
          }
        : null,
    ),
  } as unknown as Repository<LeadFlowAutomationEntity>;
  return {
    detector: new LeadFlowBusinessHoursClosedDetectorService(
      workspaceHours,
      outbox,
      conversations,
      automations,
    ),
    values,
    execute,
    workspaceHours,
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

function inbound(): LeadFlowEventDeliveryEntity {
  return {
    ...handoff(),
    sourceEventId: '10000000-0000-4000-8000-000000000002',
    eventName: 'leadflow.inbox.conversation.message.received',
  } as LeadFlowEventDeliveryEntity;
}

describe('LeadFlowBusinessHoursClosedDetectorService', () => {
  it('derives from a handoff requested outside hours', async () => {
    const { detector, values, execute } = build();

    await detector.observeDelivery(handoff());

    expect(execute).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'leadflow.inbox.business_hours.closed',
        aggregateId: 'conversation-1',
        payload: expect.objectContaining({
          reason: 'handoff',
          handoffEventId: '10000000-0000-4000-8000-000000000001',
        }),
      }),
    );
  });

  it('derives from a message nobody is answering', async () => {
    const { detector, values, execute } = build();

    await detector.observeDelivery(inbound());

    expect(execute).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ reason: 'unattended' }),
      }),
    );
  });

  it('stays quiet while the agent is answering the conversation', async () => {
    const { detector, execute } = build({ ownershipState: 'ai_active' });

    await detector.observeDelivery(inbound());

    expect(execute).not.toHaveBeenCalled();
  });

  it('keys the derivation by conversation and closed stretch, not by event', async () => {
    // Two messages in the same night are one out-of-hours reply: the insert is
    // ignored the second time because the key is identical.
    const { detector, values } = build();

    await detector.observeDelivery(inbound());
    await detector.observeDelivery({
      ...inbound(),
      sourceEventId: '10000000-0000-4000-8000-000000000003',
    } as LeadFlowEventDeliveryEntity);

    const keys = values.mock.calls.map(
      (call) => (call[0] as { idempotencyKey: string }).idempotencyKey,
    );
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).toContain('conversation-1');
  });

  it('judges by the schedule the automation carries, when it has one', async () => {
    const openNow = {
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
          enabled: true,
          start: '00:00',
          end: '23:59',
        },
      ],
    };
    const { detector, execute, workspaceHours } = build({
      automationSchedule: openNow,
    });

    await detector.observeDelivery(handoff());

    expect(execute).not.toHaveBeenCalled();
    expect(workspaceHours.getSchedule).not.toHaveBeenCalled();
  });

  it('refuses to guess when no schedule is configured anywhere', async () => {
    const { detector, execute } = build({ workspaceHours: null });

    await detector.observeDelivery(handoff());
    await detector.observeDelivery({
      ...handoff(),
      eventName: 'leadflow.inbox.conversation.message.sent',
    } as LeadFlowEventDeliveryEntity);

    expect(execute).not.toHaveBeenCalled();
  });
});
