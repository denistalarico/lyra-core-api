import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  FindOptionsWhere,
  IsNull,
  Repository,
} from 'typeorm';
import { RequestContext } from '../../common/context/request-context.interface';
import { InboxDomainOutboxEntity } from '../inbox/entities/inbox-domain-outbox.entity';
import { TeamChatMeetingsService } from '../team-chat/services/team-chat-meetings.service';
import type { LeadFlowEventName } from '../leadflow-events/types/leadflow-event.types';
import { CreateScheduledItemDto } from './dto/create-scheduled-item.dto';
import { CreateScheduledItemParticipantDto } from './dto/create-scheduled-item-participant.dto';
import { CreateScheduledItemReminderDto } from './dto/create-scheduled-item-reminder.dto';
import {
  AppointmentLifecycleStatus,
  APPOINTMENT_LIFECYCLE_STATUSES,
  PatchAppointmentLifecycleStatusDto,
} from './dto/patch-appointment-lifecycle-status.dto';
import { PatchScheduledItemDto } from './dto/patch-scheduled-item.dto';
import { PatchScheduledItemParticipantResponseDto } from './dto/patch-scheduled-item-participant-response.dto';
import { PatchScheduledItemStatusDto } from './dto/patch-scheduled-item-status.dto';
import { ScheduledItemEntity } from './entities/scheduled-item.entity';
import { ScheduledItemParticipantEntity } from './entities/scheduled-item-participant.entity';
import { ScheduledItemReminderEntity } from './entities/scheduled-item-reminder.entity';

const AGENCY_CONNECTION = 'agency';

export type ScheduledItemsFilters = {
  type?: string;
  status?: string;
  priority?: string;
  assignedUserId?: string;
  contactId?: string;
  sourceChannel?: string;
};

@Injectable()
export class AppointmentsService {
  constructor(
    @InjectDataSource(AGENCY_CONNECTION)
    private readonly dataSource: DataSource,

    @InjectRepository(ScheduledItemEntity, AGENCY_CONNECTION)
    private readonly scheduledItemsRepository: Repository<ScheduledItemEntity>,

    @InjectRepository(ScheduledItemParticipantEntity, AGENCY_CONNECTION)
    private readonly participantsRepository: Repository<ScheduledItemParticipantEntity>,

    @InjectRepository(ScheduledItemReminderEntity, AGENCY_CONNECTION)
    private readonly remindersRepository: Repository<ScheduledItemReminderEntity>,

    private readonly teamChatMeetingsService: TeamChatMeetingsService,
  ) {}

  async listScheduledItems(
    ctx: RequestContext,
    filters: ScheduledItemsFilters = {},
  ): Promise<ScheduledItemEntity[]> {
    const tenantId = this.requireTenantId(ctx);
    const workspaceId = this.requireWorkspaceId(ctx);

    const where: FindOptionsWhere<ScheduledItemEntity> = {
      tenantId,
      workspaceId,
      deletedAt: IsNull(),
    };

    if (filters.type) {
      where.type = filters.type;
    }

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.priority) {
      where.priority = filters.priority;
    }

    if (filters.assignedUserId) {
      where.assignedUserId = filters.assignedUserId;
    }

    if (filters.contactId) {
      where.contactId = filters.contactId;
    }

    if (filters.sourceChannel) {
      where.sourceChannel = filters.sourceChannel;
    }

    return this.scheduledItemsRepository.find({
      where,
      order: {
        startAt: 'ASC',
        dueAt: 'ASC',
        createdAt: 'DESC',
      },
    });
  }

  async createScheduledItem(
    ctx: RequestContext,
    dto: CreateScheduledItemDto,
  ): Promise<ScheduledItemEntity> {
    const tenantId = this.requireTenantId(ctx);
    const workspaceId = this.requireWorkspaceId(ctx);

    this.validateDateRange(dto.startAt, dto.endAt);
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(ScheduledItemEntity);
      const item = repository.create({
        id: randomUUID(),
        tenantId,
        workspaceId,
        type: dto.type,
        status: dto.status ?? 'scheduled',
        priority: dto.priority ?? 'medium',
        title: dto.title,
        description: dto.description ?? null,
        notes: dto.notes ?? null,
        startAt: this.toDateOrNull(dto.startAt),
        endAt: this.toDateOrNull(dto.endAt),
        dueAt: this.toDateOrNull(dto.dueAt),
        allDay: dto.allDay ?? false,
        timezone: dto.timezone ?? null,
        locationType: dto.locationType ?? 'none',
        locationText: dto.locationText ?? null,
        videoMode: dto.videoMode ?? null,
        videoUrl: dto.videoUrl ?? null,
        phoneUrl: dto.phoneUrl ?? null,
        visibility: dto.visibility ?? 'workspace',
        ownerUserId: dto.ownerUserId ?? this.getUserId(ctx),
        assignedUserId: dto.assignedUserId ?? null,
        createdByUserId: this.getUserId(ctx),
        contactId: dto.contactId ?? null,
        sourceChannel: dto.sourceChannel ?? 'manual',
        sourceConversationId: dto.sourceConversationId ?? null,
        sourceLeadId: dto.sourceLeadId ?? null,
        sourceOpportunityId: dto.sourceOpportunityId ?? null,
        metadata: dto.metadata ?? {},
      });
      const lifecycleStatus = this.resolveLifecycleStatus(item);
      item.metadata = {
        ...item.metadata,
        appointmentStatus: lifecycleStatus,
      };

      await repository.save(item);
      await this.syncNativeMeetingBinding(manager, ctx, item, lifecycleStatus);
      const saved = await repository.save(item);
      if (this.isAppointmentItem(saved)) {
        await this.emitAppointmentEvent(
          manager,
          saved,
          'leadflow.calendar.appointment.created',
          {
            appointmentId: saved.id,
            startsAt: this.requireStartsAt(saved),
            serviceRef: saved.type,
            channel: saved.sourceChannel,
          },
          'created',
        );
        if (lifecycleStatus === 'pending') {
          await this.emitLifecycleEvent(manager, saved, lifecycleStatus, {});
        }
      }

      return saved;
    });
  }

  async getScheduledItem(
    ctx: RequestContext,
    id: string,
  ): Promise<ScheduledItemEntity> {
    const tenantId = this.requireTenantId(ctx);
    const workspaceId = this.requireWorkspaceId(ctx);

    const item = await this.scheduledItemsRepository.findOne({
      where: {
        id,
        tenantId,
        workspaceId,
        deletedAt: IsNull(),
      },
    });

    if (!item) {
      throw new NotFoundException('Scheduled item not found.');
    }

    return item;
  }

  async patchScheduledItem(
    ctx: RequestContext,
    id: string,
    dto: PatchScheduledItemDto,
  ): Promise<ScheduledItemEntity> {
    return this.dataSource.transaction(async (manager) => {
      const item = await this.getScheduledItemForUpdate(manager, ctx, id);
      const previousLifecycleStatus = this.resolveLifecycleStatus(item);

      this.validateDateRange(
        dto.startAt === undefined ? item.startAt?.toISOString() : dto.startAt,
        dto.endAt === undefined ? item.endAt?.toISOString() : dto.endAt,
      );

      if (dto.type !== undefined) item.type = dto.type;
      if (dto.status !== undefined) item.status = dto.status;
      if (dto.priority !== undefined) item.priority = dto.priority;
      if (dto.title !== undefined) item.title = dto.title;
      if (dto.description !== undefined) item.description = dto.description;
      if (dto.notes !== undefined) item.notes = dto.notes;
      if (dto.startAt !== undefined)
        item.startAt = this.toDateOrNull(dto.startAt);
      if (dto.endAt !== undefined) item.endAt = this.toDateOrNull(dto.endAt);
      if (dto.dueAt !== undefined) item.dueAt = this.toDateOrNull(dto.dueAt);
      if (dto.allDay !== undefined) item.allDay = dto.allDay;
      if (dto.timezone !== undefined) item.timezone = dto.timezone;
      if (dto.locationType !== undefined) item.locationType = dto.locationType;
      if (dto.locationText !== undefined) item.locationText = dto.locationText;
      if (dto.videoMode !== undefined) item.videoMode = dto.videoMode;
      if (dto.videoUrl !== undefined) item.videoUrl = dto.videoUrl;
      if (dto.phoneUrl !== undefined) item.phoneUrl = dto.phoneUrl;
      if (dto.visibility !== undefined) item.visibility = dto.visibility;
      if (dto.ownerUserId !== undefined) item.ownerUserId = dto.ownerUserId;
      if (dto.assignedUserId !== undefined) {
        item.assignedUserId = dto.assignedUserId;
      }
      if (dto.contactId !== undefined) item.contactId = dto.contactId;
      if (dto.sourceChannel !== undefined)
        item.sourceChannel = dto.sourceChannel;
      if (dto.sourceConversationId !== undefined) {
        item.sourceConversationId = dto.sourceConversationId;
      }
      if (dto.sourceLeadId !== undefined) item.sourceLeadId = dto.sourceLeadId;
      if (dto.sourceOpportunityId !== undefined) {
        item.sourceOpportunityId = dto.sourceOpportunityId;
      }
      if (dto.metadata !== undefined) item.metadata = dto.metadata;

      const lifecycleStatus = this.resolveLifecycleStatus(item);
      item.metadata = {
        ...item.metadata,
        appointmentStatus: lifecycleStatus,
      };
      await this.syncNativeMeetingBinding(manager, ctx, item, lifecycleStatus);
      const saved = await manager.getRepository(ScheduledItemEntity).save(item);
      const changedFields = Object.keys(dto);
      if (this.isAppointmentItem(saved) && changedFields.length > 0) {
        await this.emitAppointmentEvent(
          manager,
          saved,
          'leadflow.calendar.appointment.updated',
          {
            appointmentId: saved.id,
            changedFields,
          },
          `updated:${saved.updatedAt.toISOString()}`,
        );
      }
      if (
        this.isAppointmentItem(saved) &&
        lifecycleStatus !== previousLifecycleStatus
      ) {
        await this.emitLifecycleEvent(manager, saved, lifecycleStatus, {});
      }

      return saved;
    });
  }

  async patchScheduledItemStatus(
    ctx: RequestContext,
    id: string,
    dto: PatchScheduledItemStatusDto,
  ): Promise<ScheduledItemEntity> {
    return this.dataSource.transaction(async (manager) => {
      const item = await this.getScheduledItemForUpdate(manager, ctx, id);
      const previousLifecycleStatus = this.resolveLifecycleStatus(item);
      item.status = dto.status;
      const lifecycleStatus = this.lifecycleFromStorageStatus(dto.status);
      item.metadata = {
        ...item.metadata,
        appointmentStatus: lifecycleStatus,
      };
      await this.syncNativeMeetingBinding(manager, ctx, item, lifecycleStatus);
      const saved = await manager.getRepository(ScheduledItemEntity).save(item);
      if (
        this.isAppointmentItem(saved) &&
        lifecycleStatus !== previousLifecycleStatus
      ) {
        await this.emitLifecycleEvent(manager, saved, lifecycleStatus, {});
      }
      return saved;
    });
  }

  async patchAppointmentLifecycleStatus(
    ctx: RequestContext,
    id: string,
    dto: PatchAppointmentLifecycleStatusDto,
  ): Promise<ScheduledItemEntity> {
    return this.dataSource.transaction(async (manager) => {
      const item = await this.getScheduledItemForUpdate(manager, ctx, id);
      const previousLifecycleStatus = this.resolveLifecycleStatus(item);
      if (previousLifecycleStatus === dto.status) {
        return item;
      }

      item.status = this.storageStatusForLifecycle(dto.status);
      item.metadata = {
        ...item.metadata,
        appointmentStatus: dto.status,
      };
      await this.syncNativeMeetingBinding(manager, ctx, item, dto.status);
      const saved = await manager.getRepository(ScheduledItemEntity).save(item);
      if (this.isAppointmentItem(saved)) {
        await this.emitAppointmentEvent(
          manager,
          saved,
          'leadflow.calendar.appointment.updated',
          {
            appointmentId: saved.id,
            changedFields: ['status'],
          },
          `updated:${saved.updatedAt.toISOString()}`,
        );
        await this.emitLifecycleEvent(manager, saved, dto.status, {
          reason: dto.reason,
          confirmedVia: dto.confirmedVia,
        });
      }
      return saved;
    });
  }

  async deleteScheduledItem(
    ctx: RequestContext,
    id: string,
  ): Promise<{ deleted: true }> {
    await this.dataSource.transaction(async (manager) => {
      const item = await this.getScheduledItemForUpdate(manager, ctx, id);
      item.status = 'canceled';
      item.metadata = {
        ...item.metadata,
        appointmentStatus: 'canceled',
      };
      item.deletedAt = new Date();
      await this.syncNativeMeetingBinding(manager, ctx, item, 'canceled');
      const saved = await manager.getRepository(ScheduledItemEntity).save(item);
      if (this.isAppointmentItem(saved)) {
        await this.emitLifecycleEvent(manager, saved, 'canceled', {
          reason: 'deleted',
        });
      }
    });
    return { deleted: true };
  }

  async listParticipants(
    ctx: RequestContext,
    scheduledItemId: string,
  ): Promise<ScheduledItemParticipantEntity[]> {
    const tenantId = this.requireTenantId(ctx);
    const workspaceId = this.requireWorkspaceId(ctx);

    await this.getScheduledItem(ctx, scheduledItemId);

    return this.participantsRepository.find({
      where: {
        tenantId,
        workspaceId,
        scheduledItemId,
      },
      order: {
        createdAt: 'ASC',
      },
    });
  }

  async addParticipant(
    ctx: RequestContext,
    scheduledItemId: string,
    dto: CreateScheduledItemParticipantDto,
  ): Promise<ScheduledItemParticipantEntity> {
    const tenantId = this.requireTenantId(ctx);
    const workspaceId = this.requireWorkspaceId(ctx);

    await this.getScheduledItem(ctx, scheduledItemId);
    this.validateParticipantIdentity(dto);

    const participant = this.participantsRepository.create({
      tenantId,
      workspaceId,
      scheduledItemId,
      participantType: dto.participantType,
      userId: dto.userId ?? null,
      contactId: dto.contactId ?? null,
      externalName: dto.externalName ?? null,
      externalEmail: dto.externalEmail ?? null,
      externalPhone: dto.externalPhone ?? null,
      responseStatus: dto.responseStatus ?? 'needs_action',
      metadata: dto.metadata ?? {},
    });

    return this.participantsRepository.save(participant);
  }

  async patchParticipantResponse(
    ctx: RequestContext,
    scheduledItemId: string,
    participantId: string,
    dto: PatchScheduledItemParticipantResponseDto,
  ): Promise<ScheduledItemParticipantEntity> {
    const tenantId = this.requireTenantId(ctx);
    const workspaceId = this.requireWorkspaceId(ctx);

    return this.dataSource.transaction(async (manager) => {
      const item = await this.getScheduledItemForUpdate(
        manager,
        ctx,
        scheduledItemId,
      );
      const participantRepository = manager.getRepository(
        ScheduledItemParticipantEntity,
      );
      const participant = await participantRepository.findOne({
        where: {
          id: participantId,
          tenantId,
          workspaceId,
          scheduledItemId,
        },
      });

      if (!participant) {
        throw new NotFoundException('Scheduled item participant not found.');
      }

      const previousResponse = participant.responseStatus;
      participant.responseStatus = dto.responseStatus;
      const saved = await participantRepository.save(participant);

      if (
        dto.responseStatus === 'accepted' &&
        previousResponse !== 'accepted' &&
        this.resolveLifecycleStatus(item) !== 'confirmed' &&
        this.isAppointmentItem(item)
      ) {
        item.status = 'scheduled';
        item.metadata = {
          ...item.metadata,
          appointmentStatus: 'confirmed',
        };
        await this.syncNativeMeetingBinding(manager, ctx, item, 'confirmed');
        const savedItem = await manager
          .getRepository(ScheduledItemEntity)
          .save(item);
        await this.emitAppointmentEvent(
          manager,
          savedItem,
          'leadflow.calendar.appointment.updated',
          {
            appointmentId: savedItem.id,
            changedFields: ['status', 'participant.responseStatus'],
          },
          `updated:${savedItem.updatedAt.toISOString()}`,
        );
        await this.emitLifecycleEvent(manager, savedItem, 'confirmed', {
          confirmedVia: 'participant_response',
        });
      }

      return saved;
    });
  }

  async listReminders(
    ctx: RequestContext,
    scheduledItemId: string,
  ): Promise<ScheduledItemReminderEntity[]> {
    const tenantId = this.requireTenantId(ctx);
    const workspaceId = this.requireWorkspaceId(ctx);

    await this.getScheduledItem(ctx, scheduledItemId);

    return this.remindersRepository.find({
      where: {
        tenantId,
        workspaceId,
        scheduledItemId,
      },
      order: {
        scheduledAt: 'ASC',
        createdAt: 'ASC',
      },
    });
  }

  async addReminder(
    ctx: RequestContext,
    scheduledItemId: string,
    dto: CreateScheduledItemReminderDto,
  ): Promise<ScheduledItemReminderEntity> {
    const tenantId = this.requireTenantId(ctx);
    const workspaceId = this.requireWorkspaceId(ctx);

    await this.getScheduledItem(ctx, scheduledItemId);

    const reminder = this.remindersRepository.create({
      tenantId,
      workspaceId,
      scheduledItemId,
      reminderType: dto.reminderType,
      offsetMinutes: dto.offsetMinutes,
      status: dto.status ?? 'pending',
      scheduledAt: this.toDateOrNull(dto.scheduledAt),
      sentAt: null,
      metadata: dto.metadata ?? {},
    });

    return this.remindersRepository.save(reminder);
  }

  async cancelReminder(
    ctx: RequestContext,
    scheduledItemId: string,
    reminderId: string,
  ): Promise<ScheduledItemReminderEntity> {
    const tenantId = this.requireTenantId(ctx);
    const workspaceId = this.requireWorkspaceId(ctx);

    await this.getScheduledItem(ctx, scheduledItemId);

    const reminder = await this.remindersRepository.findOne({
      where: {
        id: reminderId,
        tenantId,
        workspaceId,
        scheduledItemId,
      },
    });

    if (!reminder) {
      throw new NotFoundException('Scheduled item reminder not found.');
    }

    reminder.status = 'canceled';

    return this.remindersRepository.save(reminder);
  }

  private async getScheduledItemForUpdate(
    manager: EntityManager,
    ctx: RequestContext,
    id: string,
  ): Promise<ScheduledItemEntity> {
    const item = await manager.getRepository(ScheduledItemEntity).findOne({
      where: {
        id,
        tenantId: this.requireTenantId(ctx),
        workspaceId: this.requireWorkspaceId(ctx),
        deletedAt: IsNull(),
      },
      lock: { mode: 'pessimistic_write' },
    });
    if (!item) {
      throw new NotFoundException('Scheduled item not found.');
    }
    return item;
  }

  private resolveLifecycleStatus(
    item: ScheduledItemEntity,
  ): AppointmentLifecycleStatus {
    const metadataStatus = item.metadata?.appointmentStatus;
    if (
      typeof metadataStatus === 'string' &&
      APPOINTMENT_LIFECYCLE_STATUSES.includes(
        metadataStatus as AppointmentLifecycleStatus,
      )
    ) {
      return metadataStatus as AppointmentLifecycleStatus;
    }
    return this.lifecycleFromStorageStatus(item.status);
  }

  private lifecycleFromStorageStatus(
    status: string,
  ): AppointmentLifecycleStatus {
    if (status === 'completed') return 'completed';
    if (status === 'canceled') return 'canceled';
    if (status === 'missed') return 'no_show';
    if (status === 'postponed') return 'rescheduled';
    return 'confirmed';
  }

  private storageStatusForLifecycle(
    status: AppointmentLifecycleStatus,
  ): string {
    if (status === 'completed') return 'completed';
    if (status === 'canceled') return 'canceled';
    if (status === 'no_show') return 'missed';
    if (status === 'rescheduled') return 'postponed';
    return 'scheduled';
  }

  private isAppointmentItem(item: ScheduledItemEntity): boolean {
    return ['event', 'meeting', 'call'].includes(item.type);
  }

  private requireStartsAt(item: ScheduledItemEntity): string {
    const startsAt = item.startAt ?? item.dueAt;
    if (!startsAt) {
      throw new BadRequestException(
        'Appointments require startAt or dueAt before publishing events.',
      );
    }
    return startsAt.toISOString();
  }

  private async syncNativeMeetingBinding(
    manager: EntityManager,
    ctx: RequestContext,
    item: ScheduledItemEntity,
    lifecycleStatus: AppointmentLifecycleStatus,
  ): Promise<void> {
    const meetingRoomId =
      typeof item.metadata?.meetingRoomId === 'string'
        ? item.metadata.meetingRoomId
        : null;
    const meetingInput = {
      appointmentId: item.id,
      title: item.title,
      description: item.description,
      startsAt: item.startAt ?? item.dueAt,
      lifecycleStatus,
    };

    if (meetingRoomId) {
      if (
        item.locationType !== 'video' ||
        item.videoMode !== 'native' ||
        !this.isAppointmentItem(item)
      ) {
        await this.teamChatMeetingsService.detachAppointmentBinding(
          {
            tenantId: item.tenantId,
            workspaceId: item.workspaceId,
            userId: this.getUserId(ctx),
          },
          meetingRoomId,
          item.id,
          manager,
        );
        const metadata = { ...item.metadata };
        delete metadata.meetingRoomId;
        delete metadata.meetingProvider;
        delete metadata.meetingProviderRoomName;
        item.metadata = metadata;
        return;
      }
      const binding = await this.teamChatMeetingsService.syncAppointmentBinding(
        {
          tenantId: item.tenantId,
          workspaceId: item.workspaceId,
          userId: this.getUserId(ctx),
        },
        meetingRoomId,
        meetingInput,
        manager,
      );
      item.videoUrl = binding.publicUrl;
      item.metadata = {
        ...item.metadata,
        meetingRoomId: binding.meetingRoomId,
        meetingProvider: 'livekit',
        meetingProviderRoomName: binding.providerRoomName,
      };
      return;
    }

    if (
      !this.isAppointmentItem(item) ||
      item.locationType !== 'video' ||
      item.videoMode !== 'native'
    ) {
      return;
    }

    const binding = await this.teamChatMeetingsService.createForAppointment(
      {
        tenantId: item.tenantId,
        workspaceId: item.workspaceId,
        userId: this.getUserId(ctx),
      },
      meetingInput,
      manager,
    );
    item.videoUrl = binding.publicUrl;
    item.metadata = {
      ...item.metadata,
      meetingRoomId: binding.meetingRoomId,
      meetingProvider: 'livekit',
      meetingProviderRoomName: binding.providerRoomName,
    };
  }

  private async emitLifecycleEvent(
    manager: EntityManager,
    item: ScheduledItemEntity,
    status: AppointmentLifecycleStatus,
    options: { reason?: string; confirmedVia?: string },
  ): Promise<void> {
    if (status === 'pending') {
      const startsAt = this.requireStartsAt(item);
      const configuredDueAt = item.metadata?.confirmationDueAt;
      const confirmationDueAt =
        typeof configuredDueAt === 'string' &&
        !Number.isNaN(Date.parse(configuredDueAt))
          ? new Date(configuredDueAt).toISOString()
          : startsAt;
      await this.emitAppointmentEvent(
        manager,
        item,
        'leadflow.calendar.appointment.confirmation_pending',
        {
          appointmentId: item.id,
          startsAt,
          confirmationDueAt,
        },
        `confirmation-pending:${item.updatedAt.toISOString()}`,
      );
      return;
    }
    if (status === 'confirmed') {
      await this.emitAppointmentEvent(
        manager,
        item,
        'leadflow.calendar.appointment.confirmed',
        {
          appointmentId: item.id,
          confirmedVia: options.confirmedVia ?? item.sourceChannel,
        },
        `confirmed:${item.updatedAt.toISOString()}`,
      );
      return;
    }
    if (status === 'canceled') {
      await this.emitAppointmentEvent(
        manager,
        item,
        'leadflow.calendar.appointment.cancelled',
        {
          appointmentId: item.id,
          cancelReason: options.reason ?? 'status_changed',
        },
        `cancelled:${item.updatedAt.toISOString()}`,
      );
      return;
    }
    if (status === 'no_show') {
      await this.emitAppointmentEvent(
        manager,
        item,
        'leadflow.calendar.appointment.no_show',
        {
          appointmentId: item.id,
          detectedAt: new Date().toISOString(),
        },
        `no-show:${item.updatedAt.toISOString()}`,
      );
      return;
    }
    if (status === 'completed') {
      await this.emitAppointmentEvent(
        manager,
        item,
        'leadflow.calendar.appointment.completed',
        {
          appointmentId: item.id,
          completedAt: new Date().toISOString(),
        },
        `completed:${item.updatedAt.toISOString()}`,
      );
    }
  }

  private async emitAppointmentEvent(
    manager: EntityManager,
    item: ScheduledItemEntity,
    eventName: Extract<
      LeadFlowEventName,
      `leadflow.calendar.appointment.${string}`
    >,
    payload: Record<string, unknown>,
    idempotencySuffix: string,
  ): Promise<void> {
    const outbox = manager.getRepository(InboxDomainOutboxEntity);
    await outbox.save(
      outbox.create({
        tenantId: item.tenantId,
        workspaceId: item.workspaceId,
        aggregateType: 'scheduled_item',
        aggregateId: item.id,
        eventName,
        eventVersion: 1,
        idempotencyKey: `appointment:${item.id}:${idempotencySuffix}`,
        payload,
        status: 'pending',
        deliveryKind: 'realtime',
        attempts: 0,
        availableAt: new Date(),
        publishedAt: null,
        lockedAt: null,
        lockedBy: null,
        lastError: null,
        deadLetteredAt: null,
        skippedAt: null,
        skipReason: null,
        retainUntil: null,
      }),
    );
  }

  private requireTenantId(ctx: RequestContext): string {
    if (!ctx.tenantId) {
      throw new BadRequestException('Missing tenant context.');
    }

    return ctx.tenantId;
  }

  private requireWorkspaceId(ctx: RequestContext): string {
    if (!ctx.workspaceId) {
      throw new BadRequestException('Missing workspace context.');
    }

    return ctx.workspaceId;
  }

  private getUserId(ctx: RequestContext): string | null {
    const contextWithUserId = ctx as RequestContext & {
      userId?: string;
      user?: { id?: string };
    };

    return contextWithUserId.userId ?? contextWithUserId.user?.id ?? null;
  }

  private toDateOrNull(value?: string | null): Date | null {
    if (!value) {
      return null;
    }

    return new Date(value);
  }

  private validateDateRange(
    startAt?: string | null,
    endAt?: string | null,
  ): void {
    if (!startAt || !endAt) {
      return;
    }

    const startDate = new Date(startAt);
    const endDate = new Date(endAt);

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return;
    }

    if (endDate < startDate) {
      throw new BadRequestException(
        'End date must be greater than or equal to start date.',
      );
    }
  }

  private validateParticipantIdentity(
    dto: CreateScheduledItemParticipantDto,
  ): void {
    if (dto.participantType === 'user' && !dto.userId) {
      throw new BadRequestException('User participant requires userId.');
    }

    if (dto.participantType === 'contact' && !dto.contactId) {
      throw new BadRequestException('Contact participant requires contactId.');
    }

    if (
      dto.participantType === 'external' &&
      !dto.externalName &&
      !dto.externalEmail &&
      !dto.externalPhone
    ) {
      throw new BadRequestException(
        'External participant requires externalName, externalEmail or externalPhone.',
      );
    }
  }
}
