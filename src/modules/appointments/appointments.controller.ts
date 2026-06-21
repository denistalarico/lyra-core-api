import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
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
import { AppointmentsService, ScheduledItemsFilters } from './appointments.service';
import { CreateScheduledItemDto } from './dto/create-scheduled-item.dto';
import { CreateScheduledItemParticipantDto } from './dto/create-scheduled-item-participant.dto';
import { CreateScheduledItemReminderDto } from './dto/create-scheduled-item-reminder.dto';
import { PatchScheduledItemDto } from './dto/patch-scheduled-item.dto';
import { PatchScheduledItemParticipantResponseDto } from './dto/patch-scheduled-item-participant-response.dto';
import { PatchScheduledItemStatusDto } from './dto/patch-scheduled-item-status.dto';

@Controller('appointments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('leadflow')
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Get()
  @RequireAnyPermission(
    'leadflow.appointments.item.view.assigned',
    'leadflow.appointments.item.view.client',
  )
  listScheduledItems(
    @RequestContextData() ctx: RequestContext,
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('assignedUserId') assignedUserId?: string,
    @Query('contactId') contactId?: string,
    @Query('sourceChannel') sourceChannel?: string,
  ) {
    const filters: ScheduledItemsFilters = {
      type,
      status,
      priority,
      assignedUserId,
      contactId,
      sourceChannel,
    };

    return this.appointmentsService.listScheduledItems(ctx, filters);
  }

  @Post()
  @RequirePermission('leadflow.appointments.item.create.client')
  createScheduledItem(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateScheduledItemDto,
  ) {
    return this.appointmentsService.createScheduledItem(ctx, dto);
  }

  @Get(':id')
  @RequireAnyPermission(
    'leadflow.appointments.item.view.assigned',
    'leadflow.appointments.item.view.client',
  )
  getScheduledItem(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.appointmentsService.getScheduledItem(ctx, id);
  }

  @Patch(':id')
  @RequireAnyPermission(
    'leadflow.appointments.item.update.assigned',
    'leadflow.appointments.item.update.client',
  )
  patchScheduledItem(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: PatchScheduledItemDto,
  ) {
    return this.appointmentsService.patchScheduledItem(ctx, id, dto);
  }

  @Patch(':id/status')
  @RequireAnyPermission(
    'leadflow.appointments.item.update.assigned',
    'leadflow.appointments.item.update.client',
  )
  patchScheduledItemStatus(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: PatchScheduledItemStatusDto,
  ) {
    return this.appointmentsService.patchScheduledItemStatus(ctx, id, dto);
  }

  @Delete(':id')
  @RequirePermission('leadflow.appointments.item.delete.owner_only')
  @DangerousAction()
  deleteScheduledItem(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.appointmentsService.deleteScheduledItem(ctx, id);
  }

  @Get(':id/participants')
  @RequireAnyPermission(
    'leadflow.appointments.item.view.assigned',
    'leadflow.appointments.item.view.client',
  )
  listParticipants(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.appointmentsService.listParticipants(ctx, id);
  }

  @Post(':id/participants')
  @RequireAnyPermission(
    'leadflow.appointments.item.update.assigned',
    'leadflow.appointments.item.update.client',
  )
  addParticipant(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: CreateScheduledItemParticipantDto,
  ) {
    return this.appointmentsService.addParticipant(ctx, id, dto);
  }

  @Patch(':id/participants/:participantId/response')
  @RequireAnyPermission(
    'leadflow.appointments.item.update.assigned',
    'leadflow.appointments.item.update.client',
  )
  patchParticipantResponse(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Param('participantId') participantId: string,
    @Body() dto: PatchScheduledItemParticipantResponseDto,
  ) {
    return this.appointmentsService.patchParticipantResponse(
      ctx,
      id,
      participantId,
      dto,
    );
  }

  @Get(':id/reminders')
  @RequireAnyPermission(
    'leadflow.appointments.item.view.assigned',
    'leadflow.appointments.item.view.client',
  )
  listReminders(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.appointmentsService.listReminders(ctx, id);
  }

  @Post(':id/reminders')
  @RequireAnyPermission(
    'leadflow.appointments.item.update.assigned',
    'leadflow.appointments.item.update.client',
  )
  addReminder(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: CreateScheduledItemReminderDto,
  ) {
    return this.appointmentsService.addReminder(ctx, id, dto);
  }

  @Post(':id/reminders/:reminderId/cancel')
  @RequireAnyPermission(
    'leadflow.appointments.item.update.assigned',
    'leadflow.appointments.item.update.client',
  )
  cancelReminder(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Param('reminderId') reminderId: string,
  ) {
    return this.appointmentsService.cancelReminder(ctx, id, reminderId);
  }
}
