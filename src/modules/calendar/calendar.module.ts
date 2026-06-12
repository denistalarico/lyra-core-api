import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { CalendarDashboardQueryService } from './calendar-dashboard-query.service';
import { CalendarEvent } from './entities/calendar-event.entity';
import { CalendarRoutineBlock } from './entities/calendar-routine-block.entity';
import { CalendarSettings } from './entities/calendar-settings.entity';

const AGENCY_CONNECTION = 'agency';

@Module({
  imports: [
    TypeOrmModule.forFeature(
      [CalendarEvent, CalendarRoutineBlock, CalendarSettings],
      AGENCY_CONNECTION,
    ),
  ],
  controllers: [CalendarController],
  providers: [CalendarService, CalendarDashboardQueryService],
  exports: [CalendarService, CalendarDashboardQueryService],
})
export class CalendarModule {}
