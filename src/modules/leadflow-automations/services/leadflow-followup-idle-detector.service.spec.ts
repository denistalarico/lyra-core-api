/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { LeadFlowAutomationStatus } from '../enums/leadflow-automation-status.enum';
import { LeadFlowFollowupIdleDetectorService } from './leadflow-followup-idle-detector.service';

describe('LeadFlowFollowupIdleDetectorService', () => {
  const findMatchingTrigger = jest.fn();
  const schedule = jest.fn();
  const service = new LeadFlowFollowupIdleDetectorService(
    { findMatchingTrigger } as never,
    { schedule } as never,
  );

  beforeEach(() => {
    findMatchingTrigger.mockReset();
    schedule.mockReset().mockResolvedValue({ timerId: 'timer-1' });
  });

  it('schedules one detector from a real message.sent delivery', async () => {
    findMatchingTrigger.mockResolvedValue([
      {
        source: { id: 'automation-1', status: LeadFlowAutomationStatus.Active },
        automation: { triggerConfig: { delayHours: 24 } },
      },
    ]);
    const count = await service.observeDelivery(delivery());
    expect(count).toBe(1);
    expect(schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        timerKey: 'idle:automation-1:conversation-1:message-1',
        fireAt: '2026-07-27T12:00:00.000Z',
        payload: expect.objectContaining({
          kind: 'idle_detection',
          baselineMessageId: 'message-1',
        }),
      }),
    );
  });

  it('does not schedule from unrelated events', async () => {
    const count = await service.observeDelivery(
      delivery({ eventName: 'leadflow.inbox.conversation.message.received' }),
    );
    expect(count).toBe(0);
    expect(findMatchingTrigger).not.toHaveBeenCalled();
  });

  it('does not create a recursive cycle from an automation follow-up', async () => {
    const count = await service.observeDelivery(
      delivery({
        payload: {
          messageId: 'message-2',
          authorType: 'system',
          automationId: 'automation-1',
        },
      }),
    );
    expect(count).toBe(0);
    expect(findMatchingTrigger).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });

  it('ignores paused automations', async () => {
    findMatchingTrigger.mockResolvedValue([
      {
        source: { id: 'automation-1', status: LeadFlowAutomationStatus.Paused },
        automation: { triggerConfig: { delayHours: 24 } },
      },
    ]);
    expect(await service.observeDelivery(delivery())).toBe(0);
    expect(schedule).not.toHaveBeenCalled();
  });
});

function delivery(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    aggregateType: 'inbox_conversation',
    aggregateId: 'conversation-1',
    eventName: 'leadflow.inbox.conversation.message.sent',
    occurredAt: new Date('2026-07-26T12:00:00.000Z'),
    payload: { messageId: 'message-1' },
    ...overrides,
  } as never;
}
