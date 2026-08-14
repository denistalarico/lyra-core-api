/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
import type { TimerFireEnvelope } from '../scheduler';
import type { LeadFlowJsonValue } from '../types/leadflow-automation.types';
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
  const opportunitiesUpdate = jest.fn();
  const inboxSettingsFindOne = jest.fn();
  const inboxChannelsFindOne = jest.fn();

  const consumer = new LeadFlowFollowupTimerConsumer(
    { register } as never,
    { schedule } as never,
    { evaluate: gateEvaluate } as never,
    { execute: send } as never,
    { findOne: automationsFindOne } as never,
    { findOne: conversationsFindOne } as never,
    { findOne: messagesFindOne, exist: messagesExist } as never,
    { insert: outboxInsert, create: outboxCreate } as never,
    { findOne: opportunitiesFindOne, update: opportunitiesUpdate } as never,
    { findOne: inboxSettingsFindOne } as never,
    { findOne: inboxChannelsFindOne } as never,
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

  describe('the canonical cadence', () => {
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-27T12:00:00.000Z'));
    });
    afterEach(() => jest.useRealTimers());

    /** A chain of the named plan, on a card with a follow-up mode. */
    function canonicalEnvelope(
      followUp: Record<string, unknown> = {},
      plan?: LeadFlowJsonValue,
    ) {
      opportunitiesFindOne.mockResolvedValue({
        id: 'opportunity-1',
        status: 'open',
        autonomyMode: 'automatic',
        stageId: 'stage-1',
        inboxConversationId: 'conversation-1',
        rowVersion: 4,
        followMode: 'automatic',
        followMessage: null,
        metadata: {},
        ...followUp,
      });
      conversationsFindOne.mockResolvedValue({
        id: 'conversation-1',
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        opportunityId: 'opportunity-1',
        channelId: 'channel-1',
        status: 'open',
        ownershipState: 'ai_active',
        ownershipVersion: 3,
        aiEnabled: true,
      });
      inboxChannelsFindOne.mockResolvedValue({
        id: 'channel-1',
        type: 'whatsapp',
      });
      // No outbound after the baseline, and an inbound recent enough that the
      // messaging window is still open — which is what D+0 and D+1 assume.
      // Answering by query rather than by call order: a queued `once` that a
      // test does not consume leaks into the next one.
      messagesFindOne.mockImplementation((query: { where?: { direction?: string } }) =>
        Promise.resolve(
          query?.where?.direction === 'inbound'
            ? { id: 'inbound-1', occurredAt: new Date('2026-07-27T09:00:00.000Z') }
            : null,
        ),
      );
      const envelope = deliveryEnvelope();
      envelope.payload.baselineAt = '2026-07-27T09:00:00.000Z';
      envelope.payload.templateRef = null;
      envelope.payload.automationRecipeKey = 'followup_idle_lead';
      envelope.payload.opportunityId = 'opportunity-1';
      envelope.payload.respectBusinessHours = false;
      envelope.payload.stepKey = 'd0';
      envelope.payload.followupSteps = plan ?? [
        { stepKey: 'd0', enabled: true, delayMinutes: 180, channels: [] },
        { stepKey: 'd1', enabled: true, delayMinutes: 1320, channels: [] },
      ];
      return envelope;
    }

    it('answers on the connection the lead already used', async () => {
      // The attempt carries no channel of its own: offering the choice is what
      // would let a lead who wrote on Instagram be answered on WhatsApp.
      await consumer.handleTimer(canonicalEnvelope());

      expect(inboxChannelsFindOne).toHaveBeenCalled();
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            channel: 'whatsapp',
            connectionRef: 'channel-1',
          }),
        }),
      );
    });

    it('says what the agent proposed for this attempt', async () => {
      await consumer.handleTimer(
        canonicalEnvelope({
          followMessage: 'Consegue me dizer se o horário serve?',
          metadata: {
            followUp: {
              texts: { d1: 'Ontem falamos do orçamento — seguimos?' },
            },
          },
        }),
      );

      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            text: 'Consegue me dizer se o horário serve?',
          }),
        }),
      );
    });

    it('records on the card which attempt went out', async () => {
      // The channel-result event is the log; the board needs state it can read
      // without replaying anything.
      await consumer.handleTimer(canonicalEnvelope());

      expect(opportunitiesUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'opportunity-1' }),
        expect.objectContaining({
          metadata: expect.objectContaining({
            followUp: expect.objectContaining({
              attempts: [
                expect.objectContaining({
                  stepKey: 'd0',
                  result: 'sent',
                  channel: 'whatsapp',
                  runId: 'timer-delivery',
                }),
              ],
            }),
          }),
        }),
      );
    });

    it('stops for a lead who asked to stop receiving messages', async () => {
      // The reactivation recipe used to be the only one honouring this, and it
      // was retired. A follow-up is automated outbound like any other.
      const envelope = canonicalEnvelope();
      conversationsFindOne.mockResolvedValue({
        id: 'conversation-1',
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        opportunityId: 'opportunity-1',
        channelId: 'channel-1',
        status: 'open',
        ownershipState: 'ai_active',
        ownershipVersion: 3,
        aiEnabled: true,
        metadata: {
          leadflowOutboundOptOut: {
            status: 'opted_out',
            recordedAt: '2026-07-26T10:00:00.000Z',
            source: 'inbound_keyword',
            sourceMessageId: 'message-9',
          },
        },
      });

      await consumer.handleTimer(envelope);

      expect(send).not.toHaveBeenCalled();
      expect(opportunitiesUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'opportunity-1' }),
        expect.objectContaining({
          metadata: expect.objectContaining({
            followUp: expect.objectContaining({
              attempts: [
                expect.objectContaining({
                  result: 'skipped_contact_opt_out',
                }),
              ],
            }),
          }),
        }),
      );
    });

    it('records why an attempt did not go out', async () => {
      await consumer.handleTimer(
        canonicalEnvelope({
          followMode: 'manual',
          metadata: {
            followUp: {
              steps: [
                {
                  stepKey: 'd0',
                  enabled: true,
                  delayMinutes: 180,
                  channels: [],
                },
              ],
            },
          },
        }),
      );

      expect(opportunitiesUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'opportunity-1' }),
        expect.objectContaining({
          metadata: expect.objectContaining({
            followUp: expect.objectContaining({
              attempts: [
                expect.objectContaining({
                  result: 'skipped_message_unavailable',
                }),
              ],
            }),
          }),
        }),
      );
    });

    it('stops for a card whose follow-up was switched off', async () => {
      await consumer.handleTimer(canonicalEnvelope({ followMode: 'disabled' }));

      expect(send).not.toHaveBeenCalled();
      expect(schedule).not.toHaveBeenCalled();
      expect(opportunitiesUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'opportunity-1' }),
        { nextFollowUpAt: null },
      );
    });

    it('runs the card own plan when the card is manual', async () => {
      const envelope = canonicalEnvelope({
        followMode: 'manual',
        metadata: {
          followUp: {
            steps: [
              {
                stepKey: 'd0',
                enabled: true,
                delayMinutes: 180,
                channels: [],
              },
            ],
            texts: { d0: 'Escrito à mão' },
          },
        },
      });

      await consumer.handleTimer(envelope);

      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ text: 'Escrito à mão' }),
        }),
      );
      // The manual plan has one attempt, so the chain ends here rather than
      // continuing into the automation's D+1.
      expect(schedule).not.toHaveBeenCalled();
    });

    it('never borrows the default copy for a manual card', async () => {
      await consumer.handleTimer(
        canonicalEnvelope({
          followMode: 'manual',
          metadata: {
            followUp: {
              steps: [
                {
                  stepKey: 'd0',
                  enabled: true,
                  delayMinutes: 180,
                  channels: [],
                },
              ],
            },
          },
        }),
      );

      expect(send).not.toHaveBeenCalled();
      expect(outboxInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            result: 'skipped_message_unavailable',
          }),
        }),
      );
    });

    it('hands over to the next attempt by name, and dates the card', async () => {
      const envelope = canonicalEnvelope();
      await consumer.handleTimer(envelope);

      expect(schedule).toHaveBeenCalledWith(
        expect.objectContaining({
          timerKey: expect.stringContaining(':d1'),
          payload: expect.objectContaining({ stepKey: 'd1', attemptIndex: 1 }),
        }),
      );
      expect(opportunitiesUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'opportunity-1' }),
        { nextFollowUpAt: new Date('2026-07-28T07:00:00.000Z') },
      );
    });

    it('skips an attempt switched off mid-chain instead of ending there', async () => {
      const envelope = canonicalEnvelope({}, [
        { stepKey: 'd0', enabled: false, delayMinutes: 180, channels: [] },
        {
          stepKey: 'd7',
          enabled: true,
          delayMinutes: 10080,
          channels: [{ channel: 'whatsapp', enabled: true }],
        },
      ]);

      await consumer.handleTimer(envelope);

      expect(send).not.toHaveBeenCalled();
      expect(schedule).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ stepKey: 'd7' }),
        }),
      );
    });
  });

  it('defers an attempt that comes due outside the quiet-hours envelope', async () => {
    // The old behaviour was to return here, which dropped this attempt *and*
    // the rest of the chain: the next one is only scheduled once this one runs.
    inboxSettingsFindOne.mockResolvedValue({
      businessHours: { enabled: true, timezone: 'UTC' },
    });
    const envelope = deliveryEnvelope();
    envelope.firedAt = '2026-07-27T04:00:00.000Z';
    envelope.payload.baselineAt = '2026-07-27T04:00:00.000Z';
    envelope.payload.attemptOffsetsHours = [0, 72, 168];

    await consumer.handleTimer(envelope);

    expect(send).not.toHaveBeenCalled();
    expect(schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        fireAt: '2026-07-27T07:00:00.000Z',
        payload: envelope.payload,
      }),
    );
  });

  it('sends when the attempt comes due inside the envelope', async () => {
    inboxSettingsFindOne.mockResolvedValue({
      businessHours: { enabled: true, timezone: 'UTC' },
    });
    await consumer.handleTimer(deliveryEnvelope());
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('reads the envelope in the automation zone, not the workspace one', async () => {
    // 23:00 in São Paulo is 02:00 UTC: the same instant is inside the envelope
    // for a workspace in UTC and well outside it for one in São Paulo.
    inboxSettingsFindOne.mockResolvedValue({
      businessHours: { enabled: true, timezone: 'UTC' },
    });
    const envelope = deliveryEnvelope();
    envelope.firedAt = '2026-07-28T02:00:00.000Z';
    envelope.payload.baselineAt = '2026-07-28T02:00:00.000Z';
    envelope.payload.attemptOffsetsHours = [0, 72, 168];
    envelope.payload.timezone = 'America/Sao_Paulo';

    await consumer.handleTimer(envelope);

    expect(send).not.toHaveBeenCalled();
    expect(schedule).toHaveBeenCalledWith(
      expect.objectContaining({ fireAt: '2026-07-28T10:00:00.000Z' }),
    );
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

function deliveryEnvelope(): TimerFireEnvelope & {
  payload: Record<string, unknown>;
} {
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
  };
}
