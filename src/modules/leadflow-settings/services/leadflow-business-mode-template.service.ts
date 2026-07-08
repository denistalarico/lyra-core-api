import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { LeadFlowBusinessModeTemplateEntity } from '../entities';
import { LeadFlowBusinessMode } from '../enums/leadflow-business-mode.enum';
import { LeadFlowSettingsStatus } from '../enums/leadflow-settings-status.enum';

@Injectable()
export class LeadFlowBusinessModeTemplateService {
  constructor(
    @InjectRepository(LeadFlowBusinessModeTemplateEntity, 'agency')
    private readonly templatesRepository: Repository<LeadFlowBusinessModeTemplateEntity>,
  ) {}

  listOfficialActive(): Promise<LeadFlowBusinessModeTemplateEntity[]> {
    return this.templatesRepository.find({
      where: {
        tenantId: IsNull(),
        isOfficial: true,
        status: LeadFlowSettingsStatus.Active,
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
