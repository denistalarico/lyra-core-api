import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CalendarService } from './calendar.service';
import { CreateCalendarEventDto } from './dto/create-calendar-event.dto';
import { UpdateCalendarEventDto } from './dto/update-calendar-event.dto';
import { CreateCalendarRoutineBlockDto } from './dto/create-calendar-routine-block.dto';
import { UpdateCalendarRoutineBlockDto } from './dto/update-calendar-routine-block.dto';
import { UpdateCalendarSettingsDto } from './dto/update-calendar-settings.dto';

@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  @Get('settings')
  getSettings(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Headers('x-user-id') userId: string | undefined,
  ) {
    return this.calendarService.getSettings({
      tenantId,
      workspaceId: workspaceId ?? null,
      userId: userId ?? null,
    });
  }

  @Patch('settings')
  updateSettings(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Headers('x-user-id') userId: string | undefined,
    @Body() dto: UpdateCalendarSettingsDto,
  ) {
    return this.calendarService.updateSettings(
      {
        tenantId,
        workspaceId: workspaceId ?? null,
        userId: userId ?? null,
      },
      dto,
    );
  }

  @Post('settings/reset')
  resetSettings(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Headers('x-user-id') userId: string | undefined,
  ) {
    return this.calendarService.resetSettings({
      tenantId,
      workspaceId: workspaceId ?? null,
      userId: userId ?? null,
    });
  }

  @Get('events')
  listEvents(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Headers('x-user-id') userId: string | undefined,
    @Query('startsAt') startsAt?: string,
    @Query('endsAt') endsAt?: string,
  ) {
    return this.calendarService.listEvents(
      { tenantId, workspaceId: workspaceId ?? null, userId: userId ?? null },
      { startsAt, endsAt },
    );
  }

  @Post('events')
  createEvent(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Headers('x-user-id') userId: string | undefined,
    @Body() dto: CreateCalendarEventDto,
  ) {
    return this.calendarService.createEvent(
      { tenantId, workspaceId: workspaceId ?? null, userId: userId ?? null },
      dto,
    );
  }

  @Patch('events/:eventId')
  updateEvent(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Headers('x-user-id') userId: string | undefined,
    @Param('eventId') eventId: string,
    @Body() dto: UpdateCalendarEventDto,
  ) {
    return this.calendarService.updateEvent(
      { tenantId, workspaceId: workspaceId ?? null, userId: userId ?? null },
      eventId,
      dto,
    );
  }

  @Delete('events/:eventId')
  removeEvent(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Headers('x-user-id') userId: string | undefined,
    @Param('eventId') eventId: string,
  ) {
    return this.calendarService.removeEvent(
      { tenantId, workspaceId: workspaceId ?? null, userId: userId ?? null },
      eventId,
    );
  }

  @Get('routine-blocks')
  listRoutineBlocks(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Headers('x-user-id') userId: string | undefined,
  ) {
    return this.calendarService.listRoutineBlocks({
      tenantId,
      workspaceId: workspaceId ?? null,
      userId: userId ?? null,
    });
  }

  @Post('routine-blocks')
  createRoutineBlock(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Headers('x-user-id') userId: string | undefined,
    @Body() dto: CreateCalendarRoutineBlockDto,
  ) {
    return this.calendarService.createRoutineBlock(
      { tenantId, workspaceId: workspaceId ?? null, userId: userId ?? null },
      dto,
    );
  }

  @Patch('routine-blocks/:blockId')
  updateRoutineBlock(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Headers('x-user-id') userId: string | undefined,
    @Param('blockId') blockId: string,
    @Body() dto: UpdateCalendarRoutineBlockDto,
  ) {
    return this.calendarService.updateRoutineBlock(
      { tenantId, workspaceId: workspaceId ?? null, userId: userId ?? null },
      blockId,
      dto,
    );
  }

  @Delete('routine-blocks/:blockId')
  removeRoutineBlock(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Headers('x-user-id') userId: string | undefined,
    @Param('blockId') blockId: string,
  ) {
    return this.calendarService.removeRoutineBlock(
      { tenantId, workspaceId: workspaceId ?? null, userId: userId ?? null },
      blockId,
    );
  }
}
