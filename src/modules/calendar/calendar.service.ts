import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, IsNull, MoreThan, Repository } from 'typeorm';
import { CalendarEvent } from './entities/calendar-event.entity';
import { CalendarRoutineBlock } from './entities/calendar-routine-block.entity';
import { CreateCalendarEventDto } from './dto/create-calendar-event.dto';
import { UpdateCalendarEventDto } from './dto/update-calendar-event.dto';
import { CreateCalendarRoutineBlockDto } from './dto/create-calendar-routine-block.dto';
import { UpdateCalendarRoutineBlockDto } from './dto/update-calendar-routine-block.dto';
import { CalendarSettings } from './entities/calendar-settings.entity';
import { UpdateCalendarSettingsDto } from './dto/update-calendar-settings.dto';
import { CalendarNotificationPublisher } from './calendar-notification.publisher';
import { EmailService } from '../email/email.service';

type CalendarContext = {
  tenantId: string;
  workspaceId?: string | null;
  userId?: string | null;
  role?: string | null;
};

const AGENCY_CONNECTION = 'agency';
const MAX_TIMER_DELAY_MS = 2_147_483_647;

type CalendarReminderChannel = 'in_app' | 'email' | 'whatsapp';

type CalendarReminderConfig = {
  enabled: boolean;
  offsetMinutes: number;
  channels: CalendarReminderChannel[];
};

function normalizeRole(role?: string | null): string {
  if (role === 'owner') return 'owner';
  if (role === 'admin' || role === 'administrator') return 'admin';
  if (role === 'manager') return 'manager';
  return 'member';
}

function isElevatedRole(role?: string | null): boolean {
  return ['owner', 'admin'].includes(normalizeRole(role));
}

@Injectable()
export class CalendarService implements OnModuleInit {
  private readonly logger = new Logger(CalendarService.name);
  private readonly reminderTimers = new Map<
    string,
    ReturnType<typeof setTimeout>[]
  >();

  constructor(
    @InjectRepository(CalendarEvent, AGENCY_CONNECTION)
    private readonly eventsRepository: Repository<CalendarEvent>,
    @InjectRepository(CalendarRoutineBlock, AGENCY_CONNECTION)
    private readonly routineBlocksRepository: Repository<CalendarRoutineBlock>,
    @InjectRepository(CalendarSettings, AGENCY_CONNECTION)
    private readonly settingsRepository: Repository<CalendarSettings>,
    private readonly calendarNotificationPublisher: CalendarNotificationPublisher,
    private readonly emailService: EmailService,
  ) {}

  onModuleInit() {
    void this.schedulePersistedCalendarReminders();
  }

  async listEvents(
    context: CalendarContext,
    filters: { startsAt?: string; endsAt?: string },
  ) {
    const qb = this.eventsRepository
      .createQueryBuilder('event')
      .where('event.tenant_id = :tenantId', { tenantId: context.tenantId });

    if (context.workspaceId) {
      qb.andWhere('event.workspace_id = :workspaceId', {
        workspaceId: context.workspaceId,
      });
    } else {
      qb.andWhere('event.workspace_id IS NULL');
    }

    if (filters.startsAt && filters.endsAt) {
      qb.andWhere('event.starts_at <= :endsAt', {
        endsAt: new Date(filters.endsAt),
      }).andWhere('event.ends_at >= :startsAt', {
        startsAt: new Date(filters.startsAt),
      });
    }

    this.applyEventCollectionScope(qb, context);

    return qb.orderBy('event.starts_at', 'ASC').getMany();
  }

  private applyEventCollectionScope(
    qb: ReturnType<Repository<CalendarEvent>['createQueryBuilder']>,
    context: CalendarContext,
  ) {
    if (isElevatedRole(context.role)) {
      return;
    }

    if (!context.userId) {
      qb.andWhere('1 = 0');
      return;
    }

    // TODO(permissions-sprint-9): include event participants when the calendar
    // module gets a persisted attendee/participant table.
    // TODO(permissions-sprint-9): expand manager department scope once calendar
    // events expose explicit department ownership metadata.
    qb.andWhere(
      new Brackets((scopeQb) => {
        scopeQb
          .where('event.owner_user_id = :scopeUserId', {
            scopeUserId: context.userId,
          })
          .orWhere('event.created_by_user_id = :scopeUserId', {
            scopeUserId: context.userId,
          });
      }),
    );
  }

  async createEvent(context: CalendarContext, dto: CreateCalendarEventDto) {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);

    if (startsAt.getTime() < Date.now()) {
      throw new BadRequestException('startsAt must not be in the past');
    }

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

    const saved = await this.eventsRepository.save(event);

    await this.createWeeklyOccurrences(saved);
    this.scheduleCalendarReminder(saved);

    return saved;
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

    if (dto.startsAt && startsAt.getTime() < Date.now()) {
      throw new BadRequestException('startsAt must not be in the past');
    }

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
    await this.createWeeklyOccurrences(saved);
    this.scheduleCalendarReminder(saved, previous);

    return saved;
  }

  async removeEvent(context: CalendarContext, eventId: string) {
    const event = await this.findEventOrFail(context, eventId);
    const previous = this.snapshotEvent(event);
    await this.eventsRepository.softRemove(event);
    this.clearReminderTimers(event.id);

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

    if (previous.status !== 'canceled' && event.status === 'canceled') {
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

  private async createWeeklyOccurrences(event: CalendarEvent) {
    const metadata = event.metadata ?? {};
    const recurrence = this.metadataRecord(metadata, 'recurrence');

    if (
      recurrence.frequency !== 'weekly' ||
      metadata.recurringSeriesId ||
      metadata.recurrenceGeneratedAt
    ) {
      return;
    }

    const occurrenceCount = this.normalizeOccurrenceCount(
      recurrence.generatedOccurrences,
    );
    const durationMs = event.endsAt.getTime() - event.startsAt.getTime();
    const occurrenceSaves: Promise<CalendarEvent>[] = [];

    for (let index = 1; index <= occurrenceCount; index += 1) {
      const startsAt = new Date(event.startsAt);
      startsAt.setDate(startsAt.getDate() + 7 * index);
      const endsAt = new Date(startsAt.getTime() + durationMs);

      const occurrence = this.eventsRepository.create({
        tenantId: event.tenantId,
        workspaceId: event.workspaceId ?? null,
        title: event.title,
        description: event.description,
        eventType: event.eventType,
        visibility: event.visibility,
        startsAt,
        endsAt,
        allDay: event.allDay,
        ownerUserId: event.ownerUserId,
        createdByUserId: event.createdByUserId,
        clientId: event.clientId,
        projectId: event.projectId,
        taskId: event.taskId,
        salesOpportunityId: event.salesOpportunityId,
        metadata: {
          ...metadata,
          recurringSeriesId: event.id,
          recurrence: {
            ...recurrence,
            sourceEventId: event.id,
            occurrenceIndex: index,
          },
        },
      });

      occurrenceSaves.push(this.eventsRepository.save(occurrence));
    }

    const occurrences = await Promise.all(occurrenceSaves);
    for (const occurrence of occurrences) {
      this.scheduleCalendarReminder(occurrence);
    }

    event.metadata = {
      ...metadata,
      recurrenceGeneratedAt: new Date().toISOString(),
      recurrenceGeneratedOccurrences: occurrenceCount,
    };
    await this.eventsRepository.save(event);
  }

  private normalizeOccurrenceCount(value: unknown) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return 52;
    }

    return Math.min(Math.max(Math.round(value), 1), 52);
  }

  private scheduleCalendarReminder(
    event: CalendarEvent,
    previous?: CalendarEventSnapshot,
  ) {
    if (previous && !this.shouldRescheduleReminder(event, previous)) {
      return;
    }

    this.clearReminderTimers(event.id);

    const config = this.getCalendarReminderConfig(event);
    if (!config?.enabled || config.channels.length === 0) {
      return;
    }

    const reminderAt = new Date(
      event.startsAt.getTime() - config.offsetMinutes * 60_000,
    );

    if (event.startsAt.getTime() < Date.now()) {
      return;
    }

    const run = () => {
      void this.dispatchCalendarReminder(event, config, reminderAt).catch(
        (error) => {
          this.logger.warn(
            `Failed to dispatch calendar reminder for event ${event.id}: ${
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

    this.registerReminderTimer(event.id, reminderAt, run);
  }

  private async schedulePersistedCalendarReminders() {
    try {
      const events = await this.eventsRepository.find({
        where: {
          startsAt: MoreThan(new Date()),
        } as any,
        order: {
          startsAt: 'ASC',
        },
      });

      for (const event of events) {
        this.scheduleCalendarReminder(event);
      }
    } catch (error) {
      this.logger.warn(
        `Failed to schedule persisted calendar reminders: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private registerReminderTimer(
    eventId: string,
    targetAt: Date,
    callback: () => void,
  ) {
    const delay = targetAt.getTime() - Date.now();

    const timer = setTimeout(
      () => {
        const remaining = targetAt.getTime() - Date.now();
        if (remaining > 0) {
          this.registerReminderTimer(eventId, targetAt, callback);
          return;
        }

        callback();
      },
      Math.min(Math.max(delay, 0), MAX_TIMER_DELAY_MS),
    );

    const timers = this.reminderTimers.get(eventId) ?? [];
    timers.push(timer);
    this.reminderTimers.set(eventId, timers);
  }

  private clearReminderTimers(eventId: string) {
    const timers = this.reminderTimers.get(eventId) ?? [];
    for (const timer of timers) {
      clearTimeout(timer);
    }
    this.reminderTimers.delete(eventId);
  }

  private async dispatchCalendarReminder(
    event: CalendarEvent,
    config: CalendarReminderConfig,
    reminderAt: Date,
  ) {
    this.clearReminderTimers(event.id);

    if (config.channels.includes('in_app')) {
      await this.calendarNotificationPublisher.publishEventReminder({
        event,
        actorUserId: null,
        recipientUserIds: [event.ownerUserId, event.createdByUserId],
        offsetMinutes: config.offsetMinutes,
        reminderAt,
      });
    }

    if (config.channels.includes('email')) {
      await this.sendCalendarReminderEmails(event);
    }
  }

  private async sendCalendarReminderEmails(event: CalendarEvent) {
    const metadata = event.metadata ?? {};
    const participantEmails = this.metadataStringList(
      metadata,
      'participantEmails',
    );

    if (participantEmails.length === 0) {
      return;
    }

    const meetingUrl = this.metadataString(metadata, 'meetingUrl');

    const results = await Promise.allSettled(
      participantEmails.map((email) =>
        this.emailService.sendCalendarReminderEmail({
          to: email,
          eventTitle: event.title,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          description: event.description,
          meetingUrl: meetingUrl || null,
        }),
      ),
    );

    const failed = results.filter((result) => result.status === 'rejected');
    if (failed.length > 0) {
      this.logger.warn(
        `Failed to send ${failed.length} calendar reminder email(s) for event ${event.id}`,
      );
    }
  }

  private shouldRescheduleReminder(
    event: CalendarEvent,
    previous: CalendarEventSnapshot,
  ) {
    const metadata = event.metadata ?? {};
    const previousMetadata = previous.metadata ?? {};

    return (
      JSON.stringify(previousMetadata.calendarReminder ?? {}) !==
        JSON.stringify(metadata.calendarReminder ?? {}) ||
      this.metadataString(previousMetadata, 'meetingReminder') !==
        this.metadataString(metadata, 'meetingReminder') ||
      this.metadataString(previousMetadata, 'meetingUrl') !==
        this.metadataString(metadata, 'meetingUrl') ||
      this.metadataStringList(previousMetadata, 'participantEmails').join(
        ',',
      ) !== this.metadataStringList(metadata, 'participantEmails').join(',') ||
      previous.title !== event.title ||
      previous.description !== event.description ||
      previous.startsAt.getTime() !== event.startsAt.getTime() ||
      previous.endsAt.getTime() !== event.endsAt.getTime()
    );
  }

  private getCalendarReminderConfig(
    event: CalendarEvent,
  ): CalendarReminderConfig | null {
    const metadata = event.metadata ?? {};
    const reminder = this.metadataRecord(metadata, 'calendarReminder');
    const legacyMeetingReminder = this.metadataString(
      metadata,
      'meetingReminder',
    );

    if (reminder.enabled === false) {
      return null;
    }

    const explicitEnabled = reminder.enabled === true;
    const legacyEnabled =
      legacyMeetingReminder === 'email' ||
      legacyMeetingReminder === 'email_with_link';

    if (!explicitEnabled && !legacyEnabled) {
      return null;
    }

    const offsetMinutes =
      typeof reminder.offsetMinutes === 'number' &&
      Number.isFinite(reminder.offsetMinutes) &&
      reminder.offsetMinutes > 0
        ? Math.round(reminder.offsetMinutes)
        : 60;
    const channels = this.metadataChannelList(reminder.channels);

    if (legacyEnabled && !channels.includes('email')) {
      channels.push('email');
    }

    return {
      enabled: true,
      offsetMinutes,
      channels: channels.length > 0 ? channels : ['in_app'],
    };
  }

  private metadataRecord(metadata: Record<string, unknown>, key: string) {
    const value = metadata[key];
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private metadataChannelList(value: unknown): CalendarReminderChannel[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const allowed = new Set<CalendarReminderChannel>([
      'in_app',
      'email',
      'whatsapp',
    ]);
    const unique = new Set<CalendarReminderChannel>();

    for (const item of value) {
      if (typeof item !== 'string') continue;
      if (!allowed.has(item as CalendarReminderChannel)) continue;
      unique.add(item as CalendarReminderChannel);
    }

    return [...unique];
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
