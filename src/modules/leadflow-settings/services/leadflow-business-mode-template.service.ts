import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { LeadFlowBusinessModeTemplateEntity } from '../entities';
import { LeadFlowBusinessMode } from '../enums/leadflow-business-mode.enum';
import { LeadFlowSettingsStatus } from '../enums/leadflow-settings-status.enum';

@Injectable()
export class LeadFlowBusinessModeTemplateService {
  constructor(
    @InjectRepository(LeadFlowBusinessModeTemplateEntity, 'agency')
    private readonly templatesRepository: Repository<LeadFlowBusinessModeTemplateEntity>,
  ) {}

  listTemplates(
    ctx: RequestContext,
  ): Promise<LeadFlowBusinessModeTemplateEntity[]> {
    return this.templatesRepository.find({
      where: [
        {
          tenantId: ctx.tenantId,
          status: LeadFlowSettingsStatus.Active,
          deletedAt: IsNull(),
        },
        {
          tenantId: IsNull(),
          status: LeadFlowSettingsStatus.Active,
          deletedAt: IsNull(),
        },
      ],
      order: { category: 'ASC', name: 'ASC', version: 'DESC' },
    });
  }

  async getTemplateByKey(
    ctx: RequestContext,
    key: string,
  ): Promise<LeadFlowBusinessModeTemplateEntity> {
    const customTemplate = await this.templatesRepository.findOne({
      where: {
        tenantId: ctx.tenantId,
        key: key as LeadFlowBusinessMode,
        status: LeadFlowSettingsStatus.Active,
        deletedAt: IsNull(),
      },
      order: { version: 'DESC' },
    });

    if (customTemplate) {
      return customTemplate;
    }

    const officialTemplate = await this.templatesRepository.findOne({
      where: {
        tenantId: IsNull(),
        key: key as LeadFlowBusinessMode,
        status: LeadFlowSettingsStatus.Active,
        deletedAt: IsNull(),
      },
      order: { version: 'DESC' },
    });

    if (!officialTemplate) {
      throw new NotFoundException(`LeadFlow business mode '${key}' not found.`);
    }

    return officialTemplate;
  }

  listOfficialActive(): Promise<LeadFlowBusinessModeTemplateEntity[]> {
    return this.templatesRepository.find({
      where: {
        tenantId: IsNull(),
        isOfficial: true,
        status: LeadFlowSettingsStatus.Active,
        deletedAt: IsNull(),
      },
      order: { category: 'ASC', name: 'ASC', version: 'DESC' },
    });
  }

  findOfficialByKey(
    key: LeadFlowBusinessMode,
    version = 1,
  ): Promise<LeadFlowBusinessModeTemplateEntity | null> {
    return this.templatesRepository.findOne({
      where: {
        tenantId: IsNull(),
        key,
        version,
        isOfficial: true,
      },
    });
  }

  countOfficialVersion(version = 1): Promise<number> {
    return this.templatesRepository.count({
      where: {
        tenantId: IsNull(),
        version,
        isOfficial: true,
      },
    });
  }
}
