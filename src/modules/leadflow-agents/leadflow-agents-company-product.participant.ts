import { Injectable, OnModuleInit } from '@nestjs/common';
import { In } from 'typeorm';
import { CompanyProductRegistry } from '../../common/company-products/company-product.registry';
import { LeadFlowAgentEntity } from './entities/leadflow-agent.entity';
import { LeadFlowAgentChannelBindingEntity } from './entities/leadflow-agent-channel-binding.entity';
import { LeadFlowAgentStatus } from './enums/leadflow-agent-status.enum';
import { LeadFlowAgentChannelStatus } from './enums/leadflow-agent-channel-status.enum';

@Injectable()
export class LeadFlowAgentsCompanyProductParticipant implements OnModuleInit {
  constructor(private readonly registry: CompanyProductRegistry) {}
  onModuleInit() {
    this.registry.register({
      key: 'leadflow-agents',
      productKey: 'leadflow',
      pending: async (op) => {
        const agents = await op.manager
          .getRepository(LeadFlowAgentEntity)
          .find({ where: { ...op.scope, status: LeadFlowAgentStatus.Active } });
        return agents.map((a) => ({
          id: a.id,
          kind: 'agent' as const,
          title: a.name,
          status: a.status,
        }));
      },
      remove: async (op) => {
        const repo = op.manager.getRepository(LeadFlowAgentEntity);
        const agents = await repo.find({ where: op.scope });
        if (agents.length) {
          await op.manager
            .getRepository(LeadFlowAgentChannelBindingEntity)
            .update(
              {
                tenantId: op.scope.tenantId,
                workspaceId: op.scope.workspaceId,
                agentId: In(agents.map((a) => a.id)),
                status: LeadFlowAgentChannelStatus.Active,
              },
              { status: LeadFlowAgentChannelStatus.Disabled },
            );
          await repo.update(
            { ...op.scope, status: LeadFlowAgentStatus.Active },
            { status: LeadFlowAgentStatus.Paused, updatedById: op.actorUserId },
          );
        }
      },
    });
  }
}
