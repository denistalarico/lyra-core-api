import { LeadFlowAgentBindingReconcilerService } from './leadflow-agent-binding-reconciler.service';
import { LeadFlowAgentStatus } from '../enums/leadflow-agent-status.enum';
import { LeadFlowAgentChannelStatus } from '../enums/leadflow-agent-channel-status.enum';

describe('LeadFlowAgentBindingReconcilerService', () => {
  it('explicitly clears the current default without selecting another eligible agent, and turns the channel off', async () => {
    const channel = {
      id: 'channel-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      defaultAgentId: 'agent-1',
      aiEnabled: true,
      lifecycleVersion: 3,
    };
    const execute = jest.fn().mockResolvedValue({ affected: 1 });
    const queryBuilder = {
      update: jest.fn(),
      set: jest.fn(),
      where: jest.fn(),
      andWhere: jest.fn(),
      execute,
    };
    for (const method of ['update', 'set', 'where', 'andWhere'] as const) {
      queryBuilder[method].mockReturnValue(queryBuilder);
    }
    const channelsRepository = {
      find: jest.fn().mockResolvedValue([channel]),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    const manager = {
      query: jest.fn().mockResolvedValue([]),
      getRepository: jest.fn().mockReturnValue(channelsRepository),
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };
    const dataSource = {
      transaction: jest.fn().mockImplementation(async (work) => work(manager)),
    };
    const service = new LeadFlowAgentBindingReconcilerService(
      dataSource as never,
    );

    const [result] = await service.reconcile(
      {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
      },
      {
        channelId: 'channel-1',
        clearDefault: true,
        trigger: 'default_changed',
      },
    );

    expect(result).toMatchObject({
      channelId: 'channel-1',
      status: 'unbound',
      defaultAgentId: null,
      aiEnabled: false,
      changed: true,
    });
    expect(channel.defaultAgentId).toBeNull();
    expect(channel.aiEnabled).toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(channelsRepository.save).toHaveBeenCalledWith(channel);
  });

  it('turns the channel on when a single eligible agent is bound as the default', async () => {
    const channel = {
      id: 'channel-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      type: 'facebook_messenger',
      provider: 'meta',
      status: 'active',
      connectionStatus: 'connected',
      defaultAgentId: null,
      aiEnabled: false,
      lifecycleVersion: 1,
    };
    const agent = {
      id: 'agent-1',
      status: LeadFlowAgentStatus.Active,
      publishedVersionId: 'v1',
      channelPolicy: { allowedChannels: ['facebook_messenger'] },
      createdAt: new Date(),
    };
    const agentsRepository = { find: jest.fn().mockResolvedValue([agent]) };
    const channelsRepository = {
      find: jest.fn().mockResolvedValue([channel]),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    const queryBuilder = {
      where: jest.fn(),
      andWhere: jest.fn(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    for (const method of ['where', 'andWhere'] as const) {
      queryBuilder[method].mockReturnValue(queryBuilder);
    }
    const bindingsRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
      findOneBy: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((value) => value),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    const manager = {
      query: jest.fn().mockResolvedValue([]),
      getRepository: jest.fn().mockImplementation((entity) => {
        if (entity.name === 'LeadFlowAgentEntity') return agentsRepository;
        if (entity.name === 'LeadFlowAgentChannelBindingEntity')
          return bindingsRepository;
        return channelsRepository;
      }),
    };
    const dataSource = {
      transaction: jest.fn().mockImplementation(async (work) => work(manager)),
    };
    const service = new LeadFlowAgentBindingReconcilerService(
      dataSource as never,
    );

    const [result] = await service.reconcile(
      {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
      },
      {
        channelId: 'channel-1',
        preferredAgentId: 'agent-1',
        trigger: 'default_changed',
      },
    );

    expect(result).toMatchObject({
      channelId: 'channel-1',
      status: 'active',
      defaultAgentId: 'agent-1',
      aiEnabled: true,
      changed: true,
    });
    expect(channel.aiEnabled).toBe(true);
    expect(bindingsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: LeadFlowAgentChannelStatus.Active }),
    );
  });
});
