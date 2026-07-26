/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import type { SchedulerRuntime } from '../scheduler';
import { ScheduleFollowupExecutor } from './schedule-followup.executor';
import type { AutomationEffectRequest } from './automation-executor.types';

describe('ScheduleFollowupExecutor', () => {
  const schedule = jest.fn().mockResolvedValue({
    timerId: 'timer-1',
    timerKey: 'key',
    status: 'scheduled',
    fireAt: '2026-07-27T12:00:00.000Z',
  });
  const executor = new ScheduleFollowupExecutor({
    schedule,
    cancel: jest.fn(),
    reschedule: jest.fn(),
  } as SchedulerRuntime);

  beforeEach(() => schedule.mockClear());

  it('persists an idempotent timer for a valid follow-up', async () => {
    const result = await executor.execute(request());

    expect(result).toMatchObject({
      status: 'confirmed',
      effectConfirmed: true,
      reference: 'timer-1',
    });
    expect(schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        purpose: 'automation_followup',
        consumerKey: 'leadflow.automations.followup',
        payload: expect.objectContaining({
          kind: 'followup_delivery',
          automationId: 'automation-1',
          attemptIndex: 0,
        }),
      }),
    );
  });

  it('refuses an incomplete schedule without touching the runtime', async () => {
    const result = await executor.execute(
      request({ fireAt: null, baselineAt: null }),
    );
    expect(result.status).toBe('refused');
    expect(schedule).not.toHaveBeenCalled();
  });

  it('reports a transient failure when persistence fails', async () => {
    schedule.mockRejectedValueOnce(new Error('db_down'));
    const result = await executor.execute(request());
    expect(result).toMatchObject({
      status: 'failed',
      errorCode: 'followup_schedule_failed',
    });
  });
});

function request(
  payload: Record<string, unknown> = {},
): AutomationEffectRequest {
  return {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    automationId: 'automation-1',
    runId: 'event-1',
    attemptNumber: 1,
    actionKey: 'schedule_followup',
    correlationId: 'event-1',
    idempotencyKey: 'effect-1',
    actorRef: 'automation:automation-1',
    policyRef: 'followup:version-1',
    payload: {
      conversationId: 'conversation-1',
      baselineAt: '2026-07-26T12:00:00.000Z',
      fireAt: '2026-07-27T12:00:00.000Z',
      attemptOffsetsHours: [24, 72, 168],
      ...payload,
    },
    revalidation: {
      contextSchemaVersion: 1,
      capturedAt: '2026-07-26T12:00:00.000Z',
      subjects: { inbox_conversation: 'conversation-1' },
      expectedVersion: 1,
    },
  };
}
