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
  SocialBoostRequestEntity,
  SocialAdActionPolicyEntity,
  SocialAdGovernedActionEntity,
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
import { MetaAdsManualActionAdapter } from './services/meta-ads-manual-action.adapter';
import { SocialAdActionsConfigService } from './services/social-ad-actions-config.service';
import { SocialAdManualActionService } from './services/social-ad-manual-action.service';
import { MetaAdsBoostAdapter } from './services/meta-ads-boost.adapter';
import { SocialBoostRequestService } from './services/social-boost-request.service';
import { MetaAdsBoostTargetingService } from './services/meta-ads-boost-targeting.service';
import { SocialCampaignsController } from './social-campaigns.controller';

@Module({
  imports: [
    PermissionsModule,
    SocialIntegrationsModule,
    TypeOrmModule.forFeature(
      [
        SocialBoostTemplateEntity,
        SocialBoostRequestEntity,
        SocialAdActionPolicyEntity,
        SocialAdGovernedActionEntity,
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
    MetaAdsManualActionAdapter,
    SocialAdActionsConfigService,
    SocialAdManualActionService,
    MetaAdsBoostAdapter,
    SocialBoostRequestService,
    MetaAdsBoostTargetingService,
  ],
  exports: [
    SocialBoostTemplateService,
    MetaCampaignHierarchyReadService,
    SocialCampaignMonitorService,
    SocialCampaignRecommendationService,
    SocialAdManualActionService,
    SocialBoostRequestService,
  ],
})
export class SocialCampaignsModule {}
