import { WhatsAppOutboundService } from './whatsapp-outbound.service';

describe('WhatsAppOutboundService idempotency', () => {
  afterEach(() => jest.restoreAllMocks());

  it('does not send a second Meta request when the human reply is retried with the same key', async () => {
    const channel = {
      id: 'channel',
      tenantId: 'tenant',
      workspaceId: 'workspace',
      type: 'whatsapp',
      provider: 'meta',
      status: 'active',
      externalPhoneNumberId: 'phone-test',
      accessTokenEncrypted: 'encrypted',
      metadata: {},
    };
    const conversation = {
      id: 'conversation',
      tenantId: 'tenant',
      workspaceId: 'workspace',
      channelId: 'channel',
      contactId: null,
      ownershipState: 'human_active',
      lastMessagePreview: null,
      lastMessageAt: null,
    };
    let storedMessage: Record<string, unknown> | null = null;
    const messagesRepository = {
      findOne: jest.fn().mockImplementation(() => storedMessage),
      create: jest.fn((value: Record<string, unknown>) => ({
        id: 'message',
        ...value,
      })),
      save: jest.fn((value: Record<string, unknown>) => {
        storedMessage = value;
        return Promise.resolve(value);
      }),
    };
    const manager = {
      getRepository: jest.fn().mockReturnValue({
        save: jest.fn((value: unknown) => Promise.resolve(value)),
      }),
    };
    const dataSource = {
      query: jest.fn().mockResolvedValue([
        {
          policy_outcome: 'allowed',
          status: 'claimed',
          reply_enabled: true,
        },
      ]),
      transaction: jest.fn(
        (callback: (value: typeof manager) => Promise<unknown>) =>
          callback(manager),
      ),
    };
    const service = new WhatsAppOutboundService(
      dataSource as never,
      { findOne: jest.fn().mockResolvedValue(channel) } as never,
      { findOne: jest.fn().mockResolvedValue(conversation) } as never,
      messagesRepository as never,
      { decrypt: jest.fn().mockReturnValue('test-access-token') } as never,
      {
        uploadRawFile: jest
          .fn()
          .mockResolvedValue({ url: 'https://files.test/x', path: 'x' }),
      } as never,
      {
        authorize: jest.fn((to: string) => ({
          canonicalE164: `+${to.replace(/^\+/, '')}`,
          transportRecipient: to.replace(/^\+/, ''),
          recipientHash: 'a'.repeat(64),
          recipientMasked: '+55******9999',
        })),
      } as never,
      {
        reserve: jest.fn().mockResolvedValue({}),
        started: jest.fn(),
        succeeded: jest.fn(),
        failed: jest.fn(),
        replay: jest.fn(),
      } as never,
    );
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation(() =>
        Promise.resolve(
          Response.json({ messages: [{ id: 'wamid.synthetic' }] }),
        ),
      );
    const input = {
      ctx: {
        tenantId: 'tenant',
        workspaceId: 'workspace',
        userId: 'operator',
      },
      channelId: 'channel',
      conversationId: 'conversation',
      to: '5511999999999',
      text: 'Resposta humana sintética',
      idempotencyKey: 'human-reply:test:1',
    };
    const first = await service.sendText(input);
    const second = await service.sendText(input);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.message).toBe(first.message);

    storedMessage = null;
    conversation.ownershipState = 'ai_active';
    Object.assign(conversation, { aiEnabled: true, ownershipVersion: 4 });
    const agentInput = {
      ...input,
      ctx: { tenantId: 'tenant', workspaceId: 'workspace' },
      text: 'Resposta automática sintética',
      idempotencyKey: 'agent-reply:test:1',
      agentId: 'agent',
      ownershipVersion: 4,
      decisionId: 'decision',
      policyVersion: 'inbox-autonomy-policy-v1',
    };
    const agentFirst = await service.sendAgentText(agentInput);
    const agentReplay = await service.sendAgentText(agentInput);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(agentReplay.message).toBe(agentFirst.message);
    expect(agentFirst.message).toMatchObject({
      senderType: 'agent',
      senderAgentId: 'agent',
      idempotencyKey: 'agent-reply:test:1',
    });

    dataSource.query.mockResolvedValueOnce([]);
    await expect(
      service.sendAgentText({
        ...agentInput,
        idempotencyKey: 'agent-reply:without-policy',
      }),
    ).rejects.toThrow('Automatic reply blocked by governed policy.');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('WhatsAppOutboundService automation window', () => {
  afterEach(() => jest.restoreAllMocks());

  const conversation = {
    id: 'conversation',
    tenantId: 'tenant',
    workspaceId: 'workspace',
    channelId: 'channel',
    externalThreadId: '5511999999999',
    ownershipState: 'ai_active',
    aiEnabled: true,
  };

  function build(lastInboundAt: Date | null) {
    const service = new WhatsAppOutboundService(
      {} as never,
      {} as never,
      { findOne: jest.fn().mockResolvedValue(conversation) } as never,
      {
        findOne: jest
          .fn()
          .mockResolvedValue(
            lastInboundAt
              ? { id: 'inbound-1', occurredAt: lastInboundAt }
              : null,
          ),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return service;
  }

  it('uses free-form text only inside the rolling 24-hour window', async () => {
    const service = build(new Date(Date.now() - 60 * 60 * 1_000));
    const sendText = jest
      .spyOn(service as never, 'sendTextForActor' as never)
      .mockResolvedValue({
        message: { id: 'message-text', status: 'sent' },
      } as never);

    await service.sendAutomationMessage({
      tenantId: 'tenant',
      workspaceId: 'workspace',
      conversationId: 'conversation',
      automationId: 'automation',
      idempotencyKey: 'followup-1',
      text: 'Podemos continuar?',
      templateRef: 'followup_v1',
    });

    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Podemos continuar?' }),
      { type: 'automation', automationId: 'automation' },
    );
  });

  it('uses the configured template outside the 24-hour window', async () => {
    const service = build(new Date(Date.now() - 25 * 60 * 60 * 1_000));
    const sendTemplate = jest
      .spyOn(service as never, 'sendAutomationTemplate' as never)
      .mockResolvedValue({
        message: { id: 'message-template', status: 'sent' },
      } as never);

    await service.sendAutomationMessage({
      tenantId: 'tenant',
      workspaceId: 'workspace',
      conversationId: 'conversation',
      automationId: 'automation',
      idempotencyKey: 'followup-1',
      text: 'Texto livre bloqueado',
      templateRef: 'followup_v1',
    });

    expect(sendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ templateRef: 'followup_v1' }),
    );
  });

  it('does not treat an uncertain idempotent replay as confirmed', async () => {
    const service = build(new Date(Date.now() - 60 * 60 * 1_000));
    jest
      .spyOn(service as never, 'sendTextForActor' as never)
      .mockResolvedValue({
        message: { id: 'message-pending', status: 'pending' },
      } as never);

    await expect(
      service.sendAutomationMessage({
        tenantId: 'tenant',
        workspaceId: 'workspace',
        conversationId: 'conversation',
        automationId: 'automation',
        idempotencyKey: 'followup-uncertain',
        text: 'Podemos continuar?',
      }),
    ).rejects.toThrow('Automation message delivery is not confirmed.');
  });

  it('fails closed outside the window when no template is configured', async () => {
    const service = build(new Date(Date.now() - 25 * 60 * 60 * 1_000));
    await expect(
      service.sendAutomationMessage({
        tenantId: 'tenant',
        workspaceId: 'workspace',
        conversationId: 'conversation',
        automationId: 'automation',
        idempotencyKey: 'followup-1',
        text: 'Texto livre bloqueado',
      }),
    ).rejects.toThrow(
      'whatsapp_template_required_outside_customer_service_window',
    );
  });
});
