/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
import { LeadFlowAutomationStatus } from '../enums/leadflow-automation-status.enum';
import { LeadFlowFollowupTimerConsumer } from './leadflow-followup-timer.consumer';

describe('LeadFlowFollowupTimerConsumer', () => {
  const register = jest.fn();
  const schedule = jest.fn();
  const gateEvaluate = jest.fn();
  const send = jest.fn();
  const automationsFindOne = jest.fn();
  const conversationsFindOne = jest.fn();
  const messagesFindOne = jest.fn();
  const messagesExist = jest.fn();
  const outboxInsert = jest.fn();
  const outboxCreate = jest.fn((value) => value);
  const opportunitiesFindOne = jest.fn();
  const inboxSettingsFindOne = jest.fn();

  const consumer = new LeadFlowFollowupTimerConsumer(
    { register } as never,
    { schedule } as never,
    { evaluate: gateEvaluate } as never,
    { execute: send } as never,
    { findOne: automationsFindOne } as never,
    { findOne: conversationsFindOne } as never,
    { findOne: messagesFindOne, exist: messagesExist } as never,
    { insert: outboxInsert, create: outboxCreate } as never,
    { findOne: opportunitiesFindOne } as never,
    { findOne: inboxSettingsFindOne } as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    automationsFindOne.mockResolvedValue({
      id: 'automation-1',
      recipeKey: 'followup_idle_lead',
      status: LeadFlowAutomationStatus.Active,
      publishedVersionId: 'version-1',
    });
    conversationsFindOne.mockResolvedValue({
      id: 'conversation-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      opportunityId: 'opportunity-1',
      status: 'open',
      ownershipState: 'ai_active',
      ownershipVersion: 3,
      aiEnabled: true,
    });
    messagesExist.mockResolvedValue(false);
    messagesFindOne.mockResolvedValue(null);
    inboxSettingsFindOne.mockResolvedValue({
      businessHours: { enabled: false },
    });
    gateEvaluate.mockResolvedValue({ allowed: true });
    send.mockResolvedValue({
      status: 'confirmed',
      effectConfirmed: true,
      reference: 'message-2',
    });
    schedule.mockResolvedValue({ timerId: 'timer-2' });
  });

  it('registers itself as the named timer consumer', () => {
    consumer.onModuleInit();
    expect(register).toHaveBeenCalledWith(consumer);
  });

  it('emits conversation.idle only while the baseline is still latest', async () => {
    messagesFindOne.mockResolvedValue({
      id: 'message-1',
      direction: 'outbound',
      occurredAt: new Date('2026-07-26T12:00:00.000Z'),
    });
    await consumer.handleTimer(idleEnvelope());
    expect(outboxInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'leadflow.inbox.conversation.idle',
        payload: expect.objectContaining({
          automationId: 'automation-1',
          baselineMessageId: 'message-1',
        }),
      }),
    );
  });

  it('cancels the idle signal when a newer interaction exists', async () => {
    messagesFindOne.mockResolvedValue({
      id: 'message-new',
      direction: 'inbound',
      occurredAt: new Date('2026-07-26T13:00:00.000Z'),
    });
    await consumer.handleTimer(idleEnvelope());
    expect(outboxInsert).not.toHaveBeenCalled();
  });

  it('treats a duplicate idle outbox event as an idempotent retry', async () => {
    messagesFindOne.mockResolvedValue({
      id: 'message-1',
      direction: 'outbound',
      occurredAt: new Date('2026-07-26T12:00:00.000Z'),
    });
    outboxInsert.mockRejectedValueOnce(
      Object.assign(new Error('duplicate'), { code: '23505' }),
    );
    await expect(consumer.handleTimer(idleEnvelope())).resolves.toBeUndefined();
  });

  it('stops a due follow-up when the lead replied after the baseline', async () => {
    messagesExist.mockResolvedValue(true);
    await consumer.handleTimer(deliveryEnvelope());
    expect(send).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });

  it('stops a conversation follow-up when its linked opportunity is manual', async () => {
    opportunitiesFindOne.mockResolvedValue({
      id: 'opportunity-1',
      status: 'open',
      autonomyMode: 'manual',
      stageId: 'stage-1',
      inboxConversationId: 'conversation-1',
      rowVersion: 4,
    });
    const envelope = deliveryEnvelope() as {
      payload: Record<string, unknown>;
    };
    envelope.payload.opportunityId = 'opportunity-1';

    await consumer.handleTimer(envelope as never);
    expect(send).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });

  it('stops an old sequence after a newer human outbound message', async () => {
    messagesFindOne.mockResolvedValue({
      id: 'message-human',
      occurredAt: new Date('2026-07-26T14:00:00.000Z'),
      metadata: {},
    });
    await consumer.handleTimer(deliveryEnvelope());
    expect(send).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });

  it('keeps the sequence after a prior send from the same automation', async () => {
    messagesFindOne.mockResolvedValue({
      id: 'message-followup-1',
      occurredAt: new Date('2026-07-27T12:00:00.000Z'),
      metadata: { automationId: 'automation-1' },
    });
    await consumer.handleTimer(deliveryEnvelope());
    expect(send).toHaveBeenCalled();
  });

  it('sends once and schedules the next D+N attempt after confirmation', async () => {
    await consumer.handleTimer(deliveryEnvelope());
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        actionKey: 'send_message',
        idempotencyKey: expect.stringMatching(/^followup:/),
      }),
    );
    expect(schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        timerKey: expect.stringContaining(':2'),
        payload: expect.objectContaining({ attemptIndex: 1 }),
      }),
    );
  });

  it('allows WhatsApp text inside the rolling window without a template', async () => {
    messagesFindOne.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'inbound-1',
      occurredAt: new Date('2026-07-27T11:30:00.000Z'),
    });
    const envelope = deliveryEnvelope() as {
      payload: Record<string, unknown>;
    };
    envelope.payload.templateRef = null;
    envelope.payload.followupSteps = [
      {
        stepKey: 'd1',
        delayMinutes: 1440,
        channels: [
          {
            channel: 'whatsapp',
            enabled: true,
            outsideWindowEnabled: false,
            connectionRef: 'channel-1',
          },
        ],
      },
    ];

    await consumer.handleTimer(envelope as never);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          channel: 'whatsapp',
          templateRef: null,
        }),
      }),
    );
  });

  it('records a template-required skip without cancelling the next step', async () => {
    const envelope = deliveryEnvelope() as {
      payload: Record<string, unknown>;
    };
    envelope.payload.templateRef = null;
    envelope.payload.followupSteps = [
      {
        stepKey: 'd1',
        delayMinutes: 1440,
        channels: [
          {
            channel: 'whatsapp',
            enabled: true,
            outsideWindowEnabled: true,
            connectionRef: 'channel-1',
          },
        ],
      },
      {
        stepKey: 'd3',
        delayMinutes: 4320,
        channels: [
          {
            channel: 'whatsapp',
            enabled: true,
            outsideWindowEnabled: false,
            connectionRef: 'channel-1',
          },
        ],
      },
    ];

    await consumer.handleTimer(envelope as never);

    expect(send).not.toHaveBeenCalled();
    expect(outboxInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'leadflow.automations.followup.channel_result',
        payload: expect.objectContaining({
          stepKey: 'd1',
          channel: 'whatsapp',
          result: 'skipped_template_required',
        }),
      }),
    );
    expect(schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ attemptIndex: 1 }),
      }),
    );
  });

  it('keeps other channels independent when one is unavailable', async () => {
    messagesFindOne.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'inbound-1',
      occurredAt: new Date('2026-07-27T11:30:00.000Z'),
    });
    send
      .mockResolvedValueOnce({
        status: 'confirmed',
        effectConfirmed: true,
        reference: 'message-1',
      })
      .mockResolvedValueOnce({
        status: 'unavailable',
        effectConfirmed: false,
        errorCode: 'followup_channel_transport_unavailable',
      });
    const envelope = deliveryEnvelope() as {
      payload: Record<string, unknown>;
    };
    envelope.payload.followupSteps = [
      {
        stepKey: 'd1',
        delayMinutes: 1440,
        channels: [
          {
            channel: 'whatsapp',
            enabled: true,
            outsideWindowEnabled: false,
          },
          {
            channel: 'webchat',
            enabled: true,
            outsideWindowEnabled: false,
          },
        ],
      },
    ];

    await consumer.handleTimer(envelope as never);

    expect(send).toHaveBeenCalledTimes(2);
    expect(outboxInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          channel: 'webchat',
          result: 'skipped_channel_unavailable',
        }),
      }),
    );
  });

  it('honors the kill switch again when the timer fires', async () => {
    gateEvaluate.mockResolvedValue({
      allowed: false,
      reason: 'execution_disabled',
    });
    await consumer.handleTimer(deliveryEnvelope());
    expect(send).not.toHaveBeenCalled();
  });

  it('does not send outside the configured business hours', async () => {
    inboxSettingsFindOne.mockResolvedValue({
      businessHours: {
        enabled: true,
        timezone: 'UTC',
        days: [
          {
            day: 'monday',
            enabled: true,
            start: '09:00',
            end: '10:00',
          },
        ],
      },
    });
    await consumer.handleTimer(deliveryEnvelope());
    expect(send).not.toHaveBeenCalled();
  });
});

function idleEnvelope() {
  return {
    timerId: 'timer-idle',
    timerKey: 'idle',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    purpose: 'automation_followup',
    consumerKey: 'leadflow.automations.followup',
    scheduledAt: '2026-07-26T12:00:00.000Z',
    firedAt: '2026-07-27T12:00:00.000Z',
    attempt: 1,
    payload: {
      kind: 'idle_detection',
      automationId: 'automation-1',
      conversationId: 'conversation-1',
      baselineMessageId: 'message-1',
      baselineAt: '2026-07-26T12:00:00.000Z',
      idleHours: 24,
    },
  } as never;
}

function deliveryEnvelope() {
  return {
    timerId: 'timer-delivery',
    timerKey: 'delivery',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    purpose: 'automation_followup',
    consumerKey: 'leadflow.automations.followup',
    scheduledAt: '2026-07-26T12:00:00.000Z',
    firedAt: '2026-07-27T12:00:00.000Z',
    attempt: 1,
    payload: {
      kind: 'followup_delivery',
      automationId: 'automation-1',
      conversationId: 'conversation-1',
      baselineAt: '2026-07-26T12:00:00.000Z',
      attemptIndex: 0,
      attemptOffsetsHours: [24, 72, 168],
      stopIfReplied: true,
      stopIfHandoff: true,
      respectBusinessHours: true,
      text: 'Podemos continuar?',
      templateRef: 'followup_v1',
    },
  } as never;
}
