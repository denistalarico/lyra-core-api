import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivitiesController } from './controllers/activities.controller';
import { ActivitiesService } from './services/activities.service';
import { AgencyActivity, AgencyActivityLink } from './entities';

const AGENCY_CONNECTION = 'agency';

@Module({
  imports: [
    TypeOrmModule.forFeature(
      [AgencyActivity, AgencyActivityLink],
      AGENCY_CONNECTION,
    ),
  ],
  controllers: [ActivitiesController],
  providers: [ActivitiesService],
  exports: [ActivitiesService],
})
export class ActivitiesModule {}
