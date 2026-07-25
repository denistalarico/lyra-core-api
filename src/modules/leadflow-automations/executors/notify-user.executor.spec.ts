import { LeadFlowAutomationErrorClass } from '../enums/leadflow-automation-run.enums';
import type { LeadFlowAutomationNotificationPublisher } from '../services/leadflow-automation-notification.publisher';
import type { AutomationEffectRequest } from './automation-executor.types';
import { NotifyUserExecutor } from './notify-user.executor';

function request(
  overrides: Partial<AutomationEffectRequest> = {},
): AutomationEffectRequest {
  return {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    automationId: 'automation-1',
    runId: 'event-1',
    attemptNumber: 1,
    actionKey: 'notify_user',
    correlationId: 'event-1',
    idempotencyKey: 'effect:abc',
    actorRef: 'automation:automation-1',
    policyRef: 'notify:version-1',
    payload: {
      opportunityId: 'opportunity-1',
      targetUserId: null,
      title: 'Lead quente',
      body: 'Um lead cruzou o limiar.',
      actionUrl: '/leadflow/crm',
    },
    revalidation: {
      contextSchemaVersion: 1,
      capturedAt: '2026-07-25T12:00:00Z',
      subjects: { crm_opportunity: 'opportunity-1' },
      expectedVersion: null,
    },
    ...overrides,
  };
}

function build(publish: jest.Mock) {
  const publisher = {
    publish,
  } as unknown as LeadFlowAutomationNotificationPublisher;
  return new NotifyUserExecutor(publisher);
}

describe('NotifyUserExecutor', () => {
  it('confirms and carries the notification id when the alert is sent', async () => {
    const publish = jest.fn().mockResolvedValue({
      status: 'sent',
      notificationId: 'notif-1',
      recipientUserId: 'user-owner',
    });
    const executor = build(publish);

    const result = await executor.execute(request());

    expect(result.status).toBe('confirmed');
    expect(result.effectConfirmed).toBe(true);
    expect(result.reference).toBe('notif-1');

    expect(publish.mock.calls[0][0]).toMatchObject({
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      idempotencyKey: 'effect:abc',
      opportunityId: 'opportunity-1',
      title: 'Lead quente',
      actionUrl: '/leadflow/crm',
    });
  });

  it('defaults message and action url when the payload omits them', async () => {
    const publish = jest.fn().mockResolvedValue({
      status: 'sent',
      notificationId: 'notif-1',
      recipientUserId: 'user-owner',
    });
    const executor = build(publish);

    await executor.execute(
      request({ payload: { opportunityId: 'opportunity-1' } }),
    );

    expect(publish.mock.calls[0][0]).toMatchObject({
      title: 'Alerta de lead',
      actionUrl: '/leadflow/crm',
    });
  });

  it('refuses when no recipient can be resolved', async () => {
    const publish = jest.fn().mockResolvedValue({ status: 'no_recipient' });
    const executor = build(publish);

    const result = await executor.execute(request());

    expect(result.status).toBe('refused');
    expect(result.errorClass).toBe(LeadFlowAutomationErrorClass.Permanent);
    expect(result.errorCode).toBe('notify_no_recipient');
  });

  it('treats an unexpected error as a transient failure', async () => {
    const publish = jest.fn().mockRejectedValue(new Error('db down'));
    const executor = build(publish);

    const result = await executor.execute(request());

    expect(result.status).toBe('failed');
    expect(result.errorClass).toBe(LeadFlowAutomationErrorClass.Transient);
    expect(result.errorMessage).not.toContain('db down');
  });
});
