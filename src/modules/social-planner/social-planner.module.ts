import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionsModule } from '../permissions';
import {
  SocialCampaignInstanceEntity,
  SocialCampaignTemplateEntity,
  SocialContentDestinationEntity,
  SocialContentIdeaEntity,
  SocialContentItemEntity,
  SocialEditorialPillarEntity,
  SocialPlanEntity,
  SocialContentRevisionEntity,
  SocialPlannerSettingsEntity,
  SocialPublishingCadenceEntity,
} from './entities';
import { SocialPlannerController } from './social-planner.controller';
import { SocialCampaignService } from './services/social-campaign.service';
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
        SocialCampaignTemplateEntity,
        SocialCampaignInstanceEntity,
        SocialEditorialPillarEntity,
        SocialContentIdeaEntity,
      ],
      'agency',
    ),
  ],
  controllers: [SocialPlannerController],
  providers: [
    SocialPlannerService,
    SocialPlannerSettingsService,
    SocialPublishingCadenceService,
    SocialCampaignService,
  ],
  exports: [
    SocialPlannerService,
    SocialPlannerSettingsService,
    SocialPublishingCadenceService,
    SocialCampaignService,
  ],
})
export class SocialPlannerModule {}
