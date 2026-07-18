import { NotFoundException } from '@nestjs/common';
import type { DataSource, Repository } from 'typeorm';
import type { RequestContext } from '../../../common/context/request-context.interface';
import type { AgencyClient } from '../../clients/entities';
import type { LeadFlowClientSettingsEntity } from '../entities';
import { LeadFlowSettingsContextType } from '../enums/leadflow-settings-context-type.enum';
import { CompanyContextService } from './company-context.service';
import type { LeadFlowBusinessModeTemplateService } from './leadflow-business-mode-template.service';
import { LeadFlowClientSettingsService } from './leadflow-client-settings.service';

describe('LeadFlowClientSettingsService tenant/workspace isolation', () => {
  const ctx: RequestContext = {
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    userId: 'user-a',
  };

  function setup() {
    const agencyClientsRepository = {
      findOne: jest.fn(),
    } as unknown as Repository<AgencyClient>;
    const settingsRepository = {
      findOne: jest.fn(),
    } as unknown as Repository<LeadFlowClientSettingsEntity>;
    const service = new LeadFlowClientSettingsService(
      {} as DataSource,
      agencyClientsRepository,
      settingsRepository,
      {} as LeadFlowBusinessModeTemplateService,
      new CompanyContextService(),
    );

    return { service, agencyClientsRepository, settingsRepository };
  }

  it('scopes client lookup by tenant, workspace, context and client id', async () => {
    const { service, agencyClientsRepository, settingsRepository } = setup();
    jest
      .mocked(agencyClientsRepository.findOne)
      .mockResolvedValue({ id: 'client-a' } as AgencyClient);
    jest.mocked(settingsRepository.findOne).mockResolvedValue(null);

    await expect(service.getSettings(ctx, 'client-a')).rejects.toThrow(
      NotFoundException,
    );

    expect(agencyClientsRepository.findOne).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'client-a',
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
      }),
    });
    expect(settingsRepository.findOne).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        contextType: LeadFlowSettingsContextType.Client,
        agencyClientId: 'client-a',
      },
    });
  });

  it('scopes agency lookup by tenant and workspace', async () => {
    const { service, settingsRepository } = setup();
    jest.mocked(settingsRepository.findOne).mockResolvedValue(null);

    await expect(service.getAgencySettings(ctx)).rejects.toThrow(
      NotFoundException,
    );

    expect(settingsRepository.findOne).toHaveBeenCalledWith({
      where: expect.objectContaining({
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        contextType: LeadFlowSettingsContextType.Agency,
      }),
    });
  });
});
