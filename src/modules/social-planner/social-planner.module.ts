import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionsModule } from '../permissions';
import {
  SocialCampaignInstanceEntity,
  SocialCampaignTemplateEntity,
  SocialContentDestinationEntity,
  SocialContentIdeaEntity,
  SocialContentItemEntity,
  SocialDestinationCreativeEntity,
  SocialEditorialPillarEntity,
  SocialPlanEntity,
  SocialContentRevisionEntity,
  SocialPlannerSettingsEntity,
  SocialPublishingCadenceEntity,
} from './entities';
import { SocialPlannerController } from './social-planner.controller';
import { SocialContentPublicationGuard } from './services/content-publication-guard.port';
import { SocialCampaignService } from './services/social-campaign.service';
import { SocialContentLifecycleService } from './services/social-content-lifecycle.service';
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
        /**
         * Read by `SocialContentLifecycleService` so a duplicate carries its
         * creatives. The entity lives in this module (E5 put it here because
         * the Planner owns the destination); only the service that validates
         * capability lives in `social-organic`.
         */
        SocialDestinationCreativeEntity,
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
    SocialContentLifecycleService,
    SocialPlannerSettingsService,
    SocialPublishingCadenceService,
    SocialCampaignService,
    /**
     * Provided AND exported so `social-organic` can register its publication
     * source into the same instance. The Planner owns the class; Organic
     * imports this module, which is the direction that was already true.
     */
    SocialContentPublicationGuard,
  ],
  exports: [
    SocialPlannerService,
    SocialContentLifecycleService,
    SocialPlannerSettingsService,
    SocialPublishingCadenceService,
    SocialCampaignService,
    SocialContentPublicationGuard,
  ],
})
export class SocialPlannerModule {}
