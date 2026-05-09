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
import { AppointmentsService, ScheduledItemsFilters } from './appointments.service';
import { CreateScheduledItemDto } from './dto/create-scheduled-item.dto';
import { CreateScheduledItemParticipantDto } from './dto/create-scheduled-item-participant.dto';
import { CreateScheduledItemReminderDto } from './dto/create-scheduled-item-reminder.dto';
import { PatchScheduledItemDto } from './dto/patch-scheduled-item.dto';
import { PatchScheduledItemParticipantResponseDto } from './dto/patch-scheduled-item-participant-response.dto';
import { PatchScheduledItemStatusDto } from './dto/patch-scheduled-item-status.dto';

@Controller('appointments')
@UseGuards(JwtAuthGuard)
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Get()
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
  createScheduledItem(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateScheduledItemDto,
  ) {
    return this.appointmentsService.createScheduledItem(ctx, dto);
  }

  @Get(':id')
  getScheduledItem(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.appointmentsService.getScheduledItem(ctx, id);
  }

  @Patch(':id')
  patchScheduledItem(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: PatchScheduledItemDto,
  ) {
    return this.appointmentsService.patchScheduledItem(ctx, id, dto);
  }

  @Patch(':id/status')
  patchScheduledItemStatus(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: PatchScheduledItemStatusDto,
  ) {
    return this.appointmentsService.patchScheduledItemStatus(ctx, id, dto);
  }

  @Delete(':id')
  deleteScheduledItem(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.appointmentsService.deleteScheduledItem(ctx, id);
  }

  @Get(':id/participants')
  listParticipants(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.appointmentsService.listParticipants(ctx, id);
  }

  @Post(':id/participants')
  addParticipant(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: CreateScheduledItemParticipantDto,
  ) {
    return this.appointmentsService.addParticipant(ctx, id, dto);
  }

  @Patch(':id/participants/:participantId/response')
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
  listReminders(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.appointmentsService.listReminders(ctx, id);
  }

  @Post(':id/reminders')
  addReminder(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: CreateScheduledItemReminderDto,
  ) {
    return this.appointmentsService.addReminder(ctx, id, dto);
  }

  @Post(':id/reminders/:reminderId/cancel')
  cancelReminder(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Param('reminderId') reminderId: string,
  ) {
    return this.appointmentsService.cancelReminder(ctx, id, reminderId);
  }
}
