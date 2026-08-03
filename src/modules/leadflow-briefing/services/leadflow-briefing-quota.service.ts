import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { LeadFlowBriefingSourceEntity, LeadFlowBriefingSourceVersionEntity } from '../entities';
import { LeadFlowBriefingSourceVersionStatus } from '../enums/leadflow-briefing-source-version-status.enum';

const AGENCY_CONNECTION = 'agency';

/**
 * Storage quota, derived from existing rows rather than tracked in a new
 * counter table (same "derive, don't duplicate" approach as F4-001's
 * provenance resolution). No quota/entitlement system existed anywhere in
 * the codebase before this — this is the minimal thing the task asks for
 * ("cotas ... por tenant/workspace/contexto"), scoped per Briefing settings.
 */
@Injectable()
export class LeadFlowBriefingQuotaService {
  constructor(
    @InjectDataSource(AGENCY_CONNECTION)
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  async assertWithinQuota(
    ctx: RequestContext,
    settingsId: string,
    incomingBytes: number,
  ): Promise<void> {
    if (!ctx.workspaceId) {
      throw new BadRequestException('Workspace context is required.');
    }

    const ceiling =
      this.configService.get<number>('leadflowBriefing.maxTotalBytesPerSettings') ??
      200 * 1024 * 1024;

    const raw = await this.dataSource
      .getRepository(LeadFlowBriefingSourceVersionEntity)
      .createQueryBuilder('v')
      .innerJoin(LeadFlowBriefingSourceEntity, 's', 's.id = v.sourceId')
      .select('COALESCE(SUM(v.byteSize), 0)', 'total')
      .where('v.tenantId = :tenantId', { tenantId: ctx.tenantId })
      .andWhere('v.workspaceId = :workspaceId', { workspaceId: ctx.workspaceId })
      .andWhere('s.settingsId = :settingsId', { settingsId })
      .andWhere('v.status = :status', { status: LeadFlowBriefingSourceVersionStatus.Available })
      .getRawOne<{ total: string }>();

    const currentBytes = Number(raw?.total ?? 0);
    if (currentBytes + incomingBytes > ceiling) {
      throw new BadRequestException(
        'This Briefing has reached its storage quota. Remove or archive older sources before adding more.',
      );
    }
  }
}
