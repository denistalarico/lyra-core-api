import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import type {
  CompleteAgencySalesActivityDto,
  CreateAgencySalesActivityDto,
  UpdateAgencySalesActivityDto,
  CreateAgencySalesItemDto,
  CreateAgencySalesOpportunityDto,
  CreateAgencySalesOpportunityItemDto,
  UpdateAgencySalesOpportunityItemDto,
  CreateAgencySalesPipelineDto,
  CreateAgencySalesQuickOpportunityDto,
  CreateAgencySalesStageDto,
  LoseAgencySalesOpportunityDto,
  MoveAgencySalesOpportunityDto,
  ReorderAgencySalesStagesDto,
  ReopenAgencySalesOpportunityDto,
  UpdateAgencySalesItemDto,
  UpdateAgencySalesProductSettingsDto,
  UpdateAgencySalesStageDto,
  WinAgencySalesOpportunityDto,
  UpdateAgencySalesOpportunityDto,
  UpdateAgencySalesPipelineDto,
} from './dto/agency-sales.dto';
import {
  AgencySalesActivityEntity,
  AgencySalesItemEntity,
  AgencySalesOpportunityEntity,
  AgencySalesOpportunityItemEntity,
  AgencySalesPipelineEntity,
  AgencySalesStageEntity,
} from './entities/agency-sales.entities';
import { QuoteEntity } from '../quotes/entities/quote.entities';

const AGENCY_CONNECTION = 'agency';

type AgencyContext = {
  tenantId: string;
  workspaceId: string;
  userId?: string;
};

const defaultProductSettings = {
  categories: [],
  markers: [],
  opportunityMarkers: [],
  opportunitySources: [
    'Meta Ads',
    'Google Ads',
    'Indicação',
    'Formulário',
    'Outbound',
    'Facebook',
    'Instagram',
    'LinkedIn',
  ],
  lossReasons: [
    { id: 'price', name: 'Preço' },
    { id: 'timing', name: 'Timing' },
    { id: 'competitor', name: 'Concorrente' },
  ],
  units: [
    { id: 'unit-quantity', name: 'Quantidade', abbreviation: 'qtde' },
    { id: 'unit-unit', name: 'Unidade', abbreviation: 'un' },
    { id: 'unit-hours', name: 'Horas', abbreviation: 'hrs' },
  ],
};

@Injectable()
export class AgencySalesService {
  constructor(
    @InjectRepository(AgencySalesActivityEntity, AGENCY_CONNECTION)
    private readonly activitiesRepo: Repository<AgencySalesActivityEntity>,
    @InjectRepository(AgencySalesItemEntity, AGENCY_CONNECTION)
    private readonly itemsRepo: Repository<AgencySalesItemEntity>,
    @InjectRepository(AgencySalesPipelineEntity, AGENCY_CONNECTION)
    private readonly pipelinesRepo: Repository<AgencySalesPipelineEntity>,
    @InjectRepository(AgencySalesStageEntity, AGENCY_CONNECTION)
    private readonly stagesRepo: Repository<AgencySalesStageEntity>,
    @InjectRepository(AgencySalesOpportunityEntity, AGENCY_CONNECTION)
    private readonly opportunitiesRepo: Repository<AgencySalesOpportunityEntity>,
    @InjectRepository(AgencySalesOpportunityItemEntity, AGENCY_CONNECTION)
    private readonly opportunityItemsRepo: Repository<AgencySalesOpportunityItemEntity>,
    @InjectRepository(QuoteEntity, AGENCY_CONNECTION)
    private readonly quotesRepo: Repository<QuoteEntity>,
  ) {}

  health() {
    return {
      app: 'agency-sales',
      status: 'ok',
      strategy: 'backend-first',
    };
  }

  async getOverview(context: AgencyContext) {
    const [items, pipelines, opportunities, quotes] = await Promise.all([
      this.itemsRepo.count({
        where: { tenantId: context.tenantId, workspaceId: context.workspaceId },
      }),
      this.pipelinesRepo.count({
        where: { tenantId: context.tenantId, workspaceId: context.workspaceId },
      }),
      this.opportunitiesRepo.count({
        where: { tenantId: context.tenantId, workspaceId: context.workspaceId },
      }),
      this.quotesRepo.count({
        where: { tenantId: context.tenantId, workspaceId: context.workspaceId },
      }),
    ]);

    return {
      items,
      pipelines,
      opportunities,
      quotes,
    };
  }

  async getDefaults(context: AgencyContext) {
    const pipeline = await this.getDefaultPipeline(context);

    if (!pipeline) {
      return {
        pipeline: null,
        stage: null,
      };
    }

    const stage = await this.getDefaultStage(context, pipeline.id);

    return {
      pipeline,
      stage,
    };
  }

  async createQuickOpportunity(
    context: AgencyContext,
    dto: CreateAgencySalesQuickOpportunityDto,
  ) {
    const pipeline = dto.pipelineId
      ? await this.pipelinesRepo.findOne({
          where: {
            id: dto.pipelineId,
            tenantId: context.tenantId,
            workspaceId: context.workspaceId,
          },
        })
      : await this.getDefaultPipeline(context);

    if (!pipeline) {
      throw new BadRequestException(
        'No active sales pipeline found for this workspace.',
      );
    }

    const stage = dto.stageId
      ? await this.stagesRepo.findOne({
          where: {
            id: dto.stageId,
            tenantId: context.tenantId,
            workspaceId: context.workspaceId,
            pipelineId: pipeline.id,
          },
        })
      : await this.getDefaultStage(context, pipeline.id);

    if (!stage) {
      throw new BadRequestException(
        'No open sales stage found for the selected pipeline.',
      );
    }

    return this.createOpportunity(context, {
      title: dto.title,
      description: dto.description,
      pipelineId: pipeline.id,
      stageId: stage.id,
      contactId: dto.contactId,
      companyContactId: dto.companyContactId,
      ownerUserId: dto.ownerUserId,
      amountCents: dto.amountCents,
      recurringAmountCents: dto.recurringAmountCents,
      currency: dto.currency,
      status: 'open',
      expectedCloseDate: dto.expectedCloseDate,
      lostReason: dto.lostReason,
      metadata: dto.metadata,
    });
  }

  private async getDefaultPipeline(context: AgencyContext) {
    const defaultPipeline = await this.pipelinesRepo.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        isDefault: true,
        status: 'active',
      },
      order: { position: 'ASC', createdAt: 'ASC' },
    });

    if (defaultPipeline) {
      return defaultPipeline;
    }

    return this.pipelinesRepo.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        status: 'active',
      },
      order: { position: 'ASC', createdAt: 'ASC' },
    });
  }

  private async getDefaultStage(context: AgencyContext, pipelineId: string) {
    return this.stagesRepo.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        pipelineId,
        isClosed: false,
      },
      order: { position: 'ASC', createdAt: 'ASC' },
    });
  }

  async createItem(context: AgencyContext, dto: CreateAgencySalesItemDto) {
    const item = this.itemsRepo.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      name: dto.name,
      description: dto.description ?? null,
      type: dto.type ?? 'service',
      category: dto.category ?? null,
      billingType: dto.billingType ?? 'one_time',
      currency: dto.currency ?? 'BRL',
      unitPriceCents: dto.unitPriceCents ?? 0,
      setupPriceCents: dto.setupPriceCents ?? 0,
      recurringPriceCents: dto.recurringPriceCents ?? 0,
      recurrenceInterval: dto.recurrenceInterval ?? null,
      status: dto.status ?? 'active',
      metadata: dto.metadata ?? {},
    });

    return this.itemsRepo.save(item);
  }

  async listItems(context: AgencyContext, search?: string) {
    return this.itemsRepo.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        ...(search ? { name: ILike(`%${search}%`) } : {}),
      },
      order: { createdAt: 'DESC' },
    });
  }

  async updateItem(
    context: AgencyContext,
    id: string,
    dto: UpdateAgencySalesItemDto,
  ) {
    const item = await this.itemsRepo.findOne({
      where: {
        id,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (!item) {
      throw new BadRequestException('Sales item not found.');
    }

    Object.assign(item, {
      ...dto,
      description: dto.description ?? item.description,
      category: dto.category ?? item.category,
      recurrenceInterval: dto.recurrenceInterval ?? item.recurrenceInterval,
      metadata: dto.metadata
        ? { ...(item.metadata ?? {}), ...dto.metadata }
        : item.metadata,
    });

    return this.itemsRepo.save(item);
  }

  async getProductSettings(context: AgencyContext) {
    const pipeline = await this.ensureSettingsPipeline(context);
    const productSettings = pipeline.metadata?.productSettings;

    if (
      productSettings &&
      typeof productSettings === 'object' &&
      !Array.isArray(productSettings)
    ) {
      return {
        ...defaultProductSettings,
        ...(productSettings as Record<string, unknown>),
      };
    }

    return defaultProductSettings;
  }

  async updateProductSettings(
    context: AgencyContext,
    dto: UpdateAgencySalesProductSettingsDto,
  ) {
    const pipeline = await this.ensureSettingsPipeline(context);

    pipeline.metadata = {
      ...(pipeline.metadata ?? {}),
      productSettings: {
        categories: dto.categories,
        markers: dto.markers,
        opportunityMarkers:
          dto.opportunityMarkers ?? defaultProductSettings.opportunityMarkers,
        units: dto.units ?? defaultProductSettings.units,
        opportunitySources:
          dto.opportunitySources ?? defaultProductSettings.opportunitySources,
        lossReasons: dto.lossReasons ?? defaultProductSettings.lossReasons,
      },
    };

    await this.pipelinesRepo.save(pipeline);

    return this.getProductSettings(context);
  }

  private async ensureSettingsPipeline(context: AgencyContext) {
    const pipeline = await this.getDefaultPipeline(context);

    if (pipeline) {
      return pipeline;
    }

    return this.pipelinesRepo.save(
      this.pipelinesRepo.create({
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        name: 'Pipeline Comercial',
        status: 'active',
        isDefault: true,
        position: 0,
        metadata: {},
      }),
    );
  }

  async createPipeline(
    context: AgencyContext,
    dto: CreateAgencySalesPipelineDto,
  ) {
    const pipeline = await this.pipelinesRepo.save(
      this.pipelinesRepo.create({
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        name: dto.name,
        status: dto.status ?? 'active',
        isDefault: dto.isDefault ?? false,
        position: dto.position ?? 0,
        metadata: dto.metadata ?? {},
      }),
    );

    return pipeline;
  }

  async updatePipeline(
    context: AgencyContext,
    pipelineId: string,
    dto: UpdateAgencySalesPipelineDto,
  ) {
    const pipeline = await this.pipelinesRepo.findOne({
      where: {
        id: pipelineId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (!pipeline) {
      throw new BadRequestException('Pipeline not found.');
    }

    await this.pipelinesRepo.update(pipeline.id, {
      name: dto.name ?? pipeline.name,
      status: dto.status ?? pipeline.status,
      isDefault: dto.isDefault ?? pipeline.isDefault,
      position: dto.position ?? pipeline.position,
      metadata: dto.metadata
        ? ({ ...(pipeline.metadata ?? {}), ...dto.metadata } as any)
        : pipeline.metadata,
    });

    return this.pipelinesRepo.findOne({
      where: {
        id: pipeline.id,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });
  }

  async deletePipeline(context: AgencyContext, pipelineId: string) {
    const opportunityCount = await this.opportunitiesRepo.count({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        pipelineId,
      },
    });

    if (opportunityCount > 0) {
      throw new BadRequestException(
        'Cannot delete a pipeline with opportunities. Archive it instead.',
      );
    }

    await this.stagesRepo.delete({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      pipelineId,
    });
    await this.pipelinesRepo.delete({
      id: pipelineId,
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
    });

    return { deleted: true };
  }

  async listPipelines(context: AgencyContext) {
    const pipelines = await this.pipelinesRepo.find({
      where: { tenantId: context.tenantId, workspaceId: context.workspaceId },
      order: { position: 'ASC', createdAt: 'ASC' },
    });

    const stages = await this.stagesRepo.find({
      where: { tenantId: context.tenantId, workspaceId: context.workspaceId },
      order: { position: 'ASC', createdAt: 'ASC' },
    });

    return pipelines.map((pipeline) => ({
      ...pipeline,
      stages: stages.filter((stage) => stage.pipelineId === pipeline.id),
    }));
  }

  async createStage(context: AgencyContext, dto: CreateAgencySalesStageDto) {
    return this.stagesRepo.save(
      this.stagesRepo.create({
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        pipelineId: dto.pipelineId,
        name: dto.name,
        type: dto.type ?? 'new',
        position: dto.position ?? 0,
        probability: dto.probability ?? 0,
        isClosed: dto.isClosed ?? false,
        isWon: dto.isWon ?? false,
        metadata: dto.metadata ?? {},
      }),
    );
  }

  async updateStage(
    context: AgencyContext,
    stageId: string,
    dto: UpdateAgencySalesStageDto,
  ) {
    const stage = await this.stagesRepo.findOne({
      where: {
        id: stageId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (!stage) {
      throw new BadRequestException('Stage not found.');
    }

    const metadata = dto.metadata
      ? { ...(stage.metadata ?? {}), ...dto.metadata }
      : stage.metadata;

    await this.stagesRepo.update(stage.id, {
      name: dto.name ?? stage.name,
      type: dto.type ?? stage.type,
      position: dto.position ?? stage.position,
      probability: dto.probability ?? stage.probability,
      isClosed: dto.isClosed ?? stage.isClosed,
      isWon: dto.isWon ?? stage.isWon,
      metadata: metadata as never,
    });

    return this.stagesRepo.findOne({
      where: {
        id: stage.id,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });
  }

  async reorderStages(
    context: AgencyContext,
    dto: ReorderAgencySalesStagesDto,
  ) {
    const stages = await this.stagesRepo.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });
    const stagesById = new Map(stages.map((stage) => [stage.id, stage]));
    const orderedStages = dto.stageIds.map((stageId) =>
      stagesById.get(stageId),
    );

    if (orderedStages.some((stage) => !stage)) {
      throw new BadRequestException('Invalid stage order.');
    }

    const pipelineIds = new Set(
      orderedStages.map((stage) => stage?.pipelineId),
    );

    if (pipelineIds.size !== 1) {
      throw new BadRequestException('Stage order must belong to one pipeline.');
    }

    await Promise.all(
      dto.stageIds.map((stageId, index) =>
        this.stagesRepo.update(
          {
            id: stageId,
            tenantId: context.tenantId,
            workspaceId: context.workspaceId,
          },
          { position: index },
        ),
      ),
    );

    return this.stagesRepo.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        pipelineId: orderedStages[0]?.pipelineId,
      },
      order: { position: 'ASC', createdAt: 'ASC' },
    });
  }

  async createOpportunity(
    context: AgencyContext,
    dto: CreateAgencySalesOpportunityDto,
  ) {
    return this.opportunitiesRepo.save(
      this.opportunitiesRepo.create({
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        title: dto.title,
        description: dto.description ?? null,
        pipelineId: dto.pipelineId,
        stageId: dto.stageId,
        contactId: dto.contactId ?? null,
        companyContactId: dto.companyContactId ?? null,
        ownerUserId: dto.ownerUserId ?? context.userId ?? null,
        amountCents: dto.amountCents ?? 0,
        recurringAmountCents: dto.recurringAmountCents ?? 0,
        currency: dto.currency ?? 'BRL',
        status: dto.status ?? 'open',
        expectedCloseDate: dto.expectedCloseDate ?? null,
        lostReason: dto.lostReason ?? null,
        metadata: dto.metadata ?? {},
      }),
    );
  }

  async winOpportunity(
    context: AgencyContext,
    opportunityId: string,
    dto: WinAgencySalesOpportunityDto,
  ) {
    const opportunity = await this.ensureOpportunity(context, opportunityId);
    const targetStage = await this.getStageByTypeOrFallback(
      context,
      opportunity.pipelineId,
      'won',
    );

    if (!targetStage) {
      throw new BadRequestException('Won stage not found.');
    }

    const closedAt = dto.closedAt ? new Date(dto.closedAt) : new Date();

    await this.opportunitiesRepo.update(
      {
        id: opportunity.id,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
      {
        pipelineId: targetStage.pipelineId,
        stageId: targetStage.id,
        status: 'won',
        closedAt,
        lostReason: null,
        metadata: {
          ...(opportunity.metadata ?? {}),
          outcome: dto.outcome ?? undefined,
          closedByUserId: context.userId ?? undefined,
          closedAs: 'won',
        },
      },
    );

    return this.getOpportunityDetail(context, opportunity.id);
  }

  async loseOpportunity(
    context: AgencyContext,
    opportunityId: string,
    dto: LoseAgencySalesOpportunityDto,
  ) {
    const opportunity = await this.ensureOpportunity(context, opportunityId);
    const targetStage = await this.getStageByTypeOrFallback(
      context,
      opportunity.pipelineId,
      'lost',
    );

    if (!targetStage) {
      throw new BadRequestException('Lost stage not found.');
    }

    const closedAt = dto.closedAt ? new Date(dto.closedAt) : new Date();

    await this.opportunitiesRepo.update(
      {
        id: opportunity.id,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
      {
        pipelineId: targetStage.pipelineId,
        stageId: targetStage.id,
        status: 'lost',
        closedAt,
        lostReason: dto.lostReason ?? 'Não informado',
        metadata: {
          ...(opportunity.metadata ?? {}),
          outcome: dto.outcome ?? undefined,
          closedByUserId: context.userId ?? undefined,
          closedAs: 'lost',
        },
      },
    );

    return this.getOpportunityDetail(context, opportunity.id);
  }

  async reopenOpportunity(
    context: AgencyContext,
    opportunityId: string,
    dto: ReopenAgencySalesOpportunityDto,
  ) {
    const opportunity = await this.ensureOpportunity(context, opportunityId);

    const targetStage = dto.stageId
      ? await this.stagesRepo.findOne({
          where: {
            id: dto.stageId,
            tenantId: context.tenantId,
            workspaceId: context.workspaceId,
          },
        })
      : await this.getDefaultStage(
          context,
          dto.pipelineId ?? opportunity.pipelineId,
        );

    if (!targetStage) {
      throw new BadRequestException('Open stage not found.');
    }

    if (targetStage.isClosed) {
      throw new BadRequestException('Cannot reopen into a closed stage.');
    }

    const targetPipeline = await this.pipelinesRepo.findOne({
      where: {
        id: dto.pipelineId ?? targetStage.pipelineId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (!targetPipeline) {
      throw new BadRequestException('Target pipeline not found.');
    }

    if (targetStage.pipelineId !== targetPipeline.id) {
      throw new BadRequestException(
        'Target stage does not belong to the selected pipeline.',
      );
    }

    await this.opportunitiesRepo.update(
      {
        id: opportunity.id,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
      {
        pipelineId: targetPipeline.id,
        stageId: targetStage.id,
        status: 'open',
        closedAt: null,
        lostReason: null,
        metadata: {
          ...(opportunity.metadata ?? {}),
          reopenedByUserId: context.userId ?? undefined,
          reopenedAt: new Date().toISOString(),
        },
      },
    );

    return this.getOpportunityDetail(context, opportunity.id);
  }

  private async getStageByTypeOrFallback(
    context: AgencyContext,
    pipelineId: string,
    type: 'won' | 'lost',
  ) {
    const stageByType = await this.stagesRepo.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        pipelineId,
        type,
      },
      order: { position: 'ASC', createdAt: 'ASC' },
    });

    if (stageByType) {
      return stageByType;
    }

    return this.stagesRepo.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        pipelineId,
        isClosed: true,
        isWon: type === 'won',
      },
      order: { position: 'ASC', createdAt: 'ASC' },
    });
  }

  async getOpportunityDetail(context: AgencyContext, opportunityId: string) {
    const opportunity = await this.ensureOpportunity(context, opportunityId);

    const [pipeline, stage, items, activities] = await Promise.all([
      this.pipelinesRepo.findOne({
        where: {
          id: opportunity.pipelineId,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      }),
      this.stagesRepo.findOne({
        where: {
          id: opportunity.stageId,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      }),
      this.opportunityItemsRepo.find({
        where: {
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          opportunityId: opportunity.id,
        },
        order: { position: 'ASC', createdAt: 'ASC' },
      }),
      this.activitiesRepo.find({
        where: {
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          opportunityId: opportunity.id,
        },
        order: { status: 'ASC', dueAt: 'ASC', createdAt: 'ASC' },
      }),
    ]);

    const pendingActivities = activities.filter(
      (activity) => activity.status === 'pending',
    );

    const overdueActivities = pendingActivities.filter((activity) => {
      if (!activity.dueAt) {
        return false;
      }

      return activity.dueAt.getTime() < Date.now();
    });

    const nextActivity =
      pendingActivities.find((activity) => activity.dueAt) ??
      pendingActivities[0] ??
      null;

    return {
      opportunity,
      pipeline,
      stage,
      items,
      activities,
      totals: {
        items: items.length,
        activities: activities.length,
        pendingActivities: pendingActivities.length,
        overdueActivities: overdueActivities.length,
        amountCents: opportunity.amountCents,
        recurringAmountCents: opportunity.recurringAmountCents,
      },
      nextActivity,
    };
  }

  async listOpportunities(context: AgencyContext) {
    return this.opportunitiesRepo.find({
      where: { tenantId: context.tenantId, workspaceId: context.workspaceId },
      order: { updatedAt: 'DESC' },
    });
  }

  async listOpportunityActivities(
    context: AgencyContext,
    opportunityId: string,
  ) {
    await this.ensureOpportunity(context, opportunityId);

    return this.activitiesRepo.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        opportunityId,
      },
      order: { status: 'ASC', dueAt: 'ASC', createdAt: 'ASC' },
    });
  }

  async createOpportunityActivity(
    context: AgencyContext,
    opportunityId: string,
    dto: CreateAgencySalesActivityDto,
  ) {
    const opportunity = await this.ensureOpportunity(context, opportunityId);

    return this.activitiesRepo.save(
      this.activitiesRepo.create({
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        opportunityId,
        contactId: dto.contactId ?? opportunity.contactId ?? null,
        assignedUserId:
          dto.assignedUserId === undefined
            ? (context.userId ?? null)
            : dto.assignedUserId,
        type: dto.type ?? 'follow_up',
        status: 'pending',
        title: dto.title,
        description: dto.description ?? null,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
        completedAt: null,
        completedByUserId: null,
        outcome: dto.outcome ?? undefined,
        position: dto.position ?? 0,
        metadata: {},
      }),
    );
  }

  async updateOpportunityActivity(
    context: AgencyContext,
    opportunityId: string,
    activityId: string,
    dto: UpdateAgencySalesActivityDto,
  ) {
    await this.ensureOpportunity(context, opportunityId);

    const activity = await this.activitiesRepo.findOne({
      where: {
        id: activityId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        opportunityId,
      },
    });

    if (!activity) {
      throw new BadRequestException('Activity not found.');
    }

    const nextStatus = dto.status ?? activity.status;

    await this.activitiesRepo.update(activity.id, {
      contactId: dto.contactId ?? activity.contactId,
      assignedUserId: dto.assignedUserId ?? activity.assignedUserId,
      type: dto.type ?? activity.type,
      status: nextStatus,
      title: dto.title ?? activity.title,
      description: dto.description ?? activity.description,
      dueAt: dto.dueAt ? new Date(dto.dueAt) : activity.dueAt,
      completedAt:
        nextStatus === 'done'
          ? (activity.completedAt ?? new Date())
          : nextStatus === 'pending'
            ? null
            : activity.completedAt,
      completedByUserId:
        nextStatus === 'done'
          ? (activity.completedByUserId ?? context.userId ?? null)
          : nextStatus === 'pending'
            ? null
            : activity.completedByUserId,
      outcome: dto.outcome ?? activity.outcome,
      position: dto.position ?? activity.position,
    });

    return this.activitiesRepo.findOne({
      where: {
        id: activityId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        opportunityId,
      },
    });
  }

  async completeOpportunityActivity(
    context: AgencyContext,
    opportunityId: string,
    activityId: string,
    dto: CompleteAgencySalesActivityDto,
  ) {
    await this.ensureOpportunity(context, opportunityId);

    const activity = await this.activitiesRepo.findOne({
      where: {
        id: activityId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        opportunityId,
      },
    });

    if (!activity) {
      throw new BadRequestException('Activity not found.');
    }

    await this.activitiesRepo.update(activity.id, {
      status: 'done',
      completedAt: new Date(),
      completedByUserId: context.userId ?? null,
      outcome: dto.outcome ?? activity.outcome,
    });

    return this.activitiesRepo.findOne({
      where: {
        id: activityId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        opportunityId,
      },
    });
  }

  async deleteOpportunityActivity(
    context: AgencyContext,
    opportunityId: string,
    activityId: string,
  ) {
    await this.ensureOpportunity(context, opportunityId);

    await this.activitiesRepo.delete({
      id: activityId,
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      opportunityId,
    });

    return { success: true };
  }

  async getOpportunitiesKanban(context: AgencyContext, pipelineId?: string) {
    const pipeline = pipelineId
      ? await this.pipelinesRepo.findOne({
          where: {
            id: pipelineId,
            tenantId: context.tenantId,
            workspaceId: context.workspaceId,
            status: 'active',
          },
        })
      : await this.getDefaultPipeline(context);

    if (!pipeline) {
      return {
        pipeline: null,
        stages: [],
        totals: {
          opportunities: 0,
          amountCents: 0,
          recurringAmountCents: 0,
        },
      };
    }

    const stages = await this.stagesRepo.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        pipelineId: pipeline.id,
      },
      order: { position: 'ASC', createdAt: 'ASC' },
    });

    const opportunities = await this.opportunitiesRepo.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        pipelineId: pipeline.id,
      },
      order: { updatedAt: 'DESC', createdAt: 'DESC' },
    });

    const columns = stages.map((stage) => {
      const stageOpportunities = opportunities.filter(
        (opportunity) => opportunity.stageId === stage.id,
      );

      return {
        ...stage,
        opportunities: stageOpportunities,
        totals: {
          opportunities: stageOpportunities.length,
          amountCents: stageOpportunities.reduce(
            (total, opportunity) => total + opportunity.amountCents,
            0,
          ),
          recurringAmountCents: stageOpportunities.reduce(
            (total, opportunity) => total + opportunity.recurringAmountCents,
            0,
          ),
        },
      };
    });

    return {
      pipeline,
      stages: columns,
      totals: {
        opportunities: opportunities.length,
        amountCents: opportunities.reduce(
          (total, opportunity) => total + opportunity.amountCents,
          0,
        ),
        recurringAmountCents: opportunities.reduce(
          (total, opportunity) => total + opportunity.recurringAmountCents,
          0,
        ),
      },
    };
  }

  async moveOpportunity(
    context: AgencyContext,
    opportunityId: string,
    dto: MoveAgencySalesOpportunityDto,
  ) {
    const opportunity = await this.ensureOpportunity(context, opportunityId);

    const targetStage = await this.stagesRepo.findOne({
      where: {
        id: dto.stageId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (!targetStage) {
      throw new BadRequestException('Target stage not found.');
    }

    const targetPipelineId = dto.pipelineId ?? targetStage.pipelineId;

    const targetPipeline = await this.pipelinesRepo.findOne({
      where: {
        id: targetPipelineId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (!targetPipeline) {
      throw new BadRequestException('Target pipeline not found.');
    }

    if (targetStage.pipelineId !== targetPipeline.id) {
      throw new BadRequestException(
        'Target stage does not belong to the selected pipeline.',
      );
    }

    const status = targetStage.isWon
      ? 'won'
      : targetStage.isClosed
        ? 'lost'
        : 'open';

    await this.opportunitiesRepo.update(
      {
        id: opportunity.id,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
      {
        pipelineId: targetPipeline.id,
        stageId: targetStage.id,
        status,
        closedAt: targetStage.isClosed ? new Date() : null,
      },
    );

    return this.opportunitiesRepo.findOne({
      where: {
        id: opportunity.id,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });
  }

  async listOpportunityItems(context: AgencyContext, opportunityId: string) {
    await this.ensureOpportunity(context, opportunityId);

    return this.opportunityItemsRepo.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        opportunityId,
      },
      order: { position: 'ASC', createdAt: 'ASC' },
    });
  }

  async createOpportunityItem(
    context: AgencyContext,
    opportunityId: string,
    dto: CreateAgencySalesOpportunityItemDto,
  ) {
    await this.ensureOpportunity(context, opportunityId);

    const catalogItem = dto.salesItemId
      ? await this.itemsRepo.findOne({
          where: {
            id: dto.salesItemId,
            tenantId: context.tenantId,
            workspaceId: context.workspaceId,
          },
        })
      : null;

    if (dto.salesItemId && !catalogItem) {
      throw new BadRequestException('Sales item not found.');
    }

    if (!catalogItem && !dto.name) {
      throw new BadRequestException(
        'Provide salesItemId or name for a custom item.',
      );
    }

    const quantity = dto.quantity ?? 1;
    const unitPriceCents =
      dto.unitPriceCents ?? catalogItem?.unitPriceCents ?? 0;
    const setupPriceCents =
      dto.setupPriceCents ?? catalogItem?.setupPriceCents ?? 0;
    const recurringPriceCents =
      dto.recurringPriceCents ?? catalogItem?.recurringPriceCents ?? 0;

    const item = await this.opportunityItemsRepo.save(
      this.opportunityItemsRepo.create({
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        opportunityId,
        salesItemId: catalogItem?.id ?? null,
        name: dto.name ?? catalogItem?.name ?? '',
        description: dto.description ?? catalogItem?.description ?? null,
        type: dto.type ?? catalogItem?.type ?? 'service',
        category: dto.category ?? catalogItem?.category ?? null,
        billingType: dto.billingType ?? catalogItem?.billingType ?? 'one_time',
        currency: dto.currency ?? catalogItem?.currency ?? 'BRL',
        quantity,
        unitPriceCents,
        setupPriceCents,
        recurringPriceCents,
        subtotalCents: (unitPriceCents + setupPriceCents) * quantity,
        recurringSubtotalCents: recurringPriceCents * quantity,
        recurrenceInterval:
          dto.recurrenceInterval ?? catalogItem?.recurrenceInterval ?? null,
        position: dto.position ?? 0,
        metadata: {},
      }),
    );

    await this.recalculateOpportunityTotals(context, opportunityId);

    return item;
  }

  async updateOpportunityItem(
    context: AgencyContext,
    opportunityId: string,
    itemId: string,
    dto: UpdateAgencySalesOpportunityItemDto,
  ) {
    await this.ensureOpportunity(context, opportunityId);

    const item = await this.opportunityItemsRepo.findOne({
      where: {
        id: itemId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        opportunityId,
      },
    });

    if (!item) {
      throw new BadRequestException('Opportunity item not found.');
    }

    const quantity = dto.quantity ?? item.quantity;
    const unitPriceCents = dto.unitPriceCents ?? item.unitPriceCents;
    const setupPriceCents = dto.setupPriceCents ?? item.setupPriceCents;
    const recurringPriceCents =
      dto.recurringPriceCents ?? item.recurringPriceCents;

    await this.opportunityItemsRepo.update(item.id, {
      ...dto,
      quantity,
      unitPriceCents,
      setupPriceCents,
      recurringPriceCents,
      subtotalCents: (unitPriceCents + setupPriceCents) * quantity,
      recurringSubtotalCents: recurringPriceCents * quantity,
    });

    await this.recalculateOpportunityTotals(context, opportunityId);

    return this.opportunityItemsRepo.findOne({
      where: {
        id: itemId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        opportunityId,
      },
    });
  }

  async deleteOpportunityItem(
    context: AgencyContext,
    opportunityId: string,
    itemId: string,
  ) {
    await this.ensureOpportunity(context, opportunityId);

    await this.opportunityItemsRepo.delete({
      id: itemId,
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      opportunityId,
    });

    await this.recalculateOpportunityTotals(context, opportunityId);

    return { success: true };
  }

  private async ensureOpportunity(
    context: AgencyContext,
    opportunityId: string,
  ) {
    const opportunity = await this.opportunitiesRepo.findOne({
      where: {
        id: opportunityId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (!opportunity) {
      throw new BadRequestException('Opportunity not found.');
    }

    return opportunity;
  }

  private async recalculateOpportunityTotals(
    context: AgencyContext,
    opportunityId: string,
  ) {
    const items = await this.opportunityItemsRepo.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        opportunityId,
      },
    });

    const amountCents = items.reduce(
      (total, item) => total + item.subtotalCents,
      0,
    );
    const recurringAmountCents = items.reduce(
      (total, item) => total + item.recurringSubtotalCents,
      0,
    );

    await this.opportunitiesRepo.update(
      {
        id: opportunityId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
      {
        amountCents,
        recurringAmountCents,
      },
    );
  }

  async updateOpportunity(
    context: AgencyContext,
    id: string,
    dto: UpdateAgencySalesOpportunityDto,
  ) {
    const { metadata, ...opportunityPatch } = dto;

    await this.opportunitiesRepo.update(
      { id, tenantId: context.tenantId, workspaceId: context.workspaceId },
      {
        ...opportunityPatch,
        description: dto.description ?? undefined,
        contactId: dto.contactId ?? undefined,
        companyContactId: dto.companyContactId ?? undefined,
        ownerUserId:
          dto.ownerUserId === undefined ? undefined : dto.ownerUserId,
        expectedCloseDate: dto.expectedCloseDate ?? undefined,
        lostReason: dto.lostReason ?? undefined,
        metadata: metadata as never,
      },
    );

    return this.opportunitiesRepo.findOne({
      where: {
        id,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });
  }

  async deleteOpportunity(context: AgencyContext, id: string) {
    await this.activitiesRepo.delete({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      opportunityId: id,
    });
    await this.opportunityItemsRepo.delete({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      opportunityId: id,
    });
    await this.opportunitiesRepo.delete({
      id,
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
    });

    return { deleted: true };
  }
}
