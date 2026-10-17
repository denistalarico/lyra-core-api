import { SocialPlanEntity } from '../../social-planner/entities/social-plan.entity';
import { ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import {
  CompanyProductRegistry,
  type CompanyProductOperation,
} from '../../../common/company-products/company-product.registry';
import { SocialPublicationEntity } from './entities/social-publication.entity';
import { SocialContentItemEntity } from '../../social-planner/entities/social-content-item.entity';
import { SocialPublicationService } from './social-publication.service';

@Injectable()
export class SocialPublicationCompanyProductParticipant implements OnModuleInit {
  constructor(
    private readonly registry: CompanyProductRegistry,
    private readonly publications: SocialPublicationService,
  ) {}
  private rows(op: CompanyProductOperation) {
    return op.manager
      .getRepository(SocialPublicationEntity)
      .createQueryBuilder('p')
      .innerJoin(
        SocialContentItemEntity,
        'c',
        'c.id=p.content_item_id AND c.tenant_id=p.tenant_id AND c.workspace_id=p.workspace_id AND c.agency_client_id=p.agency_client_id',
      )
      .innerJoin(
        SocialPlanEntity,
        'plan',
        'plan.id=c.plan_id AND plan.tenant_id=c.tenant_id AND plan.workspace_id=c.workspace_id AND plan.agency_client_id=c.agency_client_id',
      )
      .where(
        'p.tenant_id=:tenantId AND p.workspace_id=:workspaceId AND p.agency_client_id=:agencyClientId AND plan.company_context_id=:companyContextId',
        op.scope,
      );
  }
  onModuleInit() {
    this.registry.register({
      key: 'social-publications',
      productKey: 'social',
      pending: async (op) => {
        const items = await this.rows(op)
          .andWhere('p.status IN (:...states)', {
            states: ['scheduled', 'queued', 'processing', 'failed'],
          })
          .getMany();
        return items.map((p) => ({
          id: p.id,
          kind: 'publication' as const,
          title: 'Publicação',
          status: p.status,
          scheduledAt: p.scheduledAt.toISOString(),
        }));
      },
      remove: async (op) => {
        // Lock rows before inspecting state: a worker cannot claim a scheduled row between read and cancellation.
        const items = await this.rows(op)
          .andWhere('p.status IN (:...states)', {
            states: ['scheduled', 'queued', 'processing'],
          })
          .setLock('pessimistic_write', undefined, ['p'])
          .getMany();
        if (items.some((p) => p.status === 'processing'))
          throw new ConflictException({
            code: 'company_product_publication_processing',
            message:
              'A publication is processing. Wait for completion before removing now.',
          });
        for (const p of items)
          await this.publications.cancel(
            op.scope,
            op.actorUserId,
            p.id,
            op.manager,
          );
      },
      retry: async (op, ids) => {
        const failures = ids.length
          ? await this.rows(op)
              .andWhere('p.id IN (:...ids) AND p.status=:status', {
                ids,
                status: 'failed',
              })
              .getMany()
          : [];
        const replacements: string[] = [];
        for (const p of failures)
          replacements.push(
            (
              await this.publications.retry(
                op.scope,
                op.actorUserId,
                p.id,
                op.manager,
              )
            ).id,
          );
        return replacements;
      },
    });
  }
}
