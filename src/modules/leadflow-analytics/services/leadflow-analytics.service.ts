import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  FindOptionsWhere,
  In,
  IsNull,
  LessThanOrEqual,
  Repository,
} from 'typeorm';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { resolveCompanyAwareScope } from '../../../common/context/company-aware-scope';
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
    // CC2G.1: fails closed in client mode without a Company Context — the same
    // guarantee every other migrated CC2E/CC2F boundary gives. What this phase
    // removes is the fallback that used to run *after* a company was selected:
    // `withClientScope` filtered by `metadata->>'clientId'`, which aggregates
    // every company of the client into one cohort. `withCompanyScope` below
    // reads the persisted `agency_client_id`/`company_context_id` columns
    // CC2F added to `crm_opportunities`/`crm_pipelines` instead.
    const { from, to } = this.resolvePeriod(query);
    const cohort = await this.opportunities.find({
      where: this.withCompanyScope<CrmOpportunityEntity>(ctx, {
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
    const [events, inboxEvents, pipelineDefinitions] = await Promise.all([
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
        where: this.withCompanyScope<CrmPipelineEntity>(ctx, {
          tenantId,
          workspaceId,
        }),
        withDeleted: true,
      }),
    ]);

    // `crm_stages` carries no company column of its own — CC2F's design has
    // stages inherit scope from their pipeline (see CC2F doc §Serviços: "Stages
    // são lidos através do Pipeline company-scoped"). Reading the pipeline set
    // first and then asking only for *those* pipelines' stages is what makes
    // that inheritance real here rather than an unenforced convention: a stage
    // whose `pipeline_id` belongs to another company's pipeline (not in
    // `pipelineDefinitions`) is never fetched, so it cannot be named in the
    // response even if a cohort opportunity pointed at it.
    const pipelineIds = pipelineDefinitions.map((pipeline) => pipeline.id);
    const stageDefinitions = pipelineIds.length
      ? await this.stages.find({
          where: {
            tenantId,
            workspaceId,
            pipelineId: In(pipelineIds),
          },
          withDeleted: true,
        })
      : [];

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

  /**
   * CC2G.1 — the same shape `CrmService.withCompanyScope` uses: persisted
   * `agency_client_id`/`company_context_id` columns, `IS NOT DISTINCT FROM`
   * matched with `IsNull()` in agency mode so a missing predicate can never
   * read as "every company". `resolveCompanyAwareScope` still throws before
   * this runs if client mode carries no company, so the `IsNull()` branch is
   * only ever reached in genuine agency mode.
   */
  private withCompanyScope<T>(
    ctx: RequestContext,
    where: FindOptionsWhere<T>,
  ): FindOptionsWhere<T> {
    const scope = resolveCompanyAwareScope(ctx);
    return {
      ...where,
      agencyClientId: scope.agencyClientId ?? IsNull(),
      companyContextId: scope.companyContextId ?? IsNull(),
    } as FindOptionsWhere<T>;
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
