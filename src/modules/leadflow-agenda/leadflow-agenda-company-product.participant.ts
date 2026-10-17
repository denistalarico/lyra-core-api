import { Injectable, OnModuleInit } from '@nestjs/common';
import { MoreThan, In } from 'typeorm';
import { CompanyProductRegistry } from '../../common/company-products/company-product.registry';
import { ScheduledItemEntity } from '../appointments/entities/scheduled-item.entity';

@Injectable()
export class LeadFlowAgendaCompanyProductParticipant implements OnModuleInit {
  constructor(private readonly registry: CompanyProductRegistry) {}
  onModuleInit() {
    this.registry.register({
      key: 'leadflow-agenda',
      productKey: 'leadflow',
      pending: async (op) => {
        const items = await op.manager.getRepository(ScheduledItemEntity).find({
          where: {
            ...op.scope,
            startAt: MoreThan(new Date()),
            status: In(['scheduled', 'confirmed', 'pending']),
          },
        });
        return items.map((a) => ({
          id: a.id,
          kind: 'appointment' as const,
          title: a.title,
          status: a.status,
          scheduledAt: a.startAt?.toISOString(),
        }));
      },
    });
  }
}
