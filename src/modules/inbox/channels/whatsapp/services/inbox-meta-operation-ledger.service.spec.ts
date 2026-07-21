import { InboxMetaOperationLedgerService } from './inbox-meta-operation-ledger.service';

describe('InboxMetaOperationLedgerService', () => {
  it('stores only protected recipient/provider references and marks replay', async () => {
    let row: Record<string, unknown> | null = null;
    const repository = {
      findOneBy: jest.fn().mockImplementation(() => row),
      create: jest.fn((value: Record<string, unknown>) => ({
        id: 'ledger',
        ...value,
      })),
      save: jest.fn((value: Record<string, unknown>) => {
        row = value;
        return Promise.resolve(value);
      }),
      update: jest.fn(),
    };
    const service = new InboxMetaOperationLedgerService(repository as never);
    const input = {
      tenantId: 'tenant',
      workspaceId: 'workspace',
      channelId: 'channel',
      conversationId: 'conversation',
      messageId: 'message',
      operation: 'send_text',
      idempotencyKey: 'key',
      recipient: {
        canonicalE164: '+5511999999999',
        transportRecipient: '5511999999999',
        recipientHash: 'a'.repeat(64),
        recipientMasked: '+55******9999',
      },
    };
    const ledger = await service.reserve(input);
    await service.started(ledger);
    await service.succeeded(ledger, Date.now() - 5, 'wamid.synthetic');
    await service.replay(input);

    expect(row).toMatchObject({
      state: 'replayed',
      costStatus: 'unknown',
      replayCount: 1,
      recipientHash: 'a'.repeat(64),
    });
    expect(JSON.stringify(row)).not.toContain('+5511999999999');
    expect(JSON.stringify(row)).not.toContain('wamid.synthetic');
  });

  it('marks a provider timeout as unknown outcome rather than success', async () => {
    const repository = {
      findOneBy: jest.fn().mockResolvedValue(null),
      create: jest.fn((value: Record<string, unknown>) => value),
      save: jest.fn((value: Record<string, unknown>) => Promise.resolve(value)),
      update: jest.fn(),
    };
    const service = new InboxMetaOperationLedgerService(repository as never);
    const ledger = await service.reserve({
      tenantId: 'tenant',
      workspaceId: 'workspace',
      channelId: 'channel',
      conversationId: 'conversation',
      messageId: null,
      operation: 'send_text',
      idempotencyKey: 'key',
      recipient: {
        canonicalE164: '+5511999999999',
        transportRecipient: '5511999999999',
        recipientHash: 'a'.repeat(64),
        recipientMasked: '+55******9999',
      },
    });
    const timeout = new Error('provider timeout');
    timeout.name = 'TimeoutError';
    await service.failed(ledger, Date.now(), timeout);
    expect(ledger).toMatchObject({
      state: 'unknown_outcome',
      errorCategory: 'provider_timeout_unknown_outcome',
      costStatus: 'unknown',
    });
  });
});
