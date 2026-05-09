import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, IsNull, Repository } from 'typeorm';
import { RequestContext } from '../../common/context/request-context.interface';
import { CreateScheduledItemDto } from './dto/create-scheduled-item.dto';
import { CreateScheduledItemParticipantDto } from './dto/create-scheduled-item-participant.dto';
import { CreateScheduledItemReminderDto } from './dto/create-scheduled-item-reminder.dto';
import { PatchScheduledItemDto } from './dto/patch-scheduled-item.dto';
import { PatchScheduledItemParticipantResponseDto } from './dto/patch-scheduled-item-participant-response.dto';
import { PatchScheduledItemStatusDto } from './dto/patch-scheduled-item-status.dto';
import { ScheduledItemEntity } from './entities/scheduled-item.entity';
import { ScheduledItemParticipantEntity } from './entities/scheduled-item-participant.entity';
import { ScheduledItemReminderEntity } from './entities/scheduled-item-reminder.entity';

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
    @InjectRepository(ScheduledItemEntity)
    private readonly scheduledItemsRepository: Repository<ScheduledItemEntity>,

    @InjectRepository(ScheduledItemParticipantEntity)
    private readonly participantsRepository: Repository<ScheduledItemParticipantEntity>,

    @InjectRepository(ScheduledItemReminderEntity)
    private readonly remindersRepository: Repository<ScheduledItemReminderEntity>,
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

    const item = this.scheduledItemsRepository.create({
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

    return this.scheduledItemsRepository.save(item);
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
    const item = await this.getScheduledItem(ctx, id);

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
    if (dto.startAt !== undefined) item.startAt = this.toDateOrNull(dto.startAt);
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
    if (dto.assignedUserId !== undefined) item.assignedUserId = dto.assignedUserId;
    if (dto.contactId !== undefined) item.contactId = dto.contactId;
    if (dto.sourceChannel !== undefined) item.sourceChannel = dto.sourceChannel;
    if (dto.sourceConversationId !== undefined) {
      item.sourceConversationId = dto.sourceConversationId;
    }
    if (dto.sourceLeadId !== undefined) item.sourceLeadId = dto.sourceLeadId;
    if (dto.sourceOpportunityId !== undefined) {
      item.sourceOpportunityId = dto.sourceOpportunityId;
    }
    if (dto.metadata !== undefined) item.metadata = dto.metadata;

    return this.scheduledItemsRepository.save(item);
  }

  async patchScheduledItemStatus(
    ctx: RequestContext,
    id: string,
    dto: PatchScheduledItemStatusDto,
  ): Promise<ScheduledItemEntity> {
    const item = await this.getScheduledItem(ctx, id);
    item.status = dto.status;

    return this.scheduledItemsRepository.save(item);
  }

  async deleteScheduledItem(
    ctx: RequestContext,
    id: string,
  ): Promise<{ deleted: true }> {
    const item = await this.getScheduledItem(ctx, id);
    item.deletedAt = new Date();

    await this.scheduledItemsRepository.save(item);

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

    await this.getScheduledItem(ctx, scheduledItemId);

    const participant = await this.participantsRepository.findOne({
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

    participant.responseStatus = dto.responseStatus;

    return this.participantsRepository.save(participant);
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
      throw new BadRequestException('End date must be greater than or equal to start date.');
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
