import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { LEADFLOW_BUSINESS_MODE_TEMPLATES } from '../catalog/business-mode-templates.catalog';
import { LeadFlowBusinessModeTemplateEntity } from '../entities';

export type LeadFlowBusinessModeSeedSummary = {
  created: number;
  updated: number;
  officialVersionOneCount: number;
};

@Injectable()
export class LeadFlowBusinessModeTemplateSeederService implements OnApplicationBootstrap {
  private readonly logger = new Logger(
    LeadFlowBusinessModeTemplateSeederService.name,
  );

  constructor(
    @InjectRepository(LeadFlowBusinessModeTemplateEntity, 'agency')
    private readonly templatesRepository: Repository<LeadFlowBusinessModeTemplateEntity>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.LEADFLOW_BUSINESS_MODES_SEED_ON_BOOT === 'false') {
      return;
    }

    try {
      const summary = await this.seedOfficialTemplates();
      this.logger.log(
        `LeadFlow business modes synced (+${summary.created}/~${summary.updated}; official v1=${summary.officialVersionOneCount}).`,
      );
    } catch (error) {
      // Boot may run before the migration in fresh environments.
      this.logger.warn(
        `LeadFlow business mode seed skipped: ${(error as Error).message}`,
      );
    }
  }

  async seedOfficialTemplates(): Promise<LeadFlowBusinessModeSeedSummary> {
    let created = 0;
    let updated = 0;

    for (const item of LEADFLOW_BUSINESS_MODE_TEMPLATES) {
      const existing = await this.templatesRepository.findOne({
        where: {
          tenantId: IsNull(),
          key: item.key,
          version: item.version,
        },
      });

      if (!existing) {
        await this.templatesRepository.save(
          this.templatesRepository.create({
            ...item,
            tenantId: null,
            parentTemplateId: null,
          }),
        );
        created += 1;
        continue;
      }

      this.templatesRepository.merge(existing, {
        ...item,
        tenantId: null,
        parentTemplateId: existing.parentTemplateId,
      });
      await this.templatesRepository.save(existing);
      updated += 1;
    }

    const officialVersionOneCount = await this.templatesRepository.count({
      where: {
        tenantId: IsNull(),
        version: 1,
        isOfficial: true,
      },
    });

    return { created, updated, officialVersionOneCount };
  }
}
