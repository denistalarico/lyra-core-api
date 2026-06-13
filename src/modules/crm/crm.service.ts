import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, IsNull, Repository } from 'typeorm';
import { RequestContext } from '../../common/context/request-context.interface';
import { ContactEntity } from '../contacts/entities/contact.entity';
import { CreateCrmOpportunityDto } from './dto/create-crm-opportunity.dto';
import { CreateCrmPipelineDto } from './dto/create-crm-pipeline.dto';
import { CreateCrmStageDto } from './dto/create-crm-stage.dto';
import { AssignCrmOpportunityTagDto } from './dto/assign-crm-opportunity-tag.dto';
import { CreateCrmOpportunityEventDto } from './dto/create-crm-opportunity-event.dto';
import { CreateCrmTagDto } from './dto/create-crm-tag.dto';
import { PatchCrmOpportunityCardColorDto } from './dto/patch-crm-opportunity-card-color.dto';
import { PatchCrmOpportunityFollowDto } from './dto/patch-crm-opportunity-follow.dto';
import { PatchCrmOpportunityVisibilityDto } from './dto/patch-crm-opportunity-visibility.dto';
import { PatchCrmStageFoldDto } from './dto/patch-crm-stage-fold.dto';
import { PatchCrmTagDto } from './dto/patch-crm-tag.dto';
import { ReorderCrmStagesDto } from './dto/reorder-crm-stages.dto';
import { PatchCrmOpportunityDto } from './dto/patch-crm-opportunity.dto';
import { PatchCrmOpportunityStageDto } from './dto/patch-crm-opportunity-stage.dto';
import { PatchCrmOpportunityStatusDto } from './dto/patch-crm-opportunity-status.dto';
import { PatchCrmPipelineDto } from './dto/patch-crm-pipeline.dto';
import { PatchCrmStageDto } from './dto/patch-crm-stage.dto';
import { CrmOpportunityEntity } from './entities/crm-opportunity.entity';
import { CrmPipelineEntity } from './entities/crm-pipeline.entity';
import { CrmStageEntity } from './entities/crm-stage.entity';
import { CrmOpportunityEventEntity } from './entities/crm-opportunity-event.entity';
import { CrmOpportunityTagEntity } from './entities/crm-opportunity-tag.entity';
import { CrmTagEntity } from './entities/crm-tag.entity';
import { SalesNotificationPublisher } from './sales-notification.publisher';

export type CrmOpportunityFilters = {
  pipelineId?: string;
  stageId?: string;
  status?: string;
  priority?: string;
  source?: string;
  businessMode?: string;
  assignedUserId?: string;
  contactId?: string;
  inboxConversationId?: string;
  search?: string;
};

@Injectable()
export class CrmService {
  constructor(
    @InjectRepository(CrmPipelineEntity, 'agency')
    private readonly pipelinesRepository: Repository<CrmPipelineEntity>,

    @InjectRepository(CrmStageEntity, 'agency')
    private readonly stagesRepository: Repository<CrmStageEntity>,

    @InjectRepository(CrmOpportunityEntity, 'agency')
    private readonly opportunitiesRepository: Repository<CrmOpportunityEntity>,

    @InjectRepository(CrmTagEntity, 'agency')
    private readonly tagsRepository: Repository<CrmTagEntity>,

    @InjectRepository(CrmOpportunityTagEntity, 'agency')
    private readonly opportunityTagsRepository: Repository<CrmOpportunityTagEntity>,

    @InjectRepository(CrmOpportunityEventEntity, 'agency')
    private readonly opportunityEventsRepository: Repository<CrmOpportunityEventEntity>,

    @InjectRepository(ContactEntity, 'agency')
    private readonly contactsRepository: Repository<ContactEntity>,
    private readonly salesNotificationPublisher: SalesNotificationPublisher,
  ) {}

  async listPipelines(ctx: RequestContext): Promise<CrmPipelineEntity[]> {
    await this.ensureDefaultPipeline(ctx);

    const tenantId = this.requireTenantId(ctx);
    const workspaceId = this.requireWorkspaceId(ctx);

    return this.pipelinesRepository.find({
      where: { tenantId, workspaceId, deletedAt: IsNull() },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
  }

  async createPipeline(
    ctx: RequestContext,
    dto: CreateCrmPipelineDto,
  ): Promise<CrmPipelineEntity> {
    const tenantId = this.requireTenantId(ctx);
    const workspaceId = this.requireWorkspaceId(ctx);

    const pipeline = this.pipelinesRepository.create({
      tenantId,
      workspaceId,
      name: dto.name,
      description: dto.description ?? null,
      businessMode: dto.businessMode ?? 'general',
      isDefault: dto.isDefault ?? false,
      status: dto.status ?? 'active',
      sortOrder: dto.sortOrder ?? 0,
      visibility: dto.visibility ?? 'workspace',
      ownerUserId: dto.ownerUserId ?? null,
      settings: dto.settings ?? {},
      channels: dto.channels ?? [],
      allowedUserIds: dto.allowedUserIds ?? [],
      metadata: dto.metadata ?? {},
    });

    return this.pipelinesRepository.save(pipeline);
  }

  async getPipeline(
    ctx: RequestContext,
    id: string,
  ): Promise<CrmPipelineEntity> {
    const tenantId = this.requireTenantId(ctx);
    const workspaceId = this.requireWorkspaceId(ctx);

    const pipeline = await this.pipelinesRepository.findOne({
      where: { id, tenantId, workspaceId, deletedAt: IsNull() },
    });

    if (!pipeline) throw new NotFoundException('CRM pipeline not found.');

    return pipeline;
  }

  async patchPipeline(
    ctx: RequestContext,
    id: string,
    dto: PatchCrmPipelineDto,
  ): Promise<CrmPipelineEntity> {
    const pipeline = await this.getPipeline(ctx, id);

    if (dto.name !== undefined) pipeline.name = dto.name;
    if (dto.description !== undefined) pipeline.description = dto.description;
    if (dto.businessMode !== undefined)
      pipeline.businessMode = dto.businessMode;
    if (dto.isDefault !== undefined) pipeline.isDefault = dto.isDefault;
    if (dto.status !== undefined) pipeline.status = dto.status;
    if (dto.sortOrder !== undefined) pipeline.sortOrder = dto.sortOrder;
    if (dto.visibility !== undefined) pipeline.visibility = dto.visibility;
    if (dto.ownerUserId !== undefined) pipeline.ownerUserId = dto.ownerUserId;
    if (dto.settings !== undefined) pipeline.settings = dto.settings;
    if (dto.channels !== undefined) pipeline.channels = dto.channels;
    if (dto.allowedUserIds !== undefined)
      pipeline.allowedUserIds = dto.allowedUserIds;
    if (dto.metadata !== undefined) pipeline.metadata = dto.metadata;

    return this.pipelinesRepository.save(pipeline);
  }

  async deletePipeline(
    ctx: RequestContext,
    id: string,
  ): Promise<{ deleted: true }> {
    const pipeline = await this.getPipeline(ctx, id);
    pipeline.deletedAt = new Date();
    await this.pipelinesRepository.save(pipeline);
    return { deleted: true };
  }

  async listStages(
    ctx: RequestContext,
    pipelineId?: string,
  ): Promise<CrmStageEntity[]> {
    const tenantId = this.requireTenantId(ctx);
    const workspaceId = this.requireWorkspaceId(ctx);

    const where: FindOptionsWhere<CrmStageEntity> = {
      tenantId,
      workspaceId,
      deletedAt: IsNull(),
    };

    if (pipelineId) where.pipelineId = pipelineId;

    return this.stagesRepository.find({
      where,
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
  }

  async createStage(
    ctx: RequestContext,
    dto: CreateCrmStageDto,
  ): Promise<CrmStageEntity> {
    const tenantId = this.requireTenantId(ctx);
    const workspaceId = this.requireWorkspaceId(ctx);

    await this.getPipeline(ctx, dto.pipelineId);

    const stage = this.stagesRepository.create({
      tenantId,
      workspaceId,
      pipelineId: dto.pipelineId,
      name: dto.name,
      description: dto.description ?? null,
      type: dto.type ?? 'open',
      color: dto.color ?? null,
      sortOrder: dto.sortOrder ?? 0,
      probability: dto.probability ?? 0,
      isWonStage: dto.isWonStage ?? false,
      isLostStage: dto.isLostStage ?? false,
      isFolded: dto.isFolded ?? false,
      metadata: dto.metadata ?? {},
    });

    return this.stagesRepository.save(stage);
  }

  async getStage(ctx: RequestContext, id: string): Promise<CrmStageEntity> {
    const tenantId = this.requireTenantId(ctx);
    const workspaceId = this.requireWorkspaceId(ctx);

    const stage = await this.stagesRepository.findOne({
      where: { id, tenantId, workspaceId, deletedAt: IsNull() },
    });

    if (!stage) throw new NotFoundException('CRM stage not found.');

    return stage;
  }

  async patchStage(
    ctx: RequestContext,
    id: string,
    dto: PatchCrmStageDto,
  ): Promise<CrmStageEntity> {
    const stage = await this.getStage(ctx, id);

    if (dto.name !== undefined) stage.name = dto.name;
    if (dto.description !== undefined) stage.description = dto.description;
    if (dto.type !== undefined) stage.type = dto.type;
    if (dto.color !== undefined) stage.color = dto.color;
    if (dto.sortOrder !== undefined) stage.sortOrder = dto.sortOrder;
    if (dto.probability !== undefined) stage.probability = dto.probability;
    if (dto.isWonStage !== undefined) stage.isWonStage = dto.isWonStage;
    if (dto.isLostStage !== undefined) stage.isLostStage = dto.isLostStage;
    if (dto.isFolded !== undefined) stage.isFolded = dto.isFolded;
    if (dto.metadata !== undefined) stage.metadata = dto.metadata;

    return this.stagesRepository.save(stage);
  }

  async deleteStage(
    ctx: RequestContext,
    id: string,
  ): Promise<{ deleted: true }> {
    const stage = await this.getStage(ctx, id);
    stage.deletedAt = new Date();
    await this.stagesRepository.save(stage);
    return { deleted: true };
  }

  async listOpportunities(
    ctx: RequestContext,
    filters: CrmOpportunityFilters = {},
  ): Promise<CrmOpportunityEntity[]> {
    await this.ensureDefaultPipeline(ctx);

    const tenantId = this.requireTenantId(ctx);
    const workspaceId = this.requireWorkspaceId(ctx);

    const where: FindOptionsWhere<CrmOpportunityEntity> = {
      tenantId,
      workspaceId,
      deletedAt: IsNull(),
    };

    if (filters.pipelineId) where.pipelineId = filters.pipelineId;
    if (filters.stageId) where.stageId = filters.stageId;
    if (filters.status) where.status = filters.status;
    if (filters.priority) where.priority = filters.priority;
    if (filters.source) where.source = filters.source;
    if (filters.businessMode) where.businessMode = filters.businessMode;
    if (filters.assignedUserId) where.assignedUserId = filters.assignedUserId;
    if (filters.contactId) where.contactId = filters.contactId;
    if (filters.inboxConversationId)
      where.inboxConversationId = filters.inboxConversationId;
    if (filters.search) where.title = ILike(`%${filters.search}%`);

    return this.opportunitiesRepository.find({
      where,
      order: {
        nextFollowUpAt: 'ASC',
        createdAt: 'DESC',
      },
    });
  }

  async createOpportunity(
    ctx: RequestContext,
    dto: CreateCrmOpportunityDto,
  ): Promise<CrmOpportunityEntity> {
    const tenantId = this.requireTenantId(ctx);
    const workspaceId = this.requireWorkspaceId(ctx);

    const pipeline = dto.pipelineId
      ? await this.getPipeline(ctx, dto.pipelineId)
      : await this.ensureDefaultPipeline(ctx);

    const stage = dto.stageId
      ? await this.getStage(ctx, dto.stageId)
      : await this.getFirstOpenStage(ctx, pipeline.id);

    if (stage.pipelineId !== pipeline.id) {
      throw new BadRequestException(
        'Stage does not belong to the selected pipeline.',
      );
    }

    await this.validateContactForOpportunity(ctx, dto.contactId);

    const opportunity = this.opportunitiesRepository.create({
      tenantId,
      workspaceId,
      pipelineId: pipeline.id,
      stageId: stage.id,
      contactId: dto.contactId ?? null,
      contactName: dto.contactName ?? null,
      contactEmail: dto.contactEmail ?? null,
      contactPhone: dto.contactPhone ?? null,
      inboxConversationId: dto.inboxConversationId ?? null,
      title: dto.title,
      description: dto.description ?? null,
      valueAmount: dto.valueAmount ?? null,
      currency: dto.currency ?? 'BRL',
      status: dto.status ?? 'open',
      priority: dto.priority ?? 'normal',
      source: dto.source ?? 'manual',
      businessMode: dto.businessMode ?? pipeline.businessMode ?? 'general',
      operationalStatus: dto.operationalStatus ?? null,
      businessContext: dto.businessContext ?? {},
      assignedUserId: dto.assignedUserId ?? null,
      expectedCloseDate: dto.expectedCloseDate ?? null,
      nextFollowUpAt: this.toDateOrNull(dto.nextFollowUpAt),
      lastActivityAt: null,
      lostReason: dto.lostReason ?? null,
      cardColor: dto.cardColor ?? null,
      visibility: dto.visibility ?? 'workspace',
      followMode: dto.followMode ?? 'automatic',
      followMessage: dto.followMessage ?? null,
      followSendAutomatically: dto.followSendAutomatically ?? false,
      metadata: dto.metadata ?? {},
    });

    const saved = await this.opportunitiesRepository.save(opportunity);

    await this.createOpportunityEvent(ctx, saved.id, {
      actorType: 'user',
      eventType: 'opportunity_created',
      title: 'Oportunidade criada',
      afterData: { opportunityId: saved.id, title: saved.title },
    });

    if (saved.assignedUserId) {
      await this.salesNotificationPublisher.publishOpportunityAssigned({
        resource: saved,
        actorUserId: this.getUserId(ctx),
        occurredAt: saved.createdAt,
        assignedUserId: saved.assignedUserId,
      });
    }

    return saved;
  }

  async getOpportunity(
    ctx: RequestContext,
    id: string,
  ): Promise<CrmOpportunityEntity> {
    const tenantId = this.requireTenantId(ctx);
    const workspaceId = this.requireWorkspaceId(ctx);

    const opportunity = await this.opportunitiesRepository.findOne({
      where: { id, tenantId, workspaceId, deletedAt: IsNull() },
    });

    if (!opportunity) throw new NotFoundException('CRM opportunity not found.');

    return opportunity;
  }

  async patchOpportunity(
    ctx: RequestContext,
    id: string,
    dto: PatchCrmOpportunityDto,
  ): Promise<CrmOpportunityEntity> {
    const opportunity = await this.getOpportunity(ctx, id);
    const previousAssignedUserId = opportunity.assignedUserId;

    const pipelineId = dto.pipelineId ?? opportunity.pipelineId;
    const stageId = dto.stageId ?? opportunity.stageId;

    if (dto.pipelineId !== undefined || dto.stageId !== undefined) {
      await this.validatePipelineStage(ctx, pipelineId, stageId);
    }

    await this.validateContactForOpportunity(ctx, dto.contactId);

    if (dto.pipelineId !== undefined) opportunity.pipelineId = dto.pipelineId;
    if (dto.stageId !== undefined) opportunity.stageId = dto.stageId;
    if (dto.contactId !== undefined) opportunity.contactId = dto.contactId;
    if (dto.contactName !== undefined)
      opportunity.contactName = dto.contactName;
    if (dto.contactEmail !== undefined)
      opportunity.contactEmail = dto.contactEmail;
    if (dto.contactPhone !== undefined)
      opportunity.contactPhone = dto.contactPhone;
    if (dto.inboxConversationId !== undefined)
      opportunity.inboxConversationId = dto.inboxConversationId;
    if (dto.title !== undefined) opportunity.title = dto.title;
    if (dto.description !== undefined)
      opportunity.description = dto.description;
    if (dto.valueAmount !== undefined)
      opportunity.valueAmount = dto.valueAmount;
    if (dto.currency !== undefined) opportunity.currency = dto.currency;
    if (dto.status !== undefined)
      this.applyOpportunityStatus(opportunity, dto.status, dto.lostReason);
    if (dto.priority !== undefined) opportunity.priority = dto.priority;
    if (dto.source !== undefined) opportunity.source = dto.source;
    if (dto.businessMode !== undefined)
      opportunity.businessMode = dto.businessMode;
    if (dto.operationalStatus !== undefined)
      opportunity.operationalStatus = dto.operationalStatus;
    if (dto.businessContext !== undefined)
      opportunity.businessContext = dto.businessContext;
    if (dto.assignedUserId !== undefined)
      opportunity.assignedUserId = dto.assignedUserId;
    if (dto.expectedCloseDate !== undefined)
      opportunity.expectedCloseDate = dto.expectedCloseDate;
    if (dto.nextFollowUpAt !== undefined)
      opportunity.nextFollowUpAt = this.toDateOrNull(dto.nextFollowUpAt);
    if (dto.lostReason !== undefined) opportunity.lostReason = dto.lostReason;
    if (dto.cardColor !== undefined) opportunity.cardColor = dto.cardColor;
    if (dto.visibility !== undefined) opportunity.visibility = dto.visibility;
    if (dto.followMode !== undefined) opportunity.followMode = dto.followMode;
    if (dto.followMessage !== undefined)
      opportunity.followMessage = dto.followMessage;
    if (dto.followSendAutomatically !== undefined)
      opportunity.followSendAutomatically = dto.followSendAutomatically;
    if (dto.metadata !== undefined) opportunity.metadata = dto.metadata;

    const saved = await this.opportunitiesRepository.save(opportunity);

    await this.createOpportunityEvent(ctx, saved.id, {
      actorType: 'user',
      eventType: 'opportunity_updated',
      title: 'Oportunidade atualizada',
      afterData: { opportunityId: saved.id },
    });

    if (
      dto.assignedUserId !== undefined &&
      saved.assignedUserId &&
      saved.assignedUserId !== previousAssignedUserId
    ) {
      await this.salesNotificationPublisher.publishOpportunityAssigned({
        resource: saved,
        actorUserId: this.getUserId(ctx),
        occurredAt: saved.updatedAt,
        assignedUserId: saved.assignedUserId,
      });
    }

    return saved;
  }

  async patchOpportunityStage(
    ctx: RequestContext,
    id: string,
    dto: PatchCrmOpportunityStageDto,
  ): Promise<CrmOpportunityEntity> {
    const opportunity = await this.getOpportunity(ctx, id);
    const previousStageId = opportunity.stageId;
    const stage = await this.getStage(ctx, dto.stageId);

    if (stage.pipelineId !== opportunity.pipelineId) {
      throw new BadRequestException(
        'Stage does not belong to this opportunity pipeline.',
      );
    }

    if (previousStageId === stage.id) {
      return opportunity;
    }

    opportunity.stageId = stage.id;

    if (stage.isWonStage || stage.type === 'won') {
      this.applyOpportunityStatus(opportunity, 'won');
    }

    if (stage.isLostStage || stage.type === 'lost') {
      this.applyOpportunityStatus(opportunity, 'lost');
    }

    const saved = await this.opportunitiesRepository.save(opportunity);

    const event = await this.createOpportunityEvent(ctx, saved.id, {
      actorType: 'user',
      eventType: 'stage_changed',
      title: 'Etapa alterada',
      beforeData: { stageId: previousStageId },
      afterData: { stageId: saved.stageId, status: saved.status },
    });

    if (stage.isWonStage || stage.isLostStage || stage.type === 'won' || stage.type === 'lost') {
      await this.salesNotificationPublisher.publishOpportunityStageChanged({
        resource: saved,
        event,
        actorUserId: this.getUserId(ctx),
        occurredAt: event.createdAt,
        previousStageId,
        stageId: saved.stageId,
      });
    }

    return saved;
  }

  async patchOpportunityStatus(
    ctx: RequestContext,
    id: string,
    dto: PatchCrmOpportunityStatusDto,
  ): Promise<CrmOpportunityEntity> {
    const opportunity = await this.getOpportunity(ctx, id);
    this.applyOpportunityStatus(opportunity, dto.status, dto.lostReason);
    return this.opportunitiesRepository.save(opportunity);
  }

  async deleteOpportunity(
    ctx: RequestContext,
    id: string,
  ): Promise<{ deleted: true }> {
    const opportunity = await this.getOpportunity(ctx, id);
    opportunity.deletedAt = new Date();
    await this.opportunitiesRepository.save(opportunity);
    return { deleted: true };
  }

  async listTags(ctx: RequestContext): Promise<CrmTagEntity[]> {
    const tenantId = this.requireTenantId(ctx);
    const workspaceId = this.requireWorkspaceId(ctx);

    return this.tagsRepository.find({
      where: { tenantId, workspaceId, deletedAt: IsNull() },
      order: { kind: 'ASC', name: 'ASC' },
    });
  }

  async createTag(
    ctx: RequestContext,
    dto: CreateCrmTagDto,
  ): Promise<CrmTagEntity> {
    const tenantId = this.requireTenantId(ctx);
    const workspaceId = this.requireWorkspaceId(ctx);

    const kind = dto.kind ?? 'user';
    const tag = this.tagsRepository.create({
      tenantId,
      workspaceId,
      name: dto.name,
      slug: dto.slug ?? this.slugify(dto.name),
      color: dto.color ?? null,
      icon: dto.icon ?? null,
      kind,
      scope: dto.scope ?? 'workspace',
      ownerUserId:
        dto.ownerUserId ?? (dto.scope === 'user' ? this.getUserId(ctx) : null),
      description: dto.description ?? null,
      isEditable: kind === 'system' ? false : true,
      metadata: dto.metadata ?? {},
    });

    return this.tagsRepository.save(tag);
  }

  async getTag(ctx: RequestContext, id: string): Promise<CrmTagEntity> {
    const tenantId = this.requireTenantId(ctx);
    const workspaceId = this.requireWorkspaceId(ctx);

    const tag = await this.tagsRepository.findOne({
      where: { id, tenantId, workspaceId, deletedAt: IsNull() },
    });

    if (!tag) throw new NotFoundException('CRM tag not found.');

    return tag;
  }

  async patchTag(
    ctx: RequestContext,
    id: string,
    dto: PatchCrmTagDto,
  ): Promise<CrmTagEntity> {
    const tag = await this.getTag(ctx, id);

    if (!tag.isEditable || tag.kind === 'system') {
      throw new BadRequestException('System tags cannot be edited.');
    }

    if (dto.name !== undefined) tag.name = dto.name;
    if (dto.slug !== undefined) tag.slug = dto.slug;
    if (dto.color !== undefined) tag.color = dto.color;
    if (dto.icon !== undefined) tag.icon = dto.icon;
    if (dto.kind !== undefined) tag.kind = dto.kind;
    if (dto.scope !== undefined) tag.scope = dto.scope;
    if (dto.ownerUserId !== undefined) tag.ownerUserId = dto.ownerUserId;
    if (dto.description !== undefined) tag.description = dto.description;
    if (dto.isEditable !== undefined) tag.isEditable = dto.isEditable;
    if (dto.metadata !== undefined) tag.metadata = dto.metadata;

    return this.tagsRepository.save(tag);
  }

  async deleteTag(ctx: RequestContext, id: string): Promise<{ deleted: true }> {
    const tag = await this.getTag(ctx, id);

    if (!tag.isEditable || tag.kind === 'system') {
      throw new BadRequestException('System tags cannot be deleted.');
    }

    tag.deletedAt = new Date();
    await this.tagsRepository.save(tag);
    return { deleted: true };
  }

  async listOpportunityTags(
    ctx: RequestContext,
    opportunityId: string,
  ): Promise<CrmOpportunityTagEntity[]> {
    const tenantId = this.requireTenantId(ctx);
    const workspaceId = this.requireWorkspaceId(ctx);

    await this.getOpportunity(ctx, opportunityId);

    return this.opportunityTagsRepository.find({
      where: { tenantId, workspaceId, opportunityId },
      order: { createdAt: 'ASC' },
    });
  }

  async assignOpportunityTag(
    ctx: RequestContext,
    opportunityId: string,
    dto: AssignCrmOpportunityTagDto,
  ): Promise<CrmOpportunityTagEntity> {
    const tenantId = this.requireTenantId(ctx);
    const workspaceId = this.requireWorkspaceId(ctx);

    await this.getOpportunity(ctx, opportunityId);
    await this.getTag(ctx, dto.tagId);

    const existing = await this.opportunityTagsRepository.findOne({
      where: { tenantId, workspaceId, opportunityId, tagId: dto.tagId },
    });

    if (existing) return existing;

    const assignment = this.opportunityTagsRepository.create({
      tenantId,
      workspaceId,
      opportunityId,
      tagId: dto.tagId,
      assignedByType: dto.assignedByType ?? 'user',
      assignedByUserId: this.getUserId(ctx),
      metadata: dto.metadata ?? {},
    });

    const saved = await this.opportunityTagsRepository.save(assignment);

    await this.createOpportunityEvent(ctx, opportunityId, {
      actorType: dto.assignedByType ?? 'user',
      eventType: 'tag_added',
      title: 'Tag adicionada',
      afterData: { tagId: dto.tagId },
    });

    return saved;
  }

  async removeOpportunityTag(
    ctx: RequestContext,
    opportunityId: string,
    tagId: string,
  ): Promise<{ deleted: true }> {
    const tenantId = this.requireTenantId(ctx);
    const workspaceId = this.requireWorkspaceId(ctx);

    await this.getOpportunity(ctx, opportunityId);
    const tag = await this.getTag(ctx, tagId);

    if (tag.kind === 'system' && !tag.isEditable) {
      throw new BadRequestException('System tags cannot be removed manually.');
    }

    await this.opportunityTagsRepository.delete({
      tenantId,
      workspaceId,
      opportunityId,
      tagId,
    });

    await this.createOpportunityEvent(ctx, opportunityId, {
      actorType: 'user',
      eventType: 'tag_removed',
      title: 'Tag removida',
      beforeData: { tagId },
    });

    return { deleted: true };
  }

  async patchOpportunityCardColor(
    ctx: RequestContext,
    id: string,
    dto: PatchCrmOpportunityCardColorDto,
  ): Promise<CrmOpportunityEntity> {
    const opportunity = await this.getOpportunity(ctx, id);
    opportunity.cardColor = dto.cardColor ?? null;
    const saved = await this.opportunitiesRepository.save(opportunity);

    await this.createOpportunityEvent(ctx, id, {
      actorType: 'user',
      eventType: 'card_color_changed',
      title: 'Cor do card alterada',
      afterData: { cardColor: saved.cardColor },
    });

    return saved;
  }

  async patchOpportunityFollow(
    ctx: RequestContext,
    id: string,
    dto: PatchCrmOpportunityFollowDto,
  ): Promise<CrmOpportunityEntity> {
    const opportunity = await this.getOpportunity(ctx, id);

    if (dto.followMode !== undefined) opportunity.followMode = dto.followMode;
    if (dto.nextFollowUpAt !== undefined)
      opportunity.nextFollowUpAt = this.toDateOrNull(dto.nextFollowUpAt);
    if (dto.followMessage !== undefined)
      opportunity.followMessage = dto.followMessage;
    if (dto.followSendAutomatically !== undefined) {
      opportunity.followSendAutomatically = dto.followSendAutomatically;
    }

    const saved = await this.opportunitiesRepository.save(opportunity);

    await this.createOpportunityEvent(ctx, id, {
      actorType: 'user',
      eventType: 'follow_updated',
      title: 'Follow-up atualizado',
      afterData: {
        followMode: saved.followMode,
        nextFollowUpAt: saved.nextFollowUpAt,
        followSendAutomatically: saved.followSendAutomatically,
      },
    });

    return saved;
  }

  async patchOpportunityVisibility(
    ctx: RequestContext,
    id: string,
    dto: PatchCrmOpportunityVisibilityDto,
  ): Promise<CrmOpportunityEntity> {
    const opportunity = await this.getOpportunity(ctx, id);
    opportunity.visibility = dto.visibility;
    return this.opportunitiesRepository.save(opportunity);
  }

  async patchStageFold(
    ctx: RequestContext,
    id: string,
    dto: PatchCrmStageFoldDto,
  ): Promise<CrmStageEntity> {
    const stage = await this.getStage(ctx, id);
    stage.isFolded = dto.isFolded;
    return this.stagesRepository.save(stage);
  }

  async reorderStages(
    ctx: RequestContext,
    dto: ReorderCrmStagesDto,
  ): Promise<CrmStageEntity[]> {
    const updated: CrmStageEntity[] = [];

    for (const item of dto.stages) {
      const stage = await this.getStage(ctx, item.id);
      stage.sortOrder = item.sortOrder;
      updated.push(await this.stagesRepository.save(stage));
    }

    return updated.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async listOpportunityEvents(
    ctx: RequestContext,
    opportunityId: string,
  ): Promise<CrmOpportunityEventEntity[]> {
    const tenantId = this.requireTenantId(ctx);
    const workspaceId = this.requireWorkspaceId(ctx);

    await this.getOpportunity(ctx, opportunityId);

    return this.opportunityEventsRepository.find({
      where: { tenantId, workspaceId, opportunityId },
      order: { createdAt: 'DESC' },
    });
  }

  async createOpportunityEvent(
    ctx: RequestContext,
    opportunityId: string,
    dto: CreateCrmOpportunityEventDto,
  ): Promise<CrmOpportunityEventEntity> {
    const tenantId = this.requireTenantId(ctx);
    const workspaceId = this.requireWorkspaceId(ctx);

    const event = this.opportunityEventsRepository.create({
      tenantId,
      workspaceId,
      opportunityId,
      actorType: dto.actorType ?? 'user',
      actorUserId: dto.actorUserId ?? this.getUserId(ctx),
      eventType: dto.eventType,
      title: dto.title,
      description: dto.description ?? null,
      beforeData: dto.beforeData ?? {},
      afterData: dto.afterData ?? {},
      reason: dto.reason ?? null,
      confidence: dto.confidence ?? null,
      metadata: dto.metadata ?? {},
    });

    return this.opportunityEventsRepository.save(event);
  }

  private slugify(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private async ensureDefaultPipeline(
    ctx: RequestContext,
  ): Promise<CrmPipelineEntity> {
    const tenantId = this.requireTenantId(ctx);
    const workspaceId = this.requireWorkspaceId(ctx);

    const existing = await this.pipelinesRepository.findOne({
      where: {
        tenantId,
        workspaceId,
        isDefault: true,
        deletedAt: IsNull(),
      },
      order: { createdAt: 'ASC' },
    });

    if (existing) return existing;

    const pipeline = await this.pipelinesRepository.save(
      this.pipelinesRepository.create({
        tenantId,
        workspaceId,
        name: 'Pipeline Comercial',
        description: 'Pipeline padrão criado automaticamente para o CRM.',
        businessMode: 'general',
        isDefault: true,
        status: 'active',
        sortOrder: 0,
        metadata: { systemGenerated: true },
      }),
    );

    const stages = [
      { name: 'Novo Lead', sortOrder: 10, probability: 10, type: 'open' },
      { name: 'Qualificado', sortOrder: 20, probability: 25, type: 'open' },
      {
        name: 'Contato / Reunião',
        sortOrder: 30,
        probability: 40,
        type: 'open',
      },
      {
        name: 'Proposta / Orçamento',
        sortOrder: 40,
        probability: 60,
        type: 'open',
      },
      { name: 'Negociação', sortOrder: 50, probability: 75, type: 'open' },
      {
        name: 'Ganho',
        sortOrder: 60,
        probability: 100,
        type: 'won',
        isWonStage: true,
      },
      {
        name: 'Perdido',
        sortOrder: 70,
        probability: 0,
        type: 'lost',
        isLostStage: true,
      },
    ];

    await this.stagesRepository.save(
      stages.map((stage) =>
        this.stagesRepository.create({
          tenantId,
          workspaceId,
          pipelineId: pipeline.id,
          name: stage.name,
          description: null,
          type: stage.type,
          color: null,
          sortOrder: stage.sortOrder,
          probability: stage.probability,
          isWonStage: stage.isWonStage ?? false,
          isLostStage: stage.isLostStage ?? false,
          metadata: { systemGenerated: true },
        }),
      ),
    );

    return pipeline;
  }

  private async getFirstOpenStage(
    ctx: RequestContext,
    pipelineId: string,
  ): Promise<CrmStageEntity> {
    const tenantId = this.requireTenantId(ctx);
    const workspaceId = this.requireWorkspaceId(ctx);

    const stage = await this.stagesRepository.findOne({
      where: {
        tenantId,
        workspaceId,
        pipelineId,
        type: 'open',
        deletedAt: IsNull(),
      },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });

    if (!stage) {
      throw new BadRequestException('Selected pipeline has no open stage.');
    }

    return stage;
  }

  private async validatePipelineStage(
    ctx: RequestContext,
    pipelineId: string,
    stageId: string,
  ): Promise<{ pipeline: CrmPipelineEntity; stage: CrmStageEntity }> {
    const [pipeline, stage] = await Promise.all([
      this.getPipeline(ctx, pipelineId),
      this.getStage(ctx, stageId),
    ]);

    if (stage.pipelineId !== pipeline.id) {
      throw new BadRequestException(
        'Stage does not belong to the selected pipeline.',
      );
    }

    return { pipeline, stage };
  }

  private async validateContactForOpportunity(
    ctx: RequestContext,
    contactId: string | null | undefined,
  ): Promise<void> {
    if (contactId === undefined || contactId === null) return;

    const tenantId = this.requireTenantId(ctx);
    const workspaceId = this.requireWorkspaceId(ctx);

    const contact = await this.contactsRepository.findOne({
      where: { id: contactId, tenantId, workspaceId },
    });

    if (!contact) {
      throw new NotFoundException('Contact not found.');
    }

    if (contact.status === 'archived') {
      throw new BadRequestException(
        'Archived contacts cannot be linked to CRM opportunities.',
      );
    }
  }

  private applyOpportunityStatus(
    opportunity: CrmOpportunityEntity,
    status: string,
    lostReason?: string | null,
  ): void {
    opportunity.status = status;

    if (status === 'won') {
      opportunity.wonAt = opportunity.wonAt ?? new Date();
      opportunity.lostAt = null;
      opportunity.lostReason = null;
    }

    if (status === 'lost') {
      opportunity.lostAt = opportunity.lostAt ?? new Date();
      opportunity.wonAt = null;
      opportunity.lostReason = lostReason ?? opportunity.lostReason ?? null;
    }

    if (status === 'open') {
      opportunity.wonAt = null;
      opportunity.lostAt = null;
      opportunity.lostReason = null;
    }
  }

  private toDateOrNull(value?: string | null): Date | null {
    if (!value) return null;

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Invalid date value.');
    }

    return date;
  }

  private requireTenantId(ctx: RequestContext): string {
    if (!ctx.tenantId) throw new BadRequestException('Missing tenant context.');
    return ctx.tenantId;
  }

  private requireWorkspaceId(ctx: RequestContext): string {
    if (!ctx.workspaceId)
      throw new BadRequestException('Missing workspace context.');
    return ctx.workspaceId;
  }

  private getUserId(ctx: RequestContext): string | null {
    return ctx.userId ?? null;
  }
}
