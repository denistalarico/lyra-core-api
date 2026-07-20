import { LeadFlowAgentBindingReconcilerService } from './leadflow-agent-binding-reconciler.service';

describe('LeadFlowAgentBindingReconcilerService', () => {
  it('explicitly clears the current default without selecting another eligible agent', async () => {
    const channel = {
      id: 'channel-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      defaultAgentId: 'agent-1',
      aiEnabled: false,
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
      changed: true,
    });
    expect(channel.defaultAgentId).toBeNull();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(channelsRepository.save).toHaveBeenCalledWith(channel);
  });
});
