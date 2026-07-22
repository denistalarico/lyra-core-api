import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  FindOptionsWhere,
  In,
  LessThanOrEqual,
  Raw,
  Repository,
} from 'typeorm';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { CrmOpportunityEntity } from '../../crm/entities/crm-opportunity.entity';
import { CrmOpportunityEventEntity } from '../../crm/entities/crm-opportunity-event.entity';
import { CrmPipelineEntity } from '../../crm/entities/crm-pipeline.entity';
import { CrmStageEntity } from '../../crm/entities/crm-stage.entity';
import { InboxConversationEventEntity } from '../../inbox/entities/inbox-conversation-event.entity';
import type { GetCommercialJourneyAnalyticsDto } from '../dto/get-commercial-journey-analytics.dto';
import { projectCommercialJourney } from './commercial-journey-projector';

const MAX_COHORT_DAYS = 366;
const MAX_COHORT_OPPORTUNITIES = 10_000;

@Injectable()
export class LeadFlowAnalyticsService {
  constructor(
    @InjectRepository(CrmOpportunityEntity, 'agency')
    private readonly opportunities: Repository<CrmOpportunityEntity>,
    @InjectRepository(CrmOpportunityEventEntity, 'agency')
    private readonly opportunityEvents: Repository<CrmOpportunityEventEntity>,
    @InjectRepository(CrmPipelineEntity, 'agency')
    private readonly pipelines: Repository<CrmPipelineEntity>,
    @InjectRepository(CrmStageEntity, 'agency')
    private readonly stages: Repository<CrmStageEntity>,
    @InjectRepository(InboxConversationEventEntity, 'agency')
    private readonly conversationEvents: Repository<InboxConversationEventEntity>,
  ) {}

  async getCommercialJourney(
    ctx: RequestContext,
    query: GetCommercialJourneyAnalyticsDto,
  ) {
    const tenantId = this.requireTenantId(ctx);
    const workspaceId = this.requireWorkspaceId(ctx);
    const { from, to } = this.resolvePeriod(query);
    const cohort = await this.opportunities.find({
      where: this.withClientScope<CrmOpportunityEntity>(ctx, {
        tenantId,
        workspaceId,
        createdAt: Between(from, to),
      }),
      withDeleted: true,
      order: { createdAt: 'ASC', id: 'ASC' },
      take: MAX_COHORT_OPPORTUNITIES + 1,
    });
    if (cohort.length > MAX_COHORT_OPPORTUNITIES) {
      throw new BadRequestException(
        `The selected cohort exceeds ${MAX_COHORT_OPPORTUNITIES} opportunities. Reduce the period.`,
      );
    }
    if (cohort.length === 0) {
      return projectCommercialJourney({
        from,
        to,
        opportunities: [],
        opportunityEvents: [],
        conversationEvents: [],
        pipelineNames: new Map(),
        stageNames: new Map(),
      });
    }

    const opportunityIds = cohort.map((opportunity) => opportunity.id);
    const conversationIds = cohort
      .map((opportunity) => opportunity.inboxConversationId)
      .filter((id): id is string => Boolean(id));
    const [events, inboxEvents, pipelineDefinitions, stageDefinitions] =
      await Promise.all([
        this.opportunityEvents.find({
          where: {
            tenantId,
            workspaceId,
            opportunityId: In(opportunityIds),
            createdAt: LessThanOrEqual(to),
          },
          order: { createdAt: 'ASC', id: 'ASC' },
        }),
        conversationIds.length
          ? this.conversationEvents.find({
              where: {
                tenantId,
                workspaceId,
                conversationId: In(conversationIds),
                createdAt: Between(from, to),
              },
              order: { createdAt: 'ASC', id: 'ASC' },
            })
          : Promise.resolve([]),
        this.pipelines.find({
          where: this.withClientScope<CrmPipelineEntity>(ctx, {
            tenantId,
            workspaceId,
          }),
          withDeleted: true,
        }),
        this.stages.find({
          where: this.withClientScope<CrmStageEntity>(ctx, {
            tenantId,
            workspaceId,
          }),
          withDeleted: true,
        }),
      ]);

    return projectCommercialJourney({
      from,
      to,
      opportunities: cohort,
      opportunityEvents: events,
      conversationEvents: inboxEvents,
      pipelineNames: new Map(
        pipelineDefinitions.map((pipeline) => [pipeline.id, pipeline.name]),
      ),
      stageNames: new Map(
        stageDefinitions.map((stage) => [
          stage.id,
          { name: stage.name, pipelineId: stage.pipelineId },
        ]),
      ),
    });
  }

  private resolvePeriod(query: GetCommercialJourneyAnalyticsDto) {
    const now = new Date();
    const to = query.to ? new Date(query.to) : now;
    const from = query.from
      ? new Date(query.from)
      : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    if (
      Number.isNaN(from.getTime()) ||
      Number.isNaN(to.getTime()) ||
      from.getTime() > to.getTime()
    ) {
      throw new BadRequestException('The analytics period is invalid.');
    }
    if (to.getTime() > now.getTime() + 5 * 60 * 1000) {
      throw new BadRequestException(
        'The analytics period cannot end in the future.',
      );
    }
    const durationDays = (to.getTime() - from.getTime()) / 86_400_000;
    if (durationDays > MAX_COHORT_DAYS) {
      throw new BadRequestException(
        `The analytics period cannot exceed ${MAX_COHORT_DAYS} days.`,
      );
    }
    return { from, to };
  }

  private withClientScope<T>(
    ctx: RequestContext,
    where: FindOptionsWhere<T>,
  ): FindOptionsWhere<T> {
    const scoped = { ...where } as Record<string, unknown>;
    if (ctx.managedContext?.operatingMode === 'client') {
      scoped.metadata = Raw(
        (column) => `${column} ->> 'clientId' = :analyticsClientId`,
        { analyticsClientId: ctx.managedContext.clientId },
      );
    } else {
      scoped.metadata = Raw(
        (column) =>
          `(${column} ->> 'clientId' IS NULL OR ${column} ->> 'operatingMode' = 'agency')`,
      );
    }
    return scoped as FindOptionsWhere<T>;
  }

  private requireTenantId(ctx: RequestContext) {
    if (!ctx.tenantId)
      throw new BadRequestException('Tenant context is required.');
    return ctx.tenantId;
  }

  private requireWorkspaceId(ctx: RequestContext) {
    if (!ctx.workspaceId)
      throw new BadRequestException('Workspace context is required.');
    return ctx.workspaceId;
  }
}
