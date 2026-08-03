import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  DangerousAction,
  PermissionsGuard,
  RequireAnyPermission,
  RequirePermission,
  RequireProductEntitlement,
} from '../permissions';
import { CreateActivityDto, UpdateActivityDto } from '../activities/dto';
import { CreateScheduledItemDto } from '../appointments/dto/create-scheduled-item.dto';
import { CreateScheduledItemParticipantDto } from '../appointments/dto/create-scheduled-item-participant.dto';
import { CreateScheduledItemReminderDto } from '../appointments/dto/create-scheduled-item-reminder.dto';
import { PatchAppointmentLifecycleStatusDto } from '../appointments/dto/patch-appointment-lifecycle-status.dto';
import { PatchScheduledItemParticipantResponseDto } from '../appointments/dto/patch-scheduled-item-participant-response.dto';
import { PatchScheduledItemDto } from '../appointments/dto/patch-scheduled-item.dto';
import { LeadFlowAgendaService } from './leadflow-agenda.service';

@Controller('leadflow/agenda/v1')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('leadflow')
export class LeadFlowAgendaController {
  constructor(private readonly agendaService: LeadFlowAgendaService) {}

  @Get('items')
  @RequireAnyPermission(
    'leadflow.appointments.item.view.assigned',
    'leadflow.appointments.item.view.client',
  )
  listItems(@RequestContextData() context: RequestContext) {
    return this.agendaService.listItems(context);
  }

  @Get('appointments')
  @RequireAnyPermission(
    'leadflow.appointments.item.view.assigned',
    'leadflow.appointments.item.view.client',
  )
  listAppointments(@RequestContextData() context: RequestContext) {
    return this.agendaService.listAppointments(context);
  }

  @Get('appointments/:id')
  @RequireAnyPermission(
    'leadflow.appointments.item.view.assigned',
    'leadflow.appointments.item.view.client',
  )
  getAppointment(
    @RequestContextData() context: RequestContext,
    @Param('id') id: string,
  ) {
    return this.agendaService.getAppointment(context, id);
  }

  @Post('appointments')
  @RequirePermission('leadflow.appointments.item.create.client')
  createAppointment(
    @RequestContextData() context: RequestContext,
    @Body() dto: CreateScheduledItemDto,
  ) {
    return this.agendaService.createAppointment(context, dto);
  }

  @Patch('appointments/:id')
  @RequireAnyPermission(
    'leadflow.appointments.item.update.assigned',
    'leadflow.appointments.item.update.client',
  )
  patchAppointment(
    @RequestContextData() context: RequestContext,
    @Param('id') id: string,
    @Body() dto: PatchScheduledItemDto,
  ) {
    return this.agendaService.patchAppointment(context, id, dto);
  }

  @Patch('appointments/:id/lifecycle-status')
  @RequireAnyPermission(
    'leadflow.appointments.item.update.assigned',
    'leadflow.appointments.item.update.client',
  )
  patchAppointmentLifecycle(
    @RequestContextData() context: RequestContext,
    @Param('id') id: string,
    @Body() dto: PatchAppointmentLifecycleStatusDto,
  ) {
    return this.agendaService.patchAppointmentLifecycle(context, id, dto);
  }

  @Delete('appointments/:id')
  @RequirePermission('leadflow.appointments.item.delete.owner_only')
  @DangerousAction()
  deleteAppointment(
    @RequestContextData() context: RequestContext,
    @Param('id') id: string,
  ) {
    return this.agendaService.deleteAppointment(context, id);
  }

  @Get('appointments/:id/participants')
  @RequireAnyPermission(
    'leadflow.appointments.item.view.assigned',
    'leadflow.appointments.item.view.client',
  )
  listAppointmentParticipants(
    @RequestContextData() context: RequestContext,
    @Param('id') id: string,
  ) {
    return this.agendaService.listAppointmentParticipants(context, id);
  }

  @Post('appointments/:id/participants')
  @RequireAnyPermission(
    'leadflow.appointments.item.update.assigned',
    'leadflow.appointments.item.update.client',
  )
  addAppointmentParticipant(
    @RequestContextData() context: RequestContext,
    @Param('id') id: string,
    @Body() dto: CreateScheduledItemParticipantDto,
  ) {
    return this.agendaService.addAppointmentParticipant(context, id, dto);
  }

  @Patch('appointments/:id/participants/:participantId/response')
  @RequireAnyPermission(
    'leadflow.appointments.item.update.assigned',
    'leadflow.appointments.item.update.client',
  )
  patchAppointmentParticipantResponse(
    @RequestContextData() context: RequestContext,
    @Param('id') id: string,
    @Param('participantId') participantId: string,
    @Body() dto: PatchScheduledItemParticipantResponseDto,
  ) {
    return this.agendaService.patchAppointmentParticipantResponse(
      context,
      id,
      participantId,
      dto,
    );
  }

  @Get('appointments/:id/reminders')
  @RequireAnyPermission(
    'leadflow.appointments.item.view.assigned',
    'leadflow.appointments.item.view.client',
  )
  listAppointmentReminders(
    @RequestContextData() context: RequestContext,
    @Param('id') id: string,
  ) {
    return this.agendaService.listAppointmentReminders(context, id);
  }

  @Post('appointments/:id/reminders')
  @RequireAnyPermission(
    'leadflow.appointments.item.update.assigned',
    'leadflow.appointments.item.update.client',
  )
  addAppointmentReminder(
    @RequestContextData() context: RequestContext,
    @Param('id') id: string,
    @Body() dto: CreateScheduledItemReminderDto,
  ) {
    return this.agendaService.addAppointmentReminder(context, id, dto);
  }

  @Post('appointments/:id/reminders/:reminderId/cancel')
  @RequireAnyPermission(
    'leadflow.appointments.item.update.assigned',
    'leadflow.appointments.item.update.client',
  )
  cancelAppointmentReminder(
    @RequestContextData() context: RequestContext,
    @Param('id') id: string,
    @Param('reminderId') reminderId: string,
  ) {
    return this.agendaService.cancelAppointmentReminder(context, id, reminderId);
  }

  @Post('activities')
  @RequirePermission('leadflow.appointments.item.create.client')
  createActivity(
    @RequestContextData() context: RequestContext,
    @Body() dto: CreateActivityDto,
  ) {
    return this.agendaService.createActivity(context, dto);
  }

  @Patch('activities/:id')
  @RequireAnyPermission(
    'leadflow.appointments.item.update.assigned',
    'leadflow.appointments.item.update.client',
  )
  updateActivity(
    @RequestContextData() context: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateActivityDto,
  ) {
    return this.agendaService.updateActivity(context, id, dto);
  }

  @Delete('activities/:id')
  @RequirePermission('leadflow.appointments.item.delete.owner_only')
  @DangerousAction()
  deleteActivity(
    @RequestContextData() context: RequestContext,
    @Param('id') id: string,
  ) {
    return this.agendaService.deleteActivity(context, id);
  }
}
