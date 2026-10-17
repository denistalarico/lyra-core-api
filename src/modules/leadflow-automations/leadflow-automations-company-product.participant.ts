import { Injectable, OnModuleInit } from '@nestjs/common';
import { CompanyProductRegistry } from '../../common/company-products/company-product.registry';
import { LeadFlowAutomationEntity } from './entities/leadflow-automation.entity';
import { LeadFlowAutomationStatus } from './enums/leadflow-automation-status.enum';

@Injectable()
export class LeadFlowAutomationsCompanyProductParticipant implements OnModuleInit {
  constructor(private readonly registry: CompanyProductRegistry) {}
  onModuleInit() {
    this.registry.register({
      key: 'leadflow-automations',
      productKey: 'leadflow',
      pending: async (op) => {
        const items = await op.manager
          .getRepository(LeadFlowAutomationEntity)
          .find({
            where: { ...op.scope, status: LeadFlowAutomationStatus.Active },
          });
        return items.map((a) => ({
          id: a.id,
          kind: 'automation' as const,
          title: a.name,
          status: a.status,
        }));
      },
      remove: async (op) => {
        await op.manager.getRepository(LeadFlowAutomationEntity).update(
          { ...op.scope, status: LeadFlowAutomationStatus.Active },
          {
            status: LeadFlowAutomationStatus.Paused,
            updatedById: op.actorUserId,
          },
        );
      },
    });
  }
}
