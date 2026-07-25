import { ConflictException, NotFoundException } from '@nestjs/common';
import type { ConversationOwnershipService } from '../../inbox/services/conversation-ownership.service';
import { LeadFlowAutomationErrorClass } from '../enums/leadflow-automation-run.enums';
import type { AutomationEffectRequest } from './automation-executor.types';
import { RequestHandoffExecutor } from './request-handoff.executor';

function request(
  overrides: Partial<AutomationEffectRequest> = {},
): AutomationEffectRequest {
  return {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    automationId: 'automation-1',
    runId: 'event-1',
    attemptNumber: 1,
    actionKey: 'request_handoff',
    correlationId: 'event-1',
    idempotencyKey: 'effect:abc',
    actorRef: 'automation:automation-1',
    policyRef: 'handoff:version-1',
    payload: {
      conversationId: 'conversation-1',
      reason: 'palavra-chave sensível',
    },
    revalidation: {
      contextSchemaVersion: 1,
      capturedAt: '2026-07-24T12:00:00Z',
      subjects: { inbox_conversation: 'conversation-1' },
      expectedVersion: null,
    },
    ...overrides,
  };
}

function build(requestHandoff: jest.Mock) {
  const ownership = {
    requestHandoff,
  } as unknown as ConversationOwnershipService;
  return new RequestHandoffExecutor(ownership);
}

describe('RequestHandoffExecutor', () => {
  it('calls the canonical ownership command as the automation actor', async () => {
    const requestHandoff = jest
      .fn()
      .mockResolvedValue({ id: 'conversation-1', ownershipVersion: 3 });
    const executor = build(requestHandoff);

    const result = await executor.execute(request());

    expect(result.status).toBe('confirmed');
    expect(result.effectConfirmed).toBe(true);
    expect(result.reference).toBe('conversation-1');

    const [ctx, conversationId, reason] = requestHandoff.mock.calls[0] as [
      { tenantId: string; workspaceId: string },
      string,
      string,
    ];
    expect(ctx).toEqual({ tenantId: 'tenant-1', workspaceId: 'workspace-1' });
    expect(conversationId).toBe('conversation-1');
    expect(reason).toBe('palavra-chave sensível');
  });

  it('defaults the reason when none is configured', async () => {
    const requestHandoff = jest
      .fn()
      .mockResolvedValue({ id: 'conversation-1', ownershipVersion: 3 });
    const executor = build(requestHandoff);

    await executor.execute(
      request({ payload: { conversationId: 'conversation-1' } }),
    );

    expect(requestHandoff.mock.calls[0][2]).toBe('automation_handoff');
  });

  it('refuses without a target conversation and never calls the command', async () => {
    const requestHandoff = jest.fn();
    const executor = build(requestHandoff);

    const result = await executor.execute(
      request({ payload: { conversationId: null } }),
    );

    expect(result.status).toBe('refused');
    expect(result.errorCode).toBe('handoff_unconfigured');
    expect(requestHandoff).not.toHaveBeenCalled();
  });

  it('treats a governed conflict as refused, not failed', async () => {
    const requestHandoff = jest
      .fn()
      .mockRejectedValue(
        new ConflictException('Conversation is owned by another user.'),
      );
    const executor = build(requestHandoff);

    const result = await executor.execute(request());

    expect(result.status).toBe('refused');
    expect(result.effectConfirmed).toBe(false);
    expect(result.errorClass).toBe(LeadFlowAutomationErrorClass.Permanent);
    expect(result.errorCode).toBe('handoff_blocked');
  });

  it('treats a missing conversation as a refusal', async () => {
    const requestHandoff = jest
      .fn()
      .mockRejectedValue(new NotFoundException('gone'));
    const executor = build(requestHandoff);

    const result = await executor.execute(request());

    expect(result.status).toBe('refused');
    expect(result.errorCode).toBe('conversation_not_found');
  });

  it('treats an unexpected error as a transient failure worth retrying', async () => {
    const requestHandoff = jest
      .fn()
      .mockRejectedValue(new Error('connection reset'));
    const executor = build(requestHandoff);

    const result = await executor.execute(request());

    expect(result.status).toBe('failed');
    expect(result.errorClass).toBe(LeadFlowAutomationErrorClass.Transient);
    expect(result.errorMessage).not.toContain('connection reset');
  });
});
