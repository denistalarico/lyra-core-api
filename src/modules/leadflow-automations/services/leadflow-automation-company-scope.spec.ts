import { NotFoundException } from '@nestjs/common';
import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import { LeadFlowAutomationService } from './leadflow-automation.service';

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
  const automations = { find: jest.fn().mockResolvedValue([]), findOne: jest.fn().mockResolvedValue(null), save: jest.fn() };
  const settingsRepo = { findOne: jest.fn().mockResolvedValue(settings) };
  const recipes = { isCustomBusinessMode: jest.fn().mockReturnValue(false) };
  const service = new LeadFlowAutomationService(
    automations as never,
    {} as never,
    settingsRepo as never,
    {} as never,
    {} as never,
    recipes as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { can: jest.fn().mockResolvedValue(true) } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, automations, settingsRepo };
}

describe('LeadFlowAutomationService company scope closure', () => {
  it('lists, reads, edits, and publishes roots only in Company A', async () => {
    const { service, automations, settingsRepo } = harness();

    await service.list(ctx);
    expect(settingsRepo.findOne).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        agencyClientId: ctx.managedContext.clientId,
        companyContextId: ctx.managedContext.companyContextId,
      }),
    }));
    expect(automations.find).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        agencyClientId: ctx.managedContext.clientId,
        companyContextId: ctx.managedContext.companyContextId,
      }),
    }));

    await expect(service.getById(ctx, 'automation-b')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.patch(ctx, 'automation-b', { name: 'A editou' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.publish(ctx, 'automation-b')).rejects.toBeInstanceOf(NotFoundException);
    expect(automations.findOne).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'automation-b',
        agencyClientId: ctx.managedContext.clientId,
        companyContextId: ctx.managedContext.companyContextId,
      }),
    }));
    expect(automations.save).not.toHaveBeenCalled();
  });
});
