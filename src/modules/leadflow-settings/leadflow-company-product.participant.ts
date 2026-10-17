import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  CompanyProductRegistry,
  type CompanyProductOperation,
} from '../../common/company-products/company-product.registry';
import { LeadFlowClientSettingsEntity } from './entities';
import { LeadFlowClientSettingsService } from './services/leadflow-client-settings.service';
import { LeadFlowSettingsStatus } from './enums/leadflow-settings-status.enum';

@Injectable()
export class LeadFlowCompanyProductParticipant implements OnModuleInit {
  constructor(
    private readonly registry: CompanyProductRegistry,
    private readonly settings: LeadFlowClientSettingsService,
  ) {}
  onModuleInit() {
    this.registry.register({
      key: 'leadflow-settings',
      productKey: 'leadflow',
      pending: () => Promise.resolve([]),
      capacity: (op) =>
        this.settings.getCapacity({
          ...op.scope,
          userId: op.actorUserId ?? undefined,
        }),
      activate: (op) => this.activate(op),
      remove: async (op) => {
        await op.manager
          .getRepository(LeadFlowClientSettingsEntity)
          .update(op.scope, {
            status: LeadFlowSettingsStatus.Archived,
            updatedById: op.actorUserId,
          });
      },
    });
  }
  private async activate(op: CompanyProductOperation) {
    const repo = op.manager.getRepository(LeadFlowClientSettingsEntity);
    const existing = await repo.findOne({ where: op.scope });
    if (existing) {
      if (existing.status === LeadFlowSettingsStatus.Archived) {
        await this.settings.assertCapacityAvailable(
          op.manager,
          op.scope.tenantId,
          op.scope.workspaceId,
        );
        existing.status = LeadFlowSettingsStatus.Draft;
        existing.updatedById = op.actorUserId;
        await repo.save(existing);
      }
      return existing.id;
    }
    const created = await this.settings.createSettings(
      {
        ...op.scope,
        userId: op.actorUserId ?? undefined,
        managedContext: {
          productKey: 'leadflow',
          operatingMode: 'client',
          clientId: op.scope.agencyClientId,
          companyContextId: op.scope.companyContextId,
          managedTenantId: null,
        },
      },
      op.scope.agencyClientId,
      {
        businessModeKey: 'agency_services',
        status: LeadFlowSettingsStatus.Draft,
      },
      op.manager,
    );
    return created.id;
  }
}
