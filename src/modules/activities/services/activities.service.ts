import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { AgencyActivity, AgencyActivityLink } from '../entities';
import {
  ActivityEntityType,
  ActivityRelationType,
  ActivityStatus,
  ActivityType,
  ActivityVisibility,
} from '../enums';
import {
  CancelActivityDto,
  CompleteActivityDto,
  CompleteAndScheduleNextActivityDto,
  CreateActivityDto,
  CreateActivityLinkDto,
  ListActivitiesQueryDto,
  UpdateActivityDto,
} from '../dto';

type RequestContext = {
  tenantId: string;
  workspaceId: string;
  userId: string;
};

const AGENCY_CONNECTION = 'agency';

@Injectable()
export class ActivitiesService {
  constructor(
    @InjectRepository(AgencyActivity, AGENCY_CONNECTION)
    private readonly activitiesRepository: Repository<AgencyActivity>,
    @InjectRepository(AgencyActivityLink, AGENCY_CONNECTION)
    private readonly linksRepository: Repository<AgencyActivityLink>,
  ) {}

  getTypesConfig() {
    return [
      {
        type: ActivityType.Checklist,
        label: 'Checklist',
        description: 'Lista simples de verificação vinculada a um contexto.',
        icon: 'list-checks',
        color: 'violet',
        subtypes: [],
        availableActions: ['save', 'complete', 'cancel', 'checklist'],
      },
      {
        type: ActivityType.Email,
        label: 'E-mail',
        description: 'Atividade de e-mail para proposta, follow-up ou aprovação.',
        icon: 'mail',
        color: 'blue',
        subtypes: ['proposal', 'follow_up', 'presentation', 'pending_request', 'approval', 'marketing', 'other'],
        availableActions: ['save', 'complete', 'cancel', 'send_email'],
      },
      {
        type: ActivityType.Call,
        label: 'Ligação',
        description: 'Ligação comercial, operacional ou de suporte.',
        icon: 'phone',
        color: 'green',
        subtypes: ['discovery', 'follow_up', 'alignment', 'negotiation', 'closing', 'support', 'other'],
        availableActions: ['save', 'complete', 'cancel', 'call'],
      },
      {
        type: ActivityType.Task,
        label: 'Tarefa',
        description: 'Ação simples e transversal, sem substituir Tasks de projetos.',
        icon: 'check-square',
        color: 'slate',
        subtypes: [],
        availableActions: ['save', 'complete', 'cancel'],
      },
      {
        type: ActivityType.FollowUp,
        label: 'Follow-up',
        description: 'Retomada futura de contato, oportunidade ou entrega.',
        icon: 'rotate-ccw',
        color: 'amber',
        subtypes: [],
        availableActions: ['save', 'complete', 'cancel'],
      },
      {
        type: ActivityType.Meeting,
        label: 'Reunião',
        description: 'Reunião, briefing, apresentação, aprovação ou alinhamento.',
        icon: 'calendar-days',
        color: 'indigo',
        subtypes: ['briefing', 'alignment', 'presentation', 'approval', 'follow_up', 'closing', 'other'],
        availableActions: ['save', 'complete', 'cancel', 'schedule_meeting'],
      },
      {
        type: ActivityType.Document,
        label: 'Documento',
        description: 'Atividade documental vinculada preferencialmente a projeto ou tarefa.',
        icon: 'file-text',
        color: 'rose',
        subtypes: [],
        availableActions: ['save', 'complete', 'cancel', 'upload_document'],
      },
    ];
  }

  list(context: RequestContext, query: ListActivitiesQueryDto) {
    const qb = this.activitiesRepository
      .createQueryBuilder('activity')
      .where('activity.tenant_id = :tenantId', { tenantId: context.tenantId })
      .andWhere('activity.workspace_id = :workspaceId', { workspaceId: context.workspaceId });

    if (query.includeArchived !== 'true') {
      qb.andWhere('activity.archived_at IS NULL');
    }

    this.applyFilters(qb, query);

    return qb
      .orderBy('activity.due_at', 'ASC', 'NULLS LAST')
      .addOrderBy('activity.updated_at', 'DESC')
      .getMany();
  }

  async listByContext(context: RequestContext, entityType: ActivityEntityType, entityId: string) {
    return this.activitiesRepository
      .createQueryBuilder('activity')
      .innerJoin(
        AgencyActivityLink,
        'link',
        'link.activity_id = activity.id AND link.tenant_id = activity.tenant_id AND link.workspace_id = activity.workspace_id',
      )
      .where('activity.tenant_id = :tenantId', { tenantId: context.tenantId })
      .andWhere('activity.workspace_id = :workspaceId', { workspaceId: context.workspaceId })
      .andWhere('activity.archived_at IS NULL')
      .andWhere('link.entity_type = :entityType', { entityType })
      .andWhere('link.entity_id = :entityId', { entityId })
      .orderBy('activity.due_at', 'ASC', 'NULLS LAST')
      .addOrderBy('activity.updated_at', 'DESC')
      .getMany();
  }

  listMyActivities(context: RequestContext, query: ListActivitiesQueryDto) {
    const qb = this.activitiesRepository
      .createQueryBuilder('activity')
      .where('activity.tenant_id = :tenantId', { tenantId: context.tenantId })
      .andWhere('activity.workspace_id = :workspaceId', { workspaceId: context.workspaceId })
      .andWhere('activity.archived_at IS NULL')
      .andWhere(
        new Brackets((subQb) => {
          subQb
            .where('activity.assigned_to_id = :userId', { userId: context.userId })
            .orWhere('activity.created_by_id = :userId AND activity.visibility = :privateVisibility', {
              userId: context.userId,
              privateVisibility: ActivityVisibility.Private,
            });
        }),
      );

    this.applyFilters(qb, query);

    return qb
      .orderBy('activity.due_at', 'ASC', 'NULLS LAST')
      .addOrderBy('activity.updated_at', 'DESC')
      .getMany();
  }

  listOverdueActivities(context: RequestContext, query: ListActivitiesQueryDto) {
    const now = new Date();

    const qb = this.activitiesRepository
      .createQueryBuilder('activity')
      .where('activity.tenant_id = :tenantId', { tenantId: context.tenantId })
      .andWhere('activity.workspace_id = :workspaceId', { workspaceId: context.workspaceId })
      .andWhere('activity.archived_at IS NULL')
      .andWhere('activity.due_at IS NOT NULL')
      .andWhere('activity.due_at < :now', { now })
      .andWhere('activity.status NOT IN (:...closedStatuses)', {
        closedStatuses: [
          ActivityStatus.Done,
          ActivityStatus.Cancelled,
          ActivityStatus.Archived,
        ],
      });

    this.applyFilters(qb, query);

    return qb
      .orderBy('activity.due_at', 'ASC')
      .addOrderBy('activity.updated_at', 'DESC')
      .getMany();
  }

  async getSummary(context: RequestContext) {
    const qb = this.activitiesRepository
      .createQueryBuilder('activity')
      .select('activity.status', 'status')
      .addSelect('COUNT(activity.id)', 'count')
      .where('activity.tenant_id = :tenantId', { tenantId: context.tenantId })
      .andWhere('activity.workspace_id = :workspaceId', { workspaceId: context.workspaceId })
      .andWhere('activity.archived_at IS NULL')
      .groupBy('activity.status');

    const byStatusRows = await qb.getRawMany<{ status: string; count: string }>();

    const overdueCount = await this.activitiesRepository
      .createQueryBuilder('activity')
      .where('activity.tenant_id = :tenantId', { tenantId: context.tenantId })
      .andWhere('activity.workspace_id = :workspaceId', { workspaceId: context.workspaceId })
      .andWhere('activity.archived_at IS NULL')
      .andWhere('activity.due_at IS NOT NULL')
      .andWhere('activity.due_at < :now', { now: new Date() })
      .andWhere('activity.status NOT IN (:...closedStatuses)', {
        closedStatuses: [
          ActivityStatus.Done,
          ActivityStatus.Cancelled,
          ActivityStatus.Archived,
        ],
      })
      .getCount();

    const myOpenCount = await this.activitiesRepository
      .createQueryBuilder('activity')
      .where('activity.tenant_id = :tenantId', { tenantId: context.tenantId })
      .andWhere('activity.workspace_id = :workspaceId', { workspaceId: context.workspaceId })
      .andWhere('activity.archived_at IS NULL')
      .andWhere('activity.assigned_to_id = :userId', { userId: context.userId })
      .andWhere('activity.status NOT IN (:...closedStatuses)', {
        closedStatuses: [
          ActivityStatus.Done,
          ActivityStatus.Cancelled,
          ActivityStatus.Archived,
        ],
      })
      .getCount();

    const byStatus = byStatusRows.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = Number(row.count);
      return acc;
    }, {});

    const now = new Date();

    const openActivities = await this.activitiesRepository
      .createQueryBuilder('activity')
      .where('activity.tenant_id = :tenantId', { tenantId: context.tenantId })
      .andWhere('activity.workspace_id = :workspaceId', { workspaceId: context.workspaceId })
      .andWhere('activity.archived_at IS NULL')
      .andWhere('activity.status NOT IN (:...closedStatuses)', {
        closedStatuses: [
          ActivityStatus.Done,
          ActivityStatus.Cancelled,
          ActivityStatus.Archived,
        ],
      })
      .orderBy('activity.due_at', 'ASC', 'NULLS LAST')
      .addOrderBy('activity.updated_at', 'DESC')
      .take(30)
      .getMany();

    const items = openActivities
      .map((activity) => ({
        id: activity.id,
        type: activity.type,
        summary: activity.summary,
        assignedToId: activity.assignedToId,
        assignedToName: null as string | null,
        dueAt: activity.dueAt ? activity.dueAt.toISOString() : null,
        overdue: activity.dueAt !== null && activity.dueAt.getTime() < now.getTime(),
        href: '/projects/activities',
      }))
      .sort((a, b) => {
        if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
        if (a.dueAt === null && b.dueAt === null) return 0;
        if (a.dueAt === null) return 1;
        if (b.dueAt === null) return -1;
        return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
      });

    return {
      total: Object.values(byStatus).reduce((sum, count) => sum + count, 0),
      byStatus,
      overdue: overdueCount,
      myOpen: myOpenCount,
      items,
    };
  }

  async findOne(context: RequestContext, id: string) {
    const activity = await this.activitiesRepository.findOne({
      where: {
        id,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (!activity || activity.archivedAt) {
      throw new NotFoundException('Activity not found');
    }

    if (
      activity.visibility === ActivityVisibility.Private &&
      activity.createdById !== context.userId &&
      activity.assignedToId !== context.userId
    ) {
      throw new NotFoundException('Activity not found');
    }

    const links = await this.linksRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        activityId: activity.id,
      },
      order: { createdAt: 'ASC' },
    });

    return { ...activity, links };
  }

  async create(context: RequestContext, dto: CreateActivityDto) {
    this.validateBusinessRules(dto.type, dto.entityType);

    const activity = this.activitiesRepository.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      type: dto.type,
      subtype: dto.subtype ?? null,
      status: dto.status ?? ActivityStatus.Todo,
      priority: dto.priority,
      summary: dto.summary,
      note: dto.note ?? null,
      completionFeedback: null,
      dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
      startAt: dto.startAt ? new Date(dto.startAt) : null,
      endAt: dto.endAt ? new Date(dto.endAt) : null,
      completedAt: null,
      cancelledAt: null,
      archivedAt: null,
      assignedToId: dto.assignedToId ?? null,
      createdById: context.userId,
      completedById: null,
      cancelledById: null,
      sourceModule: dto.sourceModule ?? null,
      visibility: dto.visibility ?? ActivityVisibility.Workspace,
      metadata: dto.metadata ?? {},
    });

    const saved = await this.activitiesRepository.save(activity);

    if (dto.entityType && dto.entityId) {
      await this.createLink(context, saved.id, {
        entityType: dto.entityType,
        entityId: dto.entityId,
        relationType: dto.relationType ?? ActivityRelationType.RelatedTo,
      });
    }

    return this.findOne(context, saved.id);
  }

  async update(context: RequestContext, id: string, dto: UpdateActivityDto) {
    const activity = await this.activitiesRepository.findOne({
      where: {
        id,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (!activity || activity.archivedAt) {
      throw new NotFoundException('Activity not found');
    }

    if (dto.type !== undefined) activity.type = dto.type;
    if (dto.subtype !== undefined) activity.subtype = dto.subtype;
    if (dto.status !== undefined) activity.status = dto.status;
    if (dto.priority !== undefined) activity.priority = dto.priority;
    if (dto.summary !== undefined) activity.summary = dto.summary;
    if (dto.note !== undefined) activity.note = dto.note;
    if (dto.assignedToId !== undefined) activity.assignedToId = dto.assignedToId;
    if (dto.sourceModule !== undefined) activity.sourceModule = dto.sourceModule;
    if (dto.visibility !== undefined) activity.visibility = dto.visibility;
    if (dto.metadata !== undefined) activity.metadata = dto.metadata;

    if (dto.dueAt !== undefined) activity.dueAt = dto.dueAt ? new Date(dto.dueAt) : null;
    if (dto.startAt !== undefined) activity.startAt = dto.startAt ? new Date(dto.startAt) : null;
    if (dto.endAt !== undefined) activity.endAt = dto.endAt ? new Date(dto.endAt) : null;

    if (dto.status === ActivityStatus.Done && !activity.completedAt) {
      activity.completedAt = new Date();
      activity.completedById = context.userId;
    }

    if (dto.status && dto.status !== ActivityStatus.Done) {
      activity.completedAt = null;
      activity.completedById = null;
    }

    if (dto.status === ActivityStatus.Cancelled && !activity.cancelledAt) {
      activity.cancelledAt = new Date();
      activity.cancelledById = context.userId;
    }

    return this.activitiesRepository.save(activity);
  }

  async archive(context: RequestContext, id: string) {
    const activity = await this.activitiesRepository.findOne({
      where: {
        id,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (!activity || activity.archivedAt) {
      throw new NotFoundException('Activity not found');
    }

    await this.activitiesRepository.remove(activity);

    return { deleted: true };
  }

  async complete(context: RequestContext, id: string, dto: CompleteActivityDto) {
    const activity = await this.activitiesRepository.findOne({
      where: {
        id,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (!activity || activity.archivedAt) {
      throw new NotFoundException('Activity not found');
    }

    activity.status = ActivityStatus.Done;
    activity.completedAt = new Date();
    activity.completedById = context.userId;
    activity.completionFeedback = dto.feedback ?? null;

    return this.activitiesRepository.save(activity);
  }

  async completeAndScheduleNext(
    context: RequestContext,
    id: string,
    dto: CompleteAndScheduleNextActivityDto,
  ) {
    const previousLinks = await this.linksRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        activityId: id,
      },
      order: { createdAt: 'ASC' },
    });

    const completed = await this.complete(context, id, dto.completion);
    const next = await this.create(context, dto.nextActivity);

    const shouldInheritLinks =
      !dto.nextActivity.entityType &&
      !dto.nextActivity.entityId &&
      previousLinks.length > 0;

    if (shouldInheritLinks) {
      for (const link of previousLinks) {
        await this.createLink(context, next.id, {
          entityType: link.entityType,
          entityId: link.entityId,
          relationType: link.relationType,
        });
      }
    }

    const nextWithLinks = await this.findOne(context, next.id);

    return {
      completed,
      next: nextWithLinks,
    };
  }

  async cancel(context: RequestContext, id: string, dto: CancelActivityDto) {
    const activity = await this.activitiesRepository.findOne({
      where: {
        id,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (!activity || activity.archivedAt) {
      throw new NotFoundException('Activity not found');
    }

    activity.status = ActivityStatus.Cancelled;
    activity.cancelledAt = new Date();
    activity.cancelledById = context.userId;
    activity.metadata = {
      ...(activity.metadata ?? {}),
      cancellationReason: dto.reason ?? null,
    };

    return this.activitiesRepository.save(activity);
  }

  async createLink(context: RequestContext, activityId: string, dto: CreateActivityLinkDto) {
    await this.ensureActivityExists(context, activityId);

    const link = this.linksRepository.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      activityId,
      entityType: dto.entityType,
      entityId: dto.entityId,
      relationType: dto.relationType ?? ActivityRelationType.RelatedTo,
    });

    return this.linksRepository.save(link);
  }

  async deleteLink(context: RequestContext, activityId: string, linkId: string) {
    await this.ensureActivityExists(context, activityId);

    const link = await this.linksRepository.findOne({
      where: {
        id: linkId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        activityId,
      },
    });

    if (!link) {
      throw new NotFoundException('Activity link not found');
    }

    await this.linksRepository.delete(link.id);

    return { success: true };
  }

  private async ensureActivityExists(context: RequestContext, activityId: string) {
    const activity = await this.activitiesRepository.findOne({
      where: {
        id: activityId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (!activity || activity.archivedAt) {
      throw new NotFoundException('Activity not found');
    }

    return activity;
  }

  private validateBusinessRules(type: ActivityType, entityType?: ActivityEntityType) {
    if (
      type === ActivityType.Document &&
      entityType &&
      ![ActivityEntityType.Project, ActivityEntityType.Task].includes(entityType)
    ) {
      throw new BadRequestException('Document activities must be linked to project or task context.');
    }
  }

  private applyFilters(
    qb: ReturnType<Repository<AgencyActivity>['createQueryBuilder']>,
    query: ListActivitiesQueryDto,
  ) {
    if (query.search) {
      qb.andWhere(
        new Brackets((subQb) => {
          subQb
            .where('activity.summary ILIKE :search', { search: `%${query.search}%` })
            .orWhere('activity.note ILIKE :search', { search: `%${query.search}%` });
        }),
      );
    }

    if (query.type) qb.andWhere('activity.type = :type', { type: query.type });
    if (query.subtype) qb.andWhere('activity.subtype = :subtype', { subtype: query.subtype });
    if (query.status) qb.andWhere('activity.status = :status', { status: query.status });
    if (query.priority) qb.andWhere('activity.priority = :priority', { priority: query.priority });
    if (query.assignedToId) qb.andWhere('activity.assigned_to_id = :assignedToId', { assignedToId: query.assignedToId });
    if (query.sourceModule) qb.andWhere('activity.source_module = :sourceModule', { sourceModule: query.sourceModule });
    if (query.visibility) qb.andWhere('activity.visibility = :visibility', { visibility: query.visibility });
    if (query.dueFrom) qb.andWhere('activity.due_at >= :dueFrom', { dueFrom: new Date(query.dueFrom) });
    if (query.dueTo) qb.andWhere('activity.due_at <= :dueTo', { dueTo: new Date(query.dueTo) });
  }
}
