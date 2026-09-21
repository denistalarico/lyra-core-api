import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import { LeadFlowAgentService } from './leadflow-agent.service';

const ctx = {
  tenantId: '10000000-0000-4000-8000-000000000001',
  workspaceId: '20000000-0000-4000-8000-000000000002',
  userId: '30000000-0000-4000-8000-000000000003',
  role: 'admin',
  managedContext: {
    productKey: 'leadflow',
    operatingMode: 'client',
    clientId: '40000000-0000-4000-8000-000000000004',
    companyContextId: '50000000-0000-4000-8000-000000000005',
    managedTenantId: null,
  },
} as const;

function harness() {
  const settings = {
    id: 'settings-a',
    tenantId: ctx.tenantId,
    workspaceId: ctx.workspaceId,
    contextType: LeadFlowSettingsContextType.Client,
    agencyClientId: ctx.managedContext.clientId,
    companyContextId: ctx.managedContext.companyContextId,
    businessModeKey: 'services',
  };
  const agents = { find: jest.fn().mockResolvedValue([]), findOne: jest.fn().mockResolvedValue(null), save: jest.fn() };
  const settingsRepo = { findOne: jest.fn().mockResolvedValue(settings) };
  const channels = { find: jest.fn().mockResolvedValue([]) };
  const service = new LeadFlowAgentService(
    agents as never,
    {} as never,
    { find: jest.fn().mockResolvedValue([]) } as never,
    settingsRepo as never,
    {} as never,
    {} as never,
    {} as never,
    { isCustomBusinessMode: jest.fn().mockReturnValue(false) } as never,
    {} as never,
    { can: jest.fn().mockResolvedValue(true) } as never,
    {} as never,
    {} as never,
    channels as never,
  );
  return { service, agents, settingsRepo, channels };
}

describe('LeadFlowAgentService company scope closure', () => {
  it('lists only the selected company and scopes all root reads and writes', async () => {
    const { service, agents, settingsRepo } = harness();

    await service.list(ctx);
    expect(settingsRepo.findOne).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        agencyClientId: ctx.managedContext.clientId,
        companyContextId: ctx.managedContext.companyContextId,
      }),
    }));
    expect(agents.find).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        agencyClientId: ctx.managedContext.clientId,
        companyContextId: ctx.managedContext.companyContextId,
      }),
    }));

    await expect(service.getById(ctx, 'agent-b')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.patch(ctx, 'agent-b', { name: 'A editou' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.publish(ctx, 'agent-b')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getAgentRuntimeConfig(ctx, 'agent-b')).rejects.toBeInstanceOf(NotFoundException);
    expect(agents.findOne).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'agent-b',
        agencyClientId: ctx.managedContext.clientId,
        companyContextId: ctx.managedContext.companyContextId,
      }),
    }));
    expect(agents.save).not.toHaveBeenCalled();
  });

  it('rejects an Inbox Channel from Company B in an Agent Company A policy', async () => {
    const { service, agents, channels } = harness();
    const checker = service as unknown as {
      assertChannelPoliciesInScope: (policy: unknown, active: unknown) => Promise<void>;
    };
    await expect(checker.assertChannelPoliciesInScope({
      allowedChannels: [],
      defaultChannel: null,
      activationPolicy: null,
      channelActivationPolicies: {
        '60000000-0000-4000-8000-000000000006': { trigger: 'manual' },
      },
    }, {
      agencyClientId: ctx.managedContext.clientId,
      companyContextId: ctx.managedContext.companyContextId,
      settings: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
    })).rejects.toBeInstanceOf(BadRequestException);

    expect(channels.find).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        agencyClientId: ctx.managedContext.clientId,
        companyContextId: ctx.managedContext.companyContextId,
      }),
    }));
    expect(agents.save).not.toHaveBeenCalled();
  });
});
