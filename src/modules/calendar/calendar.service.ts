import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { CalendarEvent } from './entities/calendar-event.entity';
import { CalendarRoutineBlock } from './entities/calendar-routine-block.entity';
import { CreateCalendarEventDto } from './dto/create-calendar-event.dto';
import { UpdateCalendarEventDto } from './dto/update-calendar-event.dto';
import { CreateCalendarRoutineBlockDto } from './dto/create-calendar-routine-block.dto';
import { UpdateCalendarRoutineBlockDto } from './dto/update-calendar-routine-block.dto';
import { CalendarSettings } from './entities/calendar-settings.entity';
import { UpdateCalendarSettingsDto } from './dto/update-calendar-settings.dto';
import { CalendarNotificationPublisher } from './calendar-notification.publisher';

type CalendarContext = {
  tenantId: string;
  workspaceId?: string | null;
  userId?: string | null;
};

const AGENCY_CONNECTION = 'agency';

@Injectable()
export class CalendarService {
  constructor(
    @InjectRepository(CalendarEvent, AGENCY_CONNECTION)
    private readonly eventsRepository: Repository<CalendarEvent>,
    @InjectRepository(CalendarRoutineBlock, AGENCY_CONNECTION)
    private readonly routineBlocksRepository: Repository<CalendarRoutineBlock>,
    @InjectRepository(CalendarSettings, AGENCY_CONNECTION)
    private readonly settingsRepository: Repository<CalendarSettings>,
    private readonly calendarNotificationPublisher: CalendarNotificationPublisher,
  ) {}

  async listEvents(
    context: CalendarContext,
    filters: { startsAt?: string; endsAt?: string },
  ) {
    const where: any = {
      tenantId: context.tenantId,
      workspaceId: this.workspaceWhere(context.workspaceId),
    };

    if (filters.startsAt && filters.endsAt) {
      where.startsAt = LessThanOrEqual(new Date(filters.endsAt));
      where.endsAt = MoreThanOrEqual(new Date(filters.startsAt));
    }

    return this.eventsRepository.find({
      where,
      order: { startsAt: 'ASC' },
    });
  }

  async createEvent(context: CalendarContext, dto: CreateCalendarEventDto) {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);

    if (endsAt <= startsAt) {
      throw new BadRequestException('endsAt must be after startsAt');
    }

    const event = this.eventsRepository.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId ?? null,
      title: dto.title,
      description: dto.description ?? null,
      eventType: dto.eventType ?? 'internal_meeting',
      visibility: dto.visibility ?? 'workspace',
      startsAt,
      endsAt,
      allDay: dto.allDay ?? false,
      ownerUserId: dto.ownerUserId ?? context.userId ?? null,
      createdByUserId: context.userId ?? null,
      clientId: dto.clientId ?? null,
      projectId: dto.projectId ?? null,
      taskId: dto.taskId ?? null,
      salesOpportunityId: dto.salesOpportunityId ?? null,
      metadata: dto.metadata ?? {},
    });

    return this.eventsRepository.save(event);
  }

  async updateEvent(
    context: CalendarContext,
    eventId: string,
    dto: UpdateCalendarEventDto,
  ) {
    const event = await this.findEventOrFail(context, eventId);
    const previous = this.snapshotEvent(event);

    const startsAt = dto.startsAt ? new Date(dto.startsAt) : event.startsAt;
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : event.endsAt;

    if (endsAt <= startsAt) {
      throw new BadRequestException('endsAt must be after startsAt');
    }

    event.startsAt = startsAt;
    event.endsAt = endsAt;
    event.title = dto.title ?? event.title;
    event.description = dto.description ?? event.description;
    event.eventType = dto.eventType ?? event.eventType;
    event.status = dto.status ?? event.status;
    event.visibility = dto.visibility ?? event.visibility;
    event.allDay = dto.allDay ?? event.allDay;
    event.ownerUserId = dto.ownerUserId ?? event.ownerUserId;
    event.clientId = dto.clientId ?? event.clientId;
    event.projectId = dto.projectId ?? event.projectId;
    event.taskId = dto.taskId ?? event.taskId;
    event.salesOpportunityId =
      dto.salesOpportunityId ?? event.salesOpportunityId;
    event.metadata = dto.metadata ?? event.metadata;

    const saved = await this.eventsRepository.save(event);

    await this.publishCalendarUpdateNotifications(context, saved, previous);

    return saved;
  }

  async removeEvent(context: CalendarContext, eventId: string) {
    const event = await this.findEventOrFail(context, eventId);
    const previous = this.snapshotEvent(event);
    await this.eventsRepository.softRemove(event);

    // Soft removal is surfaced as a calendar cancellation notification.
    await this.publishCalendarCanceledNotification(
      context,
      event,
      previous.ownerUserId,
    );

    return { success: true };
  }

  async listRoutineBlocks(context: CalendarContext) {
    if (!context.userId) {
      throw new BadRequestException('userId is required');
    }

    return this.routineBlocksRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: this.workspaceWhere(context.workspaceId),
        userId: context.userId,
      } as any,
      order: { weekday: 'ASC', startTime: 'ASC' },
    });
  }

  async createRoutineBlock(
    context: CalendarContext,
    dto: CreateCalendarRoutineBlockDto,
  ) {
    if (!context.userId) {
      throw new BadRequestException('userId is required');
    }

    const startTime = this.normalizeTime(dto.startTime);
    const endTime = this.normalizeTime(dto.endTime);

    if (endTime <= startTime) {
      throw new BadRequestException('endTime must be after startTime');
    }

    const block = this.routineBlocksRepository.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId ?? null,
      userId: context.userId,
      title: dto.title,
      description: dto.description ?? null,
      weekday: dto.weekday,
      startTime,
      endTime,
      visibility: 'private',
      showAsBusy: dto.showAsBusy ?? true,
      colorKey: dto.colorKey ?? null,
      isActive: dto.isActive ?? true,
    });

    return this.routineBlocksRepository.save(block);
  }

  async updateRoutineBlock(
    context: CalendarContext,
    blockId: string,
    dto: UpdateCalendarRoutineBlockDto,
  ) {
    const block = await this.findRoutineBlockOrFail(context, blockId);

    const startTime = dto.startTime
      ? this.normalizeTime(dto.startTime)
      : block.startTime;
    const endTime = dto.endTime
      ? this.normalizeTime(dto.endTime)
      : block.endTime;

    if (endTime <= startTime) {
      throw new BadRequestException('endTime must be after startTime');
    }

    block.title = dto.title ?? block.title;
    block.description = dto.description ?? block.description;
    block.weekday = dto.weekday ?? block.weekday;
    block.startTime = startTime;
    block.endTime = endTime;
    block.showAsBusy = dto.showAsBusy ?? block.showAsBusy;
    block.colorKey = dto.colorKey ?? block.colorKey;
    block.isActive = dto.isActive ?? block.isActive;

    return this.routineBlocksRepository.save(block);
  }

  async removeRoutineBlock(context: CalendarContext, blockId: string) {
    const block = await this.findRoutineBlockOrFail(context, blockId);
    await this.routineBlocksRepository.softRemove(block);
    return { success: true };
  }

  async getSettings(context: CalendarContext) {
    if (!context.userId) {
      throw new BadRequestException('userId is required');
    }

    const existing = await this.settingsRepository.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: this.workspaceWhere(context.workspaceId),
        userId: context.userId,
      } as any,
    });

    if (existing) {
      return existing;
    }

    await this.settingsRepository
      .createQueryBuilder()
      .insert()
      .into(CalendarSettings)
      .values({
        tenantId: context.tenantId,
        workspaceId: context.workspaceId ?? null,
        userId: context.userId,
        defaultView: 'week',
        defaultEventDurationMinutes: 60,
        weekStartsOn: 1,
        workdayStartTime: '08:00:00',
        workdayEndTime: '18:00:00',
        quietHoursEnabled: false,
        quietHoursStartTime: '22:00:00',
        quietHoursEndTime: '07:00:00',
        notificationsEnabled: true,
        emailNotificationsEnabled: true,
        inAppNotificationsEnabled: true,
        defaultReminderMinutes: 60,
        calendarSharingEnabled: true,
        defaultSharingPermission: 'view',
      })
      .orIgnore()
      .execute();

    return this.findSettingsOrFail(context);
  }

  async updateSettings(
    context: CalendarContext,
    dto: UpdateCalendarSettingsDto,
  ) {
    const settings = await this.getSettings(context);

    if (
      dto.workdayStartTime &&
      dto.workdayEndTime &&
      this.normalizeTime(dto.workdayEndTime) <=
        this.normalizeTime(dto.workdayStartTime)
    ) {
      throw new BadRequestException(
        'workdayEndTime must be after workdayStartTime',
      );
    }

    settings.defaultView = dto.defaultView ?? settings.defaultView;
    settings.defaultEventDurationMinutes =
      dto.defaultEventDurationMinutes ?? settings.defaultEventDurationMinutes;
    settings.weekStartsOn = dto.weekStartsOn ?? settings.weekStartsOn;
    settings.workdayStartTime = dto.workdayStartTime
      ? this.normalizeTime(dto.workdayStartTime)
      : settings.workdayStartTime;
    settings.workdayEndTime = dto.workdayEndTime
      ? this.normalizeTime(dto.workdayEndTime)
      : settings.workdayEndTime;
    settings.quietHoursEnabled =
      dto.quietHoursEnabled ?? settings.quietHoursEnabled;
    settings.quietHoursStartTime = dto.quietHoursStartTime
      ? this.normalizeTime(dto.quietHoursStartTime)
      : settings.quietHoursStartTime;
    settings.quietHoursEndTime = dto.quietHoursEndTime
      ? this.normalizeTime(dto.quietHoursEndTime)
      : settings.quietHoursEndTime;
    settings.notificationsEnabled =
      dto.notificationsEnabled ?? settings.notificationsEnabled;
    settings.emailNotificationsEnabled =
      dto.emailNotificationsEnabled ?? settings.emailNotificationsEnabled;
    settings.inAppNotificationsEnabled =
      dto.inAppNotificationsEnabled ?? settings.inAppNotificationsEnabled;
    settings.defaultReminderMinutes =
      dto.defaultReminderMinutes ?? settings.defaultReminderMinutes;
    settings.calendarSharingEnabled =
      dto.calendarSharingEnabled ?? settings.calendarSharingEnabled;
    settings.defaultSharingPermission =
      dto.defaultSharingPermission ?? settings.defaultSharingPermission;

    return this.settingsRepository.save(settings);
  }

  async resetSettings(context: CalendarContext) {
    const settings = await this.getSettings(context);

    settings.defaultView = 'week';
    settings.defaultEventDurationMinutes = 60;
    settings.weekStartsOn = 1;
    settings.workdayStartTime = '08:00:00';
    settings.workdayEndTime = '18:00:00';
    settings.quietHoursEnabled = false;
    settings.quietHoursStartTime = '22:00:00';
    settings.quietHoursEndTime = '07:00:00';
    settings.notificationsEnabled = true;
    settings.emailNotificationsEnabled = true;
    settings.inAppNotificationsEnabled = true;
    settings.defaultReminderMinutes = 60;
    settings.calendarSharingEnabled = true;
    settings.defaultSharingPermission = 'view';

    return this.settingsRepository.save(settings);
  }

  private async findEventOrFail(context: CalendarContext, eventId: string) {
    const event = await this.eventsRepository.findOne({
      where: {
        id: eventId,
        tenantId: context.tenantId,
        workspaceId: this.workspaceWhere(context.workspaceId),
      } as any,
    });

    if (!event) {
      throw new NotFoundException('Calendar event not found');
    }

    return event;
  }

  private async findRoutineBlockOrFail(
    context: CalendarContext,
    blockId: string,
  ) {
    if (!context.userId) {
      throw new BadRequestException('userId is required');
    }

    const block = await this.routineBlocksRepository.findOne({
      where: {
        id: blockId,
        tenantId: context.tenantId,
        workspaceId: this.workspaceWhere(context.workspaceId),
        userId: context.userId,
      } as any,
    });

    if (!block) {
      throw new NotFoundException('Routine block not found');
    }

    return block;
  }

  private async findSettingsOrFail(context: CalendarContext) {
    const settings = await this.settingsRepository.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: this.workspaceWhere(context.workspaceId),
        userId: context.userId,
      } as any,
    });

    if (!settings) {
      throw new NotFoundException('Calendar settings not found');
    }

    return settings;
  }

  private workspaceWhere(workspaceId?: string | null) {
    return workspaceId ? workspaceId : IsNull();
  }

  private normalizeTime(value: string) {
    return value.length === 5 ? `${value}:00` : value;
  }

  private async publishCalendarUpdateNotifications(
    context: CalendarContext,
    event: CalendarEvent,
    previous: CalendarEventSnapshot,
  ) {
    /*
     * invitation_received must wait for persisted attendees with userId.
     * ownerUserId is the responsible organizer, not an invited participant.
     */

    if (
      previous.status !== 'canceled' &&
      event.status === 'canceled'
    ) {
      await this.publishCalendarCanceledNotification(
        context,
        event,
        previous.ownerUserId,
      );
      return;
    }

    if (this.wasEventRescheduled(event, previous)) {
      if (!event.ownerUserId) {
        return;
      }

      await this.calendarNotificationPublisher.publishEventRescheduled({
        event,
        actorUserId: context.userId,
        recipientUserIds: [event.ownerUserId],
      });
      return;
    }

    if (this.wasEventUpdated(event, previous)) {
      if (!event.ownerUserId) {
        return;
      }

      await this.calendarNotificationPublisher.publishEventUpdated({
        event,
        actorUserId: context.userId,
        recipientUserIds: [event.ownerUserId],
      });
    }
  }

  private async publishCalendarCanceledNotification(
    context: CalendarContext,
    event: CalendarEvent,
    ownerUserId?: string | null,
  ) {
    if (!ownerUserId) {
      return;
    }

    await this.calendarNotificationPublisher.publishEventCanceled({
      event,
      actorUserId: context.userId,
      recipientUserIds: [ownerUserId],
    });
  }

  private snapshotEvent(event: CalendarEvent): CalendarEventSnapshot {
    return {
      title: event.title,
      description: event.description,
      eventType: event.eventType,
      status: event.status,
      visibility: event.visibility,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      allDay: event.allDay,
      ownerUserId: event.ownerUserId,
      clientId: event.clientId,
      projectId: event.projectId,
      taskId: event.taskId,
      salesOpportunityId: event.salesOpportunityId,
      metadata: event.metadata,
    };
  }

  private wasEventRescheduled(
    event: CalendarEvent,
    previous: CalendarEventSnapshot,
  ) {
    return (
      previous.startsAt.getTime() !== event.startsAt.getTime() ||
      previous.endsAt.getTime() !== event.endsAt.getTime()
    );
  }

  private wasEventUpdated(
    event: CalendarEvent,
    previous: CalendarEventSnapshot,
  ) {
    return (
      previous.title !== event.title ||
      previous.description !== event.description ||
      previous.eventType !== event.eventType ||
      previous.visibility !== event.visibility ||
      previous.allDay !== event.allDay ||
      previous.clientId !== event.clientId ||
      previous.projectId !== event.projectId ||
      previous.taskId !== event.taskId ||
      previous.salesOpportunityId !== event.salesOpportunityId ||
      JSON.stringify(previous.metadata ?? {}) !==
        JSON.stringify(event.metadata ?? {})
    );
  }
}

type CalendarEventSnapshot = Pick<
  CalendarEvent,
  | 'title'
  | 'description'
  | 'eventType'
  | 'status'
  | 'visibility'
  | 'startsAt'
  | 'endsAt'
  | 'allDay'
  | 'ownerUserId'
  | 'clientId'
  | 'projectId'
  | 'taskId'
  | 'salesOpportunityId'
  | 'metadata'
>;
