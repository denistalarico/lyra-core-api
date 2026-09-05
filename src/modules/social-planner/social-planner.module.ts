import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionsModule } from '../permissions';
import {
  SocialContentDestinationEntity,
  SocialContentItemEntity,
  SocialPlanEntity,
  SocialContentRevisionEntity,
  SocialPlannerSettingsEntity,
  SocialPublishingCadenceEntity,
} from './entities';
import { SocialPlannerController } from './social-planner.controller';
import { SocialPlannerService } from './services/social-planner.service';
import { SocialPlannerSettingsService } from './services/social-planner-settings.service';
import { SocialPublishingCadenceService } from './services/social-publishing-cadence.service';

@Module({
  imports: [
    PermissionsModule,
    TypeOrmModule.forFeature(
      [
        SocialPlanEntity,
        SocialContentItemEntity,
        SocialContentDestinationEntity,
        SocialContentRevisionEntity,
        SocialPlannerSettingsEntity,
        SocialPublishingCadenceEntity,
      ],
      'agency',
    ),
  ],
  controllers: [SocialPlannerController],
  providers: [
    SocialPlannerService,
    SocialPlannerSettingsService,
    SocialPublishingCadenceService,
  ],
  exports: [
    SocialPlannerService,
    SocialPlannerSettingsService,
    SocialPublishingCadenceService,
  ],
})
export class SocialPlannerModule {}
