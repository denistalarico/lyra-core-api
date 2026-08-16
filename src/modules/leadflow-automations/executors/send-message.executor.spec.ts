import { ConflictException } from '@nestjs/common';
import { SendMessageExecutor } from './send-message.executor';
import { WhatsAppAutomationTemplateError } from '../../inbox/channels/whatsapp/services/whatsapp-outbound.service';
import type { AutomationEffectRequest } from './automation-executor.types';

describe('SendMessageExecutor', () => {
  const sendAutomationMessage = jest.fn();
  const render = jest.fn();
  const executor = new SendMessageExecutor(
    { sendAutomationMessage } as never,
    {
      render,
    } as never,
  );

  beforeEach(() => {
    sendAutomationMessage.mockReset();
    render.mockReset();
  });

  it('delegates to the canonical Inbox command', async () => {
    sendAutomationMessage.mockResolvedValue({ message: { id: 'message-1' } });
    const result = await executor.execute(request());
    expect(result).toMatchObject({
      status: 'confirmed',
      effectConfirmed: true,
      reference: 'message-1',
    });
    expect(sendAutomationMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conversation-1',
        automationId: 'automation-1',
        idempotencyKey: 'followup-effect-1',
        templateRef: 'followup_v1',
      }),
    );
  });

  it('maps the WhatsApp window/template guard to a permanent refusal', async () => {
    sendAutomationMessage.mockRejectedValue(
      new ConflictException(
        'whatsapp_template_required_outside_customer_service_window',
      ),
    );
    const result = await executor.execute(request({ templateRef: null }));
    expect(result).toMatchObject({
      status: 'refused',
      errorCode: 'whatsapp_template_required',
    });
  });

  it('fails closed when no conversation is present', async () => {
    const result = await executor.execute(request({ conversationId: null }));
    expect(result.status).toBe('refused');
    expect(sendAutomationMessage).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid', 'whatsapp_template_invalid'],
    ['language_mismatch', 'whatsapp_template_language_mismatch'],
    ['components_unsupported', 'whatsapp_template_components_unsupported'],
  ] as const)(
    'maps template %s to a channel-scoped skip',
    async (reason, code) => {
      sendAutomationMessage.mockRejectedValue(
        new WhatsAppAutomationTemplateError(reason),
      );

      const result = await executor.execute(request());

      expect(result).toMatchObject({
        status: 'refused',
        errorCode: code,
        effectConfirmed: false,
      });
    },
  );

  it('does not simulate success for a transport without an adapter', async () => {
    const result = await executor.execute(request({ channel: 'sms' }));

    expect(result).toMatchObject({
      status: 'refused',
      effectConfirmed: false,
      errorCode: 'followup_channel_transport_unavailable',
    });
    expect(sendAutomationMessage).not.toHaveBeenCalled();
  });

  it('resolves the commitment variables when the send is about one', async () => {
    sendAutomationMessage.mockResolvedValue({ message: { id: 'message-2' } });
    render.mockResolvedValue({
      text: 'Oi Marina! Sua consulta é às 14:30.',
      templateParameters: ['Marina', '14:30'],
      values: {},
    });

    await executor.execute(
      request({
        appointmentId: 'appointment-1',
        text: 'Oi {{contact.firstName}}! Sua consulta é às {{appointment.time}}.',
      }),
    );

    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({
        appointmentId: 'appointment-1',
        automationId: 'automation-1',
      }),
      'Oi {{contact.firstName}}! Sua consulta é às {{appointment.time}}.',
    );
    expect(sendAutomationMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Oi Marina! Sua consulta é às 14:30.',
        // The order the variables appear in is the order the template was
        // approved in — Meta matches by position, never by name.
        templateParameters: ['Marina', '14:30'],
      }),
    );
  });

  it('leaves a message that is not about a commitment untouched', async () => {
    sendAutomationMessage.mockResolvedValue({ message: { id: 'message-3' } });

    await executor.execute(request());

    expect(render).not.toHaveBeenCalled();
    expect(sendAutomationMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Podemos continuar?',
        templateParameters: [],
      }),
    );
  });
});

function request(
  payload: Record<string, unknown> = {},
): AutomationEffectRequest {
  return {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    automationId: 'automation-1',
    runId: 'timer-1',
    attemptNumber: 1,
    actionKey: 'send_message',
    correlationId: 'timer-1',
    idempotencyKey: 'followup-effect-1',
    actorRef: 'automation:automation-1',
    policyRef: 'followup:version-1',
    payload: {
      conversationId: 'conversation-1',
      text: 'Podemos continuar?',
      templateRef: 'followup_v1',
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
