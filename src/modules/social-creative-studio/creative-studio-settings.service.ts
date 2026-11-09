import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import type { CreativeStudioScope } from './creative-studio.scope';
import { CreativeStudioSettingsEntity } from './entities';

export const DEFAULT_PLANNER_UPLOAD_RETENTION_DAYS = 30;

@Injectable()
export class CreativeStudioSettingsService {
  constructor(
    @InjectRepository(CreativeStudioSettingsEntity, 'agency')
    private readonly settings: Repository<CreativeStudioSettingsEntity>,
  ) {}
  private find(scope: CreativeStudioScope) {
    return this.settings.findOne({
      where: {
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId:
          scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
        companyContextId:
          scope.companyContextId === null ? IsNull() : scope.companyContextId,
      },
    });
  }
  async retention(scope: CreativeStudioScope) {
    const row = await this.find(scope);
    return {
      plannerUploadRetentionDays:
        row?.plannerUploadRetentionDays ??
        DEFAULT_PLANNER_UPLOAD_RETENTION_DAYS,
    };
  }
  async updateRetention(
    scope: CreativeStudioScope,
    actor: string | null,
    plannerUploadRetentionDays: number,
  ) {
    const row =
      (await this.find(scope)) ??
      this.settings.create({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId,
        companyContextId: scope.companyContextId,
      });
    row.plannerUploadRetentionDays = plannerUploadRetentionDays;
    row.updatedById = actor;
    await this.settings.save(row);
    return { plannerUploadRetentionDays };
  }
}
