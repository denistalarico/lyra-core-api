import type { Repository } from 'typeorm';
import type { AgencyChatChannel, AgencyChatMessage } from '../entities';
import { TeamChatChannelStatus } from '../enums';
import type { TeamChatGateway } from '../gateways/team-chat.gateway';
import { TeamChatCardPostService } from './team-chat-card-post.service';
import type { TeamChatCardPostInput } from '../types/team-chat-card.types';

function input(
  overrides: Partial<TeamChatCardPostInput> = {},
): TeamChatCardPostInput {
  return {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    channelId: 'channel-1',
    dedupeKey: 'leadflow-summary:effect-1',
    sender: {
      displayName: 'Sofia',
      agentId: 'agent-1',
      agentType: 'reception',
    },
    body: 'Resumo de oportunidades',
    card: {
      kind: 'metrics_digest',
      title: 'Resumo de oportunidades',
      metrics: [{ label: 'Novas', value: '3' }],
    },
    ...overrides,
  };
}

function build(
  overrides: {
    channel?: Partial<AgencyChatChannel> | null;
    existing?: { id: string } | null;
  } = {},
) {
  const channels = {
    findOne: jest.fn().mockResolvedValue(
      overrides.channel === null
        ? null
        : {
            id: 'channel-1',
            status: TeamChatChannelStatus.ACTIVE,
            ...overrides.channel,
          },
    ),
  } as unknown as Repository<AgencyChatChannel>;

  const getOne = jest.fn().mockResolvedValue(overrides.existing ?? null);
  const save = jest.fn().mockImplementation((entity) => ({
    ...entity,
    id: 'message-1',
  }));
  const messages = {
    createQueryBuilder: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne,
    })),
    create: jest.fn((entity) => entity),
    save,
  } as unknown as Repository<AgencyChatMessage>;

  const broadcastMessageCreated = jest.fn();
  const gateway = { broadcastMessageCreated } as unknown as TeamChatGateway;

  return {
    service: new TeamChatCardPostService(messages, channels, gateway),
    save,
    broadcastMessageCreated,
  };
}

describe('TeamChatCardPostService', () => {
  it('posts as the agent, with the card in metadata and the text in the body', async () => {
    const { service, save, broadcastMessageCreated } = build();

    const result = await service.postCard(input());

    expect(result).toEqual({ status: 'posted', messageId: 'message-1' });
    const saved = save.mock.calls[0][0] as Record<string, unknown>;
    expect(saved.senderUserId).toBeNull();
    expect(saved.senderDisplayName).toBe('Sofia');
    expect(saved.body).toBe('Resumo de oportunidades');
    expect(saved.metadata).toMatchObject({
      dedupeKey: 'leadflow-summary:effect-1',
      agent: { id: 'agent-1', name: 'Sofia', type: 'reception' },
    });
    expect(broadcastMessageCreated).toHaveBeenCalledWith(
      'tenant-1',
      'workspace-1',
      'channel-1',
      expect.objectContaining({ id: 'message-1' }),
    );
  });

  it('publishes once per dedupe key', async () => {
    const { service, save } = build({ existing: { id: 'message-earlier' } });

    const result = await service.postCard(input());

    expect(result).toEqual({
      status: 'duplicate',
      messageId: 'message-earlier',
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('refuses a channel that is gone or archived', async () => {
    const missing = build({ channel: null });
    await expect(missing.service.postCard(input())).resolves.toEqual({
      status: 'channel_unavailable',
    });

    const archived = build({
      channel: { status: TeamChatChannelStatus.ARCHIVED },
    });
    await expect(archived.service.postCard(input())).resolves.toEqual({
      status: 'channel_unavailable',
    });
    expect(archived.save).not.toHaveBeenCalled();
  });

  it('keeps the message when the live push fails', async () => {
    const { service, broadcastMessageCreated } = build();
    broadcastMessageCreated.mockImplementation(() => {
      throw new Error('socket_down');
    });

    await expect(service.postCard(input())).resolves.toEqual({
      status: 'posted',
      messageId: 'message-1',
    });
  });
});
