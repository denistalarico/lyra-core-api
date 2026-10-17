import { Injectable, OnModuleInit } from '@nestjs/common';
import { In } from 'typeorm';
import { CompanyProductRegistry } from '../../common/company-products/company-product.registry';
import { SocialApprovalRequestEntity } from './entities/social-approval-request.entity';
import { SocialApprovalsService } from './social-approvals.service';

@Injectable()
export class SocialApprovalsCompanyProductParticipant implements OnModuleInit {
  constructor(
    private readonly registry: CompanyProductRegistry,
    private readonly approvals: SocialApprovalsService,
  ) {}
  onModuleInit() {
    const open = [
      'draft',
      'awaiting_internal_review',
      'awaiting_client',
      'changes_requested',
    ];
    this.registry.register({
      key: 'social-approvals',
      productKey: 'social',
      pending: async (op) => {
        const items = await op.manager
          .getRepository(SocialApprovalRequestEntity)
          .find({ where: { ...op.scope, status: In(open) } });
        return items.map((a) => ({
          id: a.id,
          kind: 'approval' as const,
          title: a.title,
          status: a.status,
        }));
      },
      remove: async (op) => {
        const items = await op.manager
          .getRepository(SocialApprovalRequestEntity)
          .find({ where: { ...op.scope, status: In(open) } });
        for (const item of items)
          await this.approvals.cancel(op.scope, item.id, op.actorUserId, {
            manager: op.manager,
            afterCommit: op.afterCommit,
          });
      },
    });
  }
}
