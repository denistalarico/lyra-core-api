import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, MoreThan, Repository } from 'typeorm';
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
import { ActivityNotificationPublisher } from './activity-notification.publisher';
import { EmailService } from '../../email/email.service';

type RequestContext = {
  tenantId: string;
  workspaceId: string;
  userId: string;
};

const AGENCY_CONNECTION = 'agency';
const MAX_TIMER_DELAY_MS = 2_147_483_647;

type ActivityReminderChannel = 'in_app' | 'email' | 'whatsapp';

type ActivityReminderConfig = {
  enabled: boolean;
  offsetMinutes: number;
  channels: ActivityReminderChannel[];
};

@Injectable()
export class ActivitiesService implements OnModuleInit {
  private readonly logger = new Logger(ActivitiesService.name);
  private readonly reminderTimers = new Map<
    string,
    ReturnType<typeof setTimeout>[]
  >();

  constructor(
    @InjectRepository(AgencyActivity, AGENCY_CONNECTION)
    private readonly activitiesRepository: Repository<AgencyActivity>,
    @InjectRepository(AgencyActivityLink, AGENCY_CONNECTION)
    private readonly linksRepository: Repository<AgencyActivityLink>,
    private readonly activityNotificationPublisher: ActivityNotificationPublisher,
    private readonly emailService: EmailService,
  ) {}

  onModuleInit() {
    void this.schedulePersistedActivityReminders();
  }

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
        description:
          'Atividade de e-mail para proposta, follow-up ou aprovação.',
        icon: 'mail',
        color: 'blue',
        subtypes: [
          'proposal',
          'follow_up',
          'presentation',
          'pending_request',
          'approval',
          'marketing',
          'other',
        ],
        availableActions: ['save', 'complete', 'cancel', 'send_email'],
      },
      {
        type: ActivityType.Call,
        label: 'Ligação',
        description: 'Ligação comercial, operacional ou de suporte.',
        icon: 'phone',
        color: 'green',
        subtypes: [
          'discovery',
          'follow_up',
          'alignment',
          'negotiation',
          'closing',
          'support',
          'other',
        ],
        availableActions: ['save', 'complete', 'cancel', 'call'],
      },
      {
        type: ActivityType.Task,
        label: 'Tarefa',
        description:
          'Ação simples e transversal, sem substituir Tasks de projetos.',
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
        description:
          'Reunião, briefing, apresentação, aprovação ou alinhamento.',
        icon: 'calendar-days',
        color: 'indigo',
        subtypes: [
          'briefing',
          'alignment',
          'presentation',
          'approval',
          'follow_up',
          'closing',
          'other',
        ],
        availableActions: ['save', 'complete', 'cancel', 'schedule_meeting'],
      },
      {
        type: ActivityType.Document,
        label: 'Documento',
        description:
          'Atividade documental vinculada preferencialmente a projeto ou tarefa.',
        icon: 'file-text',
        color: 'rose',
        subtypes: [],
        availableActions: ['save', 'complete', 'cancel', 'upload_document'],
      },
    ];
  }

  /**
   * Attaches each activity's links in a single batch query. The list endpoints
   * return bare entities (no eager `links` relation), but the frontend relies on
   * `activity.links` to map an activity back to its source entity (e.g. a CRM
   * opportunity card). Without this, list results lose their links and the card
   * appears to "drop" the activity on the next full reload.
   */
  private async attachLinks<T extends { id: string }>(
    context: RequestContext,
    activities: T[],
  ): Promise<(T & { links: AgencyActivityLink[] })[]> {
    if (activities.length === 0) {
      return [];
    }

    const links = await this.linksRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        activityId: In(activities.map((activity) => activity.id)),
      },
      order: { createdAt: 'ASC' },
    });

    const linksByActivity = new Map<string, AgencyActivityLink[]>();
    for (const link of links) {
      const current = linksByActivity.get(link.activityId) ?? [];
      current.push(link);
      linksByActivity.set(link.activityId, current);
    }

    return activities.map((activity) => ({
      ...activity,
      links: linksByActivity.get(activity.id) ?? [],
    }));
  }

  async list(context: RequestContext, query: ListActivitiesQueryDto) {
    const qb = this.activitiesRepository
      .createQueryBuilder('activity')
      .where('activity.tenant_id = :tenantId', { tenantId: context.tenantId })
      .andWhere('activity.workspace_id = :workspaceId', {
        workspaceId: context.workspaceId,
      });

    if (query.includeArchived !== 'true') {
      qb.andWhere('activity.archived_at IS NULL');
    }

    this.applyFilters(qb, query);

    const activities = await qb
      .orderBy('activity.due_at', 'ASC', 'NULLS LAST')
      .addOrderBy('activity.updated_at', 'DESC')
      .getMany();

    return this.attachLinks(context, activities);
  }

  async listByContext(
    context: RequestContext,
    entityType: ActivityEntityType,
    entityId: string,
  ) {
    const activities = await this.activitiesRepository
      .createQueryBuilder('activity')
      .innerJoin(
        AgencyActivityLink,
        'link',
        'link.activity_id = activity.id AND link.tenant_id = activity.tenant_id AND link.workspace_id = activity.workspace_id',
      )
      .where('activity.tenant_id = :tenantId', { tenantId: context.tenantId })
      .andWhere('activity.workspace_id = :workspaceId', {
        workspaceId: context.workspaceId,
      })
      .andWhere('activity.archived_at IS NULL')
      .andWhere('link.entity_type = :entityType', { entityType })
      .andWhere('link.entity_id = :entityId', { entityId })
      .orderBy('activity.due_at', 'ASC', 'NULLS LAST')
      .addOrderBy('activity.updated_at', 'DESC')
      .getMany();

    return this.attachLinks(context, activities);
  }

  async listMyActivities(context: RequestContext, query: ListActivitiesQueryDto) {
    const qb = this.activitiesRepository
      .createQueryBuilder('activity')
      .where('activity.tenant_id = :tenantId', { tenantId: context.tenantId })
      .andWhere('activity.workspace_id = :workspaceId', {
        workspaceId: context.workspaceId,
      })
      .andWhere('activity.archived_at IS NULL')
      .andWhere(
        new Brackets((subQb) => {
          subQb
            .where('activity.assigned_to_id = :userId', {
              userId: context.userId,
            })
            .orWhere(
              'activity.created_by_id = :userId AND activity.visibility = :privateVisibility',
              {
                userId: context.userId,
                privateVisibility: ActivityVisibility.Private,
              },
            );
        }),
      );

    this.applyFilters(qb, query);

    const activities = await qb
      .orderBy('activity.due_at', 'ASC', 'NULLS LAST')
      .addOrderBy('activity.updated_at', 'DESC')
      .getMany();

    return this.attachLinks(context, activities);
  }

  async listOverdueActivities(
    context: RequestContext,
    query: ListActivitiesQueryDto,
  ) {
    const now = new Date();

    const qb = this.activitiesRepository
      .createQueryBuilder('activity')
      .where('activity.tenant_id = :tenantId', { tenantId: context.tenantId })
      .andWhere('activity.workspace_id = :workspaceId', {
        workspaceId: context.workspaceId,
      })
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

    const activities = await qb
      .orderBy('activity.due_at', 'ASC')
      .addOrderBy('activity.updated_at', 'DESC')
      .getMany();

    return this.attachLinks(context, activities);
  }

  async getSummary(context: RequestContext) {
    const qb = this.activitiesRepository
      .createQueryBuilder('activity')
      .select('activity.status', 'status')
      .addSelect('COUNT(activity.id)', 'count')
      .where('activity.tenant_id = :tenantId', { tenantId: context.tenantId })
      .andWhere('activity.workspace_id = :workspaceId', {
        workspaceId: context.workspaceId,
      })
      .andWhere('activity.archived_at IS NULL')
      .groupBy('activity.status');

    const byStatusRows = await qb.getRawMany<{
      status: string;
      count: string;
    }>();

    const overdueCount = await this.activitiesRepository
      .createQueryBuilder('activity')
      .where('activity.tenant_id = :tenantId', { tenantId: context.tenantId })
      .andWhere('activity.workspace_id = :workspaceId', {
        workspaceId: context.workspaceId,
      })
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
      .andWhere('activity.workspace_id = :workspaceId', {
        workspaceId: context.workspaceId,
      })
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
      .andWhere('activity.workspace_id = :workspaceId', {
        workspaceId: context.workspaceId,
      })
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
        overdue:
          activity.dueAt !== null && activity.dueAt.getTime() < now.getTime(),
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

  async create(
    context: RequestContext,
    dto: CreateActivityDto,
    options: { skipAssignedNotification?: boolean } = {},
  ) {
    this.validateBusinessRules(dto.type, dto.entityType);
    this.validateActivityDates({
      dueAt: dto.dueAt ?? null,
      startAt: dto.startAt ?? null,
      endAt: dto.endAt ?? null,
    });

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

    if (saved.assignedToId && !options.skipAssignedNotification) {
      const links = await this.linksRepository.find({
        where: {
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          activityId: saved.id,
        },
      });

      await this.activityNotificationPublisher.publishAssigned({
        activity: saved,
        links,
        actorUserId: context.userId,
      });
    }

    this.scheduleActivityReminder(saved);

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

    const previousAssignedToId = activity.assignedToId;
    const wasCompleted = activity.status === ActivityStatus.Done;
    const wasCancelled = activity.status === ActivityStatus.Cancelled;
    const previous = this.snapshotActivity(activity);
    const nextDueAt =
      dto.dueAt !== undefined
        ? dto.dueAt
        : (activity.dueAt?.toISOString() ?? null);
    const nextStartAt =
      dto.startAt !== undefined
        ? dto.startAt
        : (activity.startAt?.toISOString() ?? null);
    const nextEndAt =
      dto.endAt !== undefined
        ? dto.endAt
        : (activity.endAt?.toISOString() ?? null);

    this.validateActivityDates({
      dueAt: nextDueAt,
      startAt: nextStartAt,
      endAt: nextEndAt,
      checkDueAt: dto.dueAt !== undefined,
      checkStartAt: dto.startAt !== undefined,
    });

    if (dto.type !== undefined) activity.type = dto.type;
    if (dto.subtype !== undefined) activity.subtype = dto.subtype;
    if (dto.status !== undefined) activity.status = dto.status;
    if (dto.priority !== undefined) activity.priority = dto.priority;
    if (dto.summary !== undefined) activity.summary = dto.summary;
    if (dto.note !== undefined) activity.note = dto.note;
    if (dto.assignedToId !== undefined)
      activity.assignedToId = dto.assignedToId;
    if (dto.sourceModule !== undefined)
      activity.sourceModule = dto.sourceModule;
    if (dto.visibility !== undefined) activity.visibility = dto.visibility;
    if (dto.metadata !== undefined) activity.metadata = dto.metadata;

    if (dto.dueAt !== undefined)
      activity.dueAt = dto.dueAt ? new Date(dto.dueAt) : null;
    if (dto.startAt !== undefined)
      activity.startAt = dto.startAt ? new Date(dto.startAt) : null;
    if (dto.endAt !== undefined)
      activity.endAt = dto.endAt ? new Date(dto.endAt) : null;

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

    const saved = await this.activitiesRepository.save(activity);
    this.scheduleActivityReminder(saved, previous);

    if (
      (saved.assignedToId && saved.assignedToId !== previousAssignedToId) ||
      (saved.status === ActivityStatus.Done && !wasCompleted) ||
      (saved.status === ActivityStatus.Cancelled && !wasCancelled)
    ) {
      const links = await this.linksRepository.find({
        where: {
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          activityId: saved.id,
        },
      });

      if (saved.assignedToId && saved.assignedToId !== previousAssignedToId) {
        if (!previousAssignedToId) {
          await this.activityNotificationPublisher.publishAssigned({
            activity: saved,
            links,
            actorUserId: context.userId,
          });
        } else {
          await this.activityNotificationPublisher.publishReassigned({
            activity: saved,
            links,
            actorUserId: context.userId,
            previousAssignedToId,
          });
        }
      }

      if (saved.status === ActivityStatus.Done && !wasCompleted) {
        await this.activityNotificationPublisher.publishCompleted({
          activity: saved,
          links,
          actorUserId: context.userId,
        });
      }

      if (saved.status === ActivityStatus.Cancelled && !wasCancelled) {
        await this.activityNotificationPublisher.publishCanceled({
          activity: saved,
          links,
          actorUserId: context.userId,
        });
      }
    }

    return saved;
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

    activity.archivedAt = new Date();
    activity.status = ActivityStatus.Archived;

    const saved = await this.activitiesRepository.save(activity);
    this.clearReminderTimers(saved.id);

    return saved;
  }

  async remove(context: RequestContext, id: string) {
    const activity = await this.activitiesRepository.findOne({
      where: {
        id,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (!activity) {
      throw new NotFoundException('Activity not found');
    }

    await this.activitiesRepository.remove(activity);
    this.clearReminderTimers(activity.id);

    return { deleted: true };
  }

  async complete(
    context: RequestContext,
    id: string,
    dto: CompleteActivityDto,
  ) {
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

    const wasCompleted = activity.status === ActivityStatus.Done;

    activity.status = ActivityStatus.Done;
    activity.completedAt = new Date();
    activity.completedById = context.userId;
    activity.completionFeedback = dto.feedback ?? null;

    const saved = await this.activitiesRepository.save(activity);
    this.clearReminderTimers(saved.id);

    if (!wasCompleted) {
      const links = await this.linksRepository.find({
        where: {
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          activityId: saved.id,
        },
      });

      await this.activityNotificationPublisher.publishCompleted({
        activity: saved,
        links,
        actorUserId: context.userId,
      });
    }

    return saved;
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
    const next = await this.create(context, dto.nextActivity, {
      skipAssignedNotification: true,
    });

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

    if (nextWithLinks.assignedToId) {
      const nextLinks = await this.linksRepository.find({
        where: {
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          activityId: next.id,
        },
      });

      await this.activityNotificationPublisher.publishFollowUpCreated({
        activity: nextWithLinks,
        links: nextLinks,
        actorUserId: context.userId,
        parentActivityId: id,
      });
    }

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

    const wasCancelled = activity.status === ActivityStatus.Cancelled;

    activity.status = ActivityStatus.Cancelled;
    activity.cancelledAt = new Date();
    activity.cancelledById = context.userId;
    activity.metadata = {
      ...(activity.metadata ?? {}),
      cancellationReason: dto.reason ?? null,
    };

    const saved = await this.activitiesRepository.save(activity);
    this.clearReminderTimers(saved.id);

    if (!wasCancelled) {
      const links = await this.linksRepository.find({
        where: {
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          activityId: saved.id,
        },
      });

      await this.activityNotificationPublisher.publishCanceled({
        activity: saved,
        links,
        actorUserId: context.userId,
      });
    }

    return saved;
  }

  async createLink(
    context: RequestContext,
    activityId: string,
    dto: CreateActivityLinkDto,
  ) {
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

  async deleteLink(
    context: RequestContext,
    activityId: string,
    linkId: string,
  ) {
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

  private async ensureActivityExists(
    context: RequestContext,
    activityId: string,
  ) {
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

  private validateBusinessRules(
    type: ActivityType,
    entityType?: ActivityEntityType,
  ) {
    if (
      type === ActivityType.Document &&
      entityType &&
      ![ActivityEntityType.Project, ActivityEntityType.Task].includes(
        entityType,
      )
    ) {
      throw new BadRequestException(
        'Document activities must be linked to project or task context.',
      );
    }
  }

  private validateActivityDates(input: {
    dueAt?: string | null;
    startAt?: string | null;
    endAt?: string | null;
    checkDueAt?: boolean;
    checkStartAt?: boolean;
  }) {
    const startAt = input.startAt ? new Date(input.startAt) : null;
    const endAt = input.endAt ? new Date(input.endAt) : null;
    const dueAt = input.dueAt ? new Date(input.dueAt) : null;
    const now = Date.now();

    if (startAt && Number.isNaN(startAt.getTime())) {
      throw new BadRequestException('startAt must be a valid date');
    }

    if (endAt && Number.isNaN(endAt.getTime())) {
      throw new BadRequestException('endAt must be a valid date');
    }

    if (dueAt && Number.isNaN(dueAt.getTime())) {
      throw new BadRequestException('dueAt must be a valid date');
    }

    if (startAt && endAt && endAt <= startAt) {
      throw new BadRequestException('endAt must be after startAt');
    }

    if ((input.checkStartAt ?? true) && startAt && startAt.getTime() < now) {
      throw new BadRequestException('startAt must not be in the past');
    }

    if (
      !startAt &&
      (input.checkDueAt ?? true) &&
      dueAt &&
      dueAt.getTime() < now
    ) {
      throw new BadRequestException('dueAt must not be in the past');
    }
  }

  private snapshotActivity(activity: AgencyActivity) {
    return {
      summary: activity.summary,
      note: activity.note,
      dueAt: activity.dueAt,
      startAt: activity.startAt,
      endAt: activity.endAt,
      assignedToId: activity.assignedToId,
      metadata: activity.metadata,
    };
  }

  private getActivityReminderBaseDate(activity: AgencyActivity) {
    return activity.startAt ?? activity.dueAt;
  }

  private scheduleActivityReminder(
    activity: AgencyActivity,
    previous?: ReturnType<ActivitiesService['snapshotActivity']>,
  ) {
    if (previous && !this.shouldRescheduleReminder(activity, previous)) {
      return;
    }

    this.clearReminderTimers(activity.id);

    const baseDate = this.getActivityReminderBaseDate(activity);
    if (!baseDate || baseDate.getTime() < Date.now()) {
      return;
    }

    const config = this.getActivityReminderConfig(activity);
    if (!config?.enabled || config.channels.length === 0) {
      return;
    }

    const reminderAt = new Date(
      baseDate.getTime() - config.offsetMinutes * 60_000,
    );
    const run = () => {
      void this.dispatchActivityReminder(activity, config, reminderAt).catch(
        (error) => {
          this.logger.warn(
            `Failed to dispatch activity reminder for ${activity.id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        },
      );
    };

    if (reminderAt.getTime() <= Date.now()) {
      run();
      return;
    }

    this.registerReminderTimer(activity.id, reminderAt, run);
  }

  private async schedulePersistedActivityReminders() {
    try {
      const activities = await this.activitiesRepository.find({
        where: [
          { startAt: MoreThan(new Date()) } as any,
          { dueAt: MoreThan(new Date()) } as any,
        ],
        order: { startAt: 'ASC', dueAt: 'ASC' } as any,
      });

      for (const activity of activities) {
        this.scheduleActivityReminder(activity);
      }
    } catch (error) {
      this.logger.warn(
        `Failed to schedule persisted activity reminders: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private registerReminderTimer(
    activityId: string,
    targetAt: Date,
    callback: () => void,
  ) {
    const delay = targetAt.getTime() - Date.now();
    const timer = setTimeout(
      () => {
        const remaining = targetAt.getTime() - Date.now();
        if (remaining > 0) {
          this.registerReminderTimer(activityId, targetAt, callback);
          return;
        }

        callback();
      },
      Math.min(Math.max(delay, 0), MAX_TIMER_DELAY_MS),
    );
    const timers = this.reminderTimers.get(activityId) ?? [];
    timers.push(timer);
    this.reminderTimers.set(activityId, timers);
  }

  private clearReminderTimers(activityId: string) {
    const timers = this.reminderTimers.get(activityId) ?? [];
    for (const timer of timers) {
      clearTimeout(timer);
    }
    this.reminderTimers.delete(activityId);
  }

  private async dispatchActivityReminder(
    activity: AgencyActivity,
    config: ActivityReminderConfig,
    reminderAt: Date,
  ) {
    this.clearReminderTimers(activity.id);

    const links = await this.linksRepository.find({
      where: {
        tenantId: activity.tenantId,
        workspaceId: activity.workspaceId,
        activityId: activity.id,
      },
    });

    if (config.channels.includes('in_app')) {
      await this.activityNotificationPublisher.publishReminder({
        activity,
        links,
        actorUserId: null,
        offsetMinutes: config.offsetMinutes,
        reminderAt,
      });
    }

    if (config.channels.includes('email')) {
      await this.sendActivityReminderEmails(activity);
    }
  }

  private async sendActivityReminderEmails(activity: AgencyActivity) {
    const metadata = activity.metadata ?? {};
    const participantEmails = this.metadataStringList(
      metadata,
      'participantEmails',
    );

    if (participantEmails.length === 0) {
      return;
    }

    const meetingUrl = this.metadataString(metadata, 'meetingUrl');
    const startsAt = this.getActivityReminderBaseDate(activity) ?? new Date();
    const endsAt =
      activity.endAt ?? new Date(startsAt.getTime() + 60 * 60 * 1000);
    const results = await Promise.allSettled(
      participantEmails.map((email) =>
        this.emailService.sendCalendarReminderEmail({
          to: email,
          eventTitle: activity.summary,
          startsAt,
          endsAt,
          description: activity.note,
          meetingUrl: meetingUrl || null,
        }),
      ),
    );
    const failed = results.filter((result) => result.status === 'rejected');

    if (failed.length > 0) {
      this.logger.warn(
        `Failed to send ${failed.length} activity reminder email(s) for activity ${activity.id}`,
      );
    }
  }

  private shouldRescheduleReminder(
    activity: AgencyActivity,
    previous: ReturnType<ActivitiesService['snapshotActivity']>,
  ) {
    return (
      previous.summary !== activity.summary ||
      previous.note !== activity.note ||
      previous.assignedToId !== activity.assignedToId ||
      (previous.dueAt?.getTime() ?? null) !==
        (activity.dueAt?.getTime() ?? null) ||
      (previous.startAt?.getTime() ?? null) !==
        (activity.startAt?.getTime() ?? null) ||
      (previous.endAt?.getTime() ?? null) !==
        (activity.endAt?.getTime() ?? null) ||
      JSON.stringify(previous.metadata ?? {}) !==
        JSON.stringify(activity.metadata ?? {})
    );
  }

  private getActivityReminderConfig(
    activity: AgencyActivity,
  ): ActivityReminderConfig | null {
    const metadata = activity.metadata ?? {};
    const reminder = this.metadataRecord(metadata, 'activityReminder');

    if (reminder.enabled === false) {
      return null;
    }

    if (reminder.enabled !== true) {
      return null;
    }

    const offsetMinutes =
      typeof reminder.offsetMinutes === 'number' &&
      Number.isFinite(reminder.offsetMinutes) &&
      reminder.offsetMinutes > 0
        ? Math.round(reminder.offsetMinutes)
        : 60;

    return {
      enabled: true,
      offsetMinutes,
      channels: this.metadataChannelList(reminder.channels),
    };
  }

  private metadataRecord(metadata: Record<string, unknown>, key: string) {
    const value = metadata[key];
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private metadataString(metadata: Record<string, unknown>, key: string) {
    const value = metadata[key];
    return typeof value === 'string' ? value.trim() : '';
  }

  private metadataStringList(metadata: Record<string, unknown>, key: string) {
    const value = metadata[key];
    const items = Array.isArray(value) ? value : [];
    const unique = new Set<string>();

    for (const item of items) {
      if (typeof item !== 'string') continue;
      const email = item.trim().toLowerCase();
      if (!email || !email.includes('@')) continue;
      unique.add(email);
    }

    return [...unique];
  }

  private metadataChannelList(value: unknown): ActivityReminderChannel[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const allowed = new Set<ActivityReminderChannel>([
      'in_app',
      'email',
      'whatsapp',
    ]);
    const unique = new Set<ActivityReminderChannel>();

    for (const item of value) {
      if (typeof item !== 'string') continue;
      if (!allowed.has(item as ActivityReminderChannel)) continue;
      unique.add(item as ActivityReminderChannel);
    }

    return [...unique];
  }

  private applyFilters(
    qb: ReturnType<Repository<AgencyActivity>['createQueryBuilder']>,
    query: ListActivitiesQueryDto,
  ) {
    if (query.search) {
      qb.andWhere(
        new Brackets((subQb) => {
          subQb
            .where('activity.summary ILIKE :search', {
              search: `%${query.search}%`,
            })
            .orWhere('activity.note ILIKE :search', {
              search: `%${query.search}%`,
            });
        }),
      );
    }

    if (query.type) qb.andWhere('activity.type = :type', { type: query.type });
    if (query.subtype)
      qb.andWhere('activity.subtype = :subtype', { subtype: query.subtype });
    if (query.status)
      qb.andWhere('activity.status = :status', { status: query.status });
    if (query.priority)
      qb.andWhere('activity.priority = :priority', {
        priority: query.priority,
      });
    if (query.assignedToId)
      qb.andWhere('activity.assigned_to_id = :assignedToId', {
        assignedToId: query.assignedToId,
      });
    if (query.sourceModule)
      qb.andWhere('activity.source_module = :sourceModule', {
        sourceModule: query.sourceModule,
      });
    if (query.visibility)
      qb.andWhere('activity.visibility = :visibility', {
        visibility: query.visibility,
      });
    if (query.dueFrom)
      qb.andWhere('activity.due_at >= :dueFrom', {
        dueFrom: new Date(query.dueFrom),
      });
    if (query.dueTo)
      qb.andWhere('activity.due_at <= :dueTo', {
        dueTo: new Date(query.dueTo),
      });
  }
}
