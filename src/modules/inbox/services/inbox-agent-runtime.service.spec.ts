import { ConflictException } from '@nestjs/common';
import {
  InboxAgentRuntimeService,
  orderContextMessages,
} from './inbox-agent-runtime.service';
import { ConversationOwnershipService } from './conversation-ownership.service';

describe('InboxAgentRuntimeService safety contracts', () => {
  const serviceWith = (dataSource: unknown) =>
    new InboxAgentRuntimeService(
      dataSource as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        assert(value: unknown) {
          const item = value as Record<string, unknown>;
          if (!item || item.schema_version !== 1)
            throw new Error('decision_schema_invalid');
        },
      } as never,
      {} as never,
    );

  it('claims due batches with transactional SKIP LOCKED', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const dataSource = {
      transaction: jest.fn(
        (callback: (manager: { query: typeof query }) => unknown) =>
          Promise.resolve(callback({ query })),
      ),
    };
    const service = serviceWith(dataSource);
    await expect(service.claimAndProcess('worker-a')).resolves.toBeNull();
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('FOR UPDATE SKIP LOCKED'),
    );
  });

  it('rejects malformed LLM output without applying effects', () => {
    const service = serviceWith({});
    expect(() =>
      service.assertValidProposal({ reply: 'missing fields' }),
    ).toThrow('decision_schema_invalid');
    expect(() =>
      service.assertValidProposal({
        schema_version: 1,
        reply: null,
        follow_text: null,
        stage_name: null,
        tags: [],
        handoff: false,
        handoff_reason: null,
        agent_summary: 'safe',
        service: null,
        urgency: 'normal',
        close_reason: null,
      }),
    ).not.toThrow();
  });

  it('treats failed derivatives as partial while preserving an available original', () => {
    const service = serviceWith({});
    const original = { id: 'media', kind: 'audio', status: 'available' };
    const result = (
      service as unknown as {
        mediaPolicy: (media: unknown[], derivatives: unknown[]) => string;
      }
    ).mediaPolicy([original], [{ mediaAssetId: 'media', status: 'failed' }]);
    expect(result).toBe('partial');
    expect(original.status).toBe('available');
  });

  it('orders equal and out-of-order timestamps deterministically', () => {
    const at = new Date('2026-07-17T12:00:00.000Z');
    const messages = [
      {
        id: 'c',
        occurredAt: new Date(at.getTime() + 1000),
        providerSequence: null,
      },
      { id: 'b', occurredAt: at, providerSequence: '2' },
      { id: 'a', occurredAt: at, providerSequence: '1' },
    ] as never;
    expect(orderContextMessages(messages).map((item) => item.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});

describe('ConversationOwnershipService send gate', () => {
  it('blocks an AI response created before human takeover', async () => {
    const findOneBy = jest.fn().mockResolvedValue({
      ownershipState: 'human_active',
      aiEnabled: false,
      ownershipVersion: 2,
    });
    const service = new ConversationOwnershipService({
      getRepository: () => ({ findOneBy }),
    } as never);
    await expect(
      service.assertAiCanSend({
        tenantId: 't',
        workspaceId: 'w',
        conversationId: 'c',
        ownershipVersion: 1,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({ ownershipVersion: 1 }),
    );
  });
});
