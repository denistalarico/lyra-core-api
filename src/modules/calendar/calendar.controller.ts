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
import { CalendarService } from './calendar.service';
import { CreateCalendarEventDto } from './dto/create-calendar-event.dto';
import { UpdateCalendarEventDto } from './dto/update-calendar-event.dto';
import { CreateCalendarRoutineBlockDto } from './dto/create-calendar-routine-block.dto';
import { UpdateCalendarRoutineBlockDto } from './dto/update-calendar-routine-block.dto';
import { UpdateCalendarSettingsDto } from './dto/update-calendar-settings.dto';
import {
  DangerousAction,
  PermissionsGuard,
  RequireAnyPermission,
  RequirePermission,
} from '../permissions';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  AuthorizedContext,
  type AuthorizedRequestContext,
} from '../../common/context/authorized-context.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  @Get('settings')
  @RequirePermission('agency.calendar.settings.manage.admin')
  getSettings(@AuthorizedContext() context: AuthorizedRequestContext) {
    return this.calendarService.getSettings(context);
  }

  @Patch('settings')
  @RequirePermission('agency.calendar.settings.manage.admin')
  updateSettings(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Body() dto: UpdateCalendarSettingsDto,
  ) {
    return this.calendarService.updateSettings(context, dto);
  }

  @Post('settings/reset')
  @RequirePermission('agency.calendar.settings.manage.admin')
  resetSettings(@AuthorizedContext() context: AuthorizedRequestContext) {
    return this.calendarService.resetSettings(context);
  }

  @Get('events')
  @RequireAnyPermission(
    'agency.calendar.events.view.self',
    'agency.calendar.events.view.department',
    'agency.calendar.events.view.all',
  )
  listEvents(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Query('startsAt') startsAt?: string,
    @Query('endsAt') endsAt?: string,
  ) {
    return this.calendarService.listEvents(context, { startsAt, endsAt });
  }

  @Post('events')
  @RequireAnyPermission(
    'agency.calendar.events.manage.self',
    'agency.calendar.events.manage.department',
    'agency.calendar.events.view.all',
  )
  createEvent(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Body() dto: CreateCalendarEventDto,
  ) {
    return this.calendarService.createEvent(context, dto);
  }

  @Patch('events/:eventId')
  @RequireAnyPermission(
    'agency.calendar.events.manage.self',
    'agency.calendar.events.manage.department',
    'agency.calendar.events.view.all',
  )
  updateEvent(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('eventId') eventId: string,
    @Body() dto: UpdateCalendarEventDto,
  ) {
    return this.calendarService.updateEvent(context, eventId, dto);
  }

  @Delete('events/:eventId')
  @RequireAnyPermission(
    'agency.calendar.events.manage.self',
    'agency.calendar.events.manage.department',
    'agency.calendar.events.view.all',
  )
  @DangerousAction()
  removeEvent(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('eventId') eventId: string,
  ) {
    return this.calendarService.removeEvent(context, eventId);
  }

  @Get('routine-blocks')
  @RequirePermission('agency.calendar.events.view.self')
  listRoutineBlocks(@AuthorizedContext() context: AuthorizedRequestContext) {
    return this.calendarService.listRoutineBlocks(context);
  }

  @Post('routine-blocks')
  @RequirePermission('agency.calendar.events.manage.self')
  createRoutineBlock(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Body() dto: CreateCalendarRoutineBlockDto,
  ) {
    return this.calendarService.createRoutineBlock(context, dto);
  }

  @Patch('routine-blocks/:blockId')
  @RequirePermission('agency.calendar.events.manage.self')
  updateRoutineBlock(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('blockId') blockId: string,
    @Body() dto: UpdateCalendarRoutineBlockDto,
  ) {
    return this.calendarService.updateRoutineBlock(context, blockId, dto);
  }

  @Delete('routine-blocks/:blockId')
  @RequirePermission('agency.calendar.events.manage.self')
  @DangerousAction()
  removeRoutineBlock(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('blockId') blockId: string,
  ) {
    return this.calendarService.removeRoutineBlock(context, blockId);
  }
}
