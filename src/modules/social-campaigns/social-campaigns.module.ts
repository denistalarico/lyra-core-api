import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionsModule } from '../permissions';
import { SocialIntegrationsModule } from '../social-integrations';
import {
  SocialAdAccountConnectionEntity,
  SocialAdEntity,
  SocialAdMetricDailyEntity,
} from '../social-integrations/entities';
import {
  SocialBoostTemplateEntity,
  SocialCampaignAlertEntity,
  SocialCampaignMonitorPolicyEntity,
  SocialCampaignRecommendationEntity,
} from './entities';
import { MetaCampaignHierarchyReadService } from './services/meta-campaign-hierarchy-read.service';
import { SocialCampaignMonitorScheduler } from './services/social-campaign-monitor.scheduler';
import { SocialCampaignMonitorService } from './services/social-campaign-monitor.service';
import { SocialCampaignRecommendationConfigService } from './services/social-campaign-recommendation-config.service';
import { SocialCampaignRecommendationProvider } from './services/social-campaign-recommendation.provider';
import { SocialCampaignRecommendationService } from './services/social-campaign-recommendation.service';
import { SocialBoostTemplateService } from './services/social-boost-template.service';
import { SocialCampaignsController } from './social-campaigns.controller';

@Module({
  imports: [
    PermissionsModule,
    SocialIntegrationsModule,
    TypeOrmModule.forFeature(
      [
        SocialBoostTemplateEntity,
        SocialCampaignMonitorPolicyEntity,
        SocialCampaignAlertEntity,
        SocialCampaignRecommendationEntity,
        SocialAdAccountConnectionEntity,
        SocialAdEntity,
        SocialAdMetricDailyEntity,
      ],
      'agency',
    ),
  ],
  controllers: [SocialCampaignsController],
  providers: [
    SocialBoostTemplateService,
    MetaCampaignHierarchyReadService,
    SocialCampaignMonitorService,
    SocialCampaignMonitorScheduler,
    SocialCampaignRecommendationConfigService,
    SocialCampaignRecommendationProvider,
    SocialCampaignRecommendationService,
  ],
  exports: [
    SocialBoostTemplateService,
    MetaCampaignHierarchyReadService,
    SocialCampaignMonitorService,
    SocialCampaignRecommendationService,
  ],
})
export class SocialCampaignsModule {}
