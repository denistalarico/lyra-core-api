import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { RequestContext } from '../../common/context/request-context.interface';
import { ActivitiesService } from '../activities';
import {
  ActivityEntityType,
  ActivityVisibility,
} from '../activities/enums';
import type { CreateActivityDto, UpdateActivityDto } from '../activities/dto';
import { AppointmentsService } from '../appointments/appointments.service';
import type { CreateScheduledItemDto } from '../appointments/dto/create-scheduled-item.dto';
import type { CreateScheduledItemParticipantDto } from '../appointments/dto/create-scheduled-item-participant.dto';
import type { CreateScheduledItemReminderDto } from '../appointments/dto/create-scheduled-item-reminder.dto';
import type { PatchAppointmentLifecycleStatusDto } from '../appointments/dto/patch-appointment-lifecycle-status.dto';
import type { PatchScheduledItemParticipantResponseDto } from '../appointments/dto/patch-scheduled-item-participant-response.dto';
import type { PatchScheduledItemDto } from '../appointments/dto/patch-scheduled-item.dto';
import type { ScheduledItemEntity } from '../appointments/entities/scheduled-item.entity';
import { LeadFlowAgendaRolloutService } from './leadflow-agenda-rollout.service';

export type LeadFlowAgendaItem = {
  agendaItemId: string;
  source: 'scheduled_item' | 'activity';
  sourceId: string;
  kind: 'appointment' | 'activity';
  title: string;
  description: string | null;
  startsAt: string | null;
  endsAt: string | null;
  dueAt: string | null;
  timezone: string | null;
  state: string;
  ownerUserId: string | null;
  contactId: string | null;
  leadId: string | null;
  opportunityId: string | null;
  createdAt: string;
  updatedAt: string;
};

type ActivityWithLinks = Awaited<ReturnType<ActivitiesService['list']>>[number];

@Injectable()
export class LeadFlowAgendaService {
  private readonly logger = new Logger(LeadFlowAgendaService.name);

  constructor(
    private readonly appointmentsService: AppointmentsService,
    private readonly activitiesService: ActivitiesService,
    private readonly rolloutService: LeadFlowAgendaRolloutService,
  ) {}

  /**
   * The v1 aggregate is intentionally read-only with respect to Calendar.
   * Commands below write through to the source that owns its lifecycle.
   */
  async listItems(context: RequestContext) {
    const appointments = await this.listAppointments(context);
    const appointmentItems = appointments.map((appointment) =>
      this.toAppointmentAgendaItem(appointment),
    );

    if (!this.rolloutService.isCanonicalAgendaEnabled(context)) {
      return {
        version: 'v1',
        mode: 'legacy_appointments' as const,
        items: appointmentItems,
      };
    }

    const activityContext = this.toActivityContext(context);
    const [canonicalActivities, legacyAppointments] = await Promise.all([
      this.activitiesService.list(activityContext, {
        sourceModule: 'leadflow',
        includeArchived: 'false',
      }),
      // A second, independent read keeps the legacy endpoint observable while
      // rollout is active. It is comparison-only and does not write events.
      this.appointmentsService.listScheduledItems(context),
    ]);

    this.recordAppointmentProjectionMismatch(appointments, legacyAppointments);

    const activityItems = canonicalActivities
      .filter((activity) => this.isLeadFlowActivity(activity, context.userId))
      .map((activity) => this.toActivityAgendaItem(activity));

    return {
      version: 'v1',
      mode: 'canonical' as const,
      items: [...appointmentItems, ...activityItems].sort((left, right) =>
        this.sortByAgendaTime(left, right),
      ),
    };
  }

  listAppointments(context: RequestContext) {
    return this.appointmentsService
      .listScheduledItems(context)
      .then((items) =>
        items.filter((item) => ['event', 'meeting', 'call'].includes(item.type)),
      );
  }

  getAppointment(context: RequestContext, id: string) {
    return this.appointmentsService.getScheduledItem(context, id);
  }

  createAppointment(context: RequestContext, dto: CreateScheduledItemDto) {
    return this.appointmentsService.createScheduledItem(context, dto);
  }

  patchAppointment(
    context: RequestContext,
    id: string,
    dto: PatchScheduledItemDto,
  ) {
    return this.appointmentsService.patchScheduledItem(context, id, dto);
  }

  patchAppointmentLifecycle(
    context: RequestContext,
    id: string,
    dto: PatchAppointmentLifecycleStatusDto,
  ) {
    return this.appointmentsService.patchAppointmentLifecycleStatus(
      context,
      id,
      dto,
    );
  }

  deleteAppointment(context: RequestContext, id: string) {
    return this.appointmentsService.deleteScheduledItem(context, id);
  }

  listAppointmentParticipants(context: RequestContext, id: string) {
    return this.appointmentsService.listParticipants(context, id);
  }

  addAppointmentParticipant(
    context: RequestContext,
    id: string,
    dto: CreateScheduledItemParticipantDto,
  ) {
    return this.appointmentsService.addParticipant(context, id, dto);
  }

  patchAppointmentParticipantResponse(
    context: RequestContext,
    id: string,
    participantId: string,
    dto: PatchScheduledItemParticipantResponseDto,
  ) {
    return this.appointmentsService.patchParticipantResponse(
      context,
      id,
      participantId,
      dto,
    );
  }

  listAppointmentReminders(context: RequestContext, id: string) {
    return this.appointmentsService.listReminders(context, id);
  }

  addAppointmentReminder(
    context: RequestContext,
    id: string,
    dto: CreateScheduledItemReminderDto,
  ) {
    return this.appointmentsService.addReminder(context, id, dto);
  }

  cancelAppointmentReminder(
    context: RequestContext,
    id: string,
    reminderId: string,
  ) {
    return this.appointmentsService.cancelReminder(context, id, reminderId);
  }

  createActivity(context: RequestContext, dto: CreateActivityDto) {
    return this.activitiesService.create(this.toActivityContext(context), {
      ...dto,
      sourceModule: 'leadflow',
    });
  }

  updateActivity(context: RequestContext, id: string, dto: UpdateActivityDto) {
    return this.activitiesService.update(this.toActivityContext(context), id, dto);
  }

  deleteActivity(context: RequestContext, id: string) {
    return this.activitiesService.remove(this.toActivityContext(context), id);
  }

  private toActivityContext(context: RequestContext) {
    if (!context.workspaceId || !context.userId) {
      throw new BadRequestException(
        'LeadFlow Agenda requires tenant, workspace and user context.',
      );
    }

    return {
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      userId: context.userId,
    };
  }

  private isLeadFlowActivity(
    activity: ActivityWithLinks,
    userId: string | undefined,
  ) {
    if (activity.sourceModule !== 'leadflow') {
      return false;
    }

    if (
      activity.visibility === ActivityVisibility.Private &&
      activity.createdById !== userId &&
      activity.assignedToId !== userId
    ) {
      return false;
    }

    return activity.links.some((link) =>
      [
        ActivityEntityType.CrmOpportunity,
        ActivityEntityType.Contact,
        ActivityEntityType.InboxConversation,
      ].includes(link.entityType),
    );
  }

  private toAppointmentAgendaItem(
    appointment: ScheduledItemEntity,
  ): LeadFlowAgendaItem {
    const appointmentStatus = appointment.metadata.appointmentStatus;
    return {
      agendaItemId: `scheduled_item:${appointment.id}`,
      source: 'scheduled_item',
      sourceId: appointment.id,
      kind: 'appointment',
      title: appointment.title,
      description: appointment.description ?? appointment.notes,
      startsAt: appointment.startAt?.toISOString() ?? null,
      endsAt: appointment.endAt?.toISOString() ?? null,
      dueAt: appointment.dueAt?.toISOString() ?? null,
      timezone: appointment.timezone,
      state:
        typeof appointmentStatus === 'string'
          ? appointmentStatus
          : appointment.status,
      ownerUserId: appointment.assignedUserId ?? appointment.ownerUserId,
      contactId: appointment.contactId,
      leadId: appointment.sourceLeadId,
      opportunityId: appointment.sourceOpportunityId,
      createdAt: appointment.createdAt.toISOString(),
      updatedAt: appointment.updatedAt.toISOString(),
    };
  }

  private toActivityAgendaItem(activity: ActivityWithLinks): LeadFlowAgendaItem {
    const links = activity.links;
    const contactId =
      links.find((link) => link.entityType === ActivityEntityType.Contact)
        ?.entityId ?? null;
    const opportunityId =
      links.find((link) => link.entityType === ActivityEntityType.CrmOpportunity)
        ?.entityId ?? null;

    return {
      agendaItemId: `activity:${activity.id}`,
      source: 'activity',
      sourceId: activity.id,
      kind: 'activity',
      title: activity.summary,
      description: activity.note,
      startsAt: activity.startAt?.toISOString() ?? null,
      endsAt: activity.endAt?.toISOString() ?? null,
      dueAt: activity.dueAt?.toISOString() ?? null,
      timezone: null,
      state: activity.status,
      ownerUserId: activity.assignedToId,
      contactId,
      leadId: null,
      opportunityId,
      createdAt: activity.createdAt.toISOString(),
      updatedAt: activity.updatedAt.toISOString(),
    };
  }

  private sortByAgendaTime(left: LeadFlowAgendaItem, right: LeadFlowAgendaItem) {
    const leftTime = left.startsAt ?? left.dueAt ?? left.createdAt;
    const rightTime = right.startsAt ?? right.dueAt ?? right.createdAt;
    return new Date(leftTime).getTime() - new Date(rightTime).getTime();
  }

  private recordAppointmentProjectionMismatch(
    canonicalAppointments: ScheduledItemEntity[],
    legacyAppointments: ScheduledItemEntity[],
  ) {
    const canonicalProjection = new Map(
      canonicalAppointments.map((appointment) => [
        appointment.id,
        `${appointment.type}:${appointment.startAt?.toISOString() ?? ''}:${appointment.status}`,
      ]),
    );
    const legacyProjection = new Map(
      legacyAppointments
        .filter((item) => ['event', 'meeting', 'call'].includes(item.type))
        .map((appointment) => [
          appointment.id,
          `${appointment.type}:${appointment.startAt?.toISOString() ?? ''}:${appointment.status}`,
        ]),
    );

    const mismatches =
      canonicalProjection.size !== legacyProjection.size ||
      [...canonicalProjection].some(
        ([id, snapshot]) => legacyProjection.get(id) !== snapshot,
      );

    if (mismatches) {
      this.logger.warn(
        `LeadFlow Agenda dual-read mismatch: canonical=${canonicalProjection.size} legacy=${legacyProjection.size}`,
      );
    }
  }
}
