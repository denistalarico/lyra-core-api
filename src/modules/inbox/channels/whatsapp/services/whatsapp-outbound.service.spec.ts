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
      .mockResolvedValue(
        Response.json({ messages: [{ id: 'wamid.synthetic' }] }),
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
  });
});
