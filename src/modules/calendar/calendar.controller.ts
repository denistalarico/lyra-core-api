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
import {
  DangerousAction,
  RequireAnyPermission,
  RequirePermission,
} from '../permissions';

@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  @Get('settings')
  @RequirePermission('agency.calendar.settings.manage.admin')
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
  @RequirePermission('agency.calendar.settings.manage.admin')
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
  @RequirePermission('agency.calendar.settings.manage.admin')
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
  @RequireAnyPermission(
    'agency.calendar.events.view.self',
    'agency.calendar.events.view.department',
    'agency.calendar.events.view.all',
  )
  listEvents(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Headers('x-user-id') userId: string | undefined,
    @Headers('x-user-role') userRole: string | undefined,
    @Headers('x-role') role: string | undefined,
    @Query('startsAt') startsAt?: string,
    @Query('endsAt') endsAt?: string,
  ) {
    return this.calendarService.listEvents(
      {
        tenantId,
        workspaceId: workspaceId ?? null,
        userId: userId ?? null,
        role: userRole ?? role ?? 'member',
      },
      { startsAt, endsAt },
    );
  }

  @Post('events')
  @RequireAnyPermission(
    'agency.calendar.events.manage.self',
    'agency.calendar.events.manage.department',
    'agency.calendar.events.view.all',
  )
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
  @RequireAnyPermission(
    'agency.calendar.events.manage.self',
    'agency.calendar.events.manage.department',
    'agency.calendar.events.view.all',
  )
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
  @RequireAnyPermission(
    'agency.calendar.events.manage.self',
    'agency.calendar.events.manage.department',
    'agency.calendar.events.view.all',
  )
  @DangerousAction()
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
  @RequirePermission('agency.calendar.events.view.self')
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
  @RequirePermission('agency.calendar.events.manage.self')
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
  @RequirePermission('agency.calendar.events.manage.self')
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
  @RequirePermission('agency.calendar.events.manage.self')
  @DangerousAction()
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
