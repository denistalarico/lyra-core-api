import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionsModule } from '../permissions';
import {
  SocialAdAccountConnectionEntity,
  SocialAdEntity,
  SocialAdMetricDailyEntity,
} from '../social-integrations/entities';
import {
  SocialBoostTemplateEntity,
  SocialCampaignAlertEntity,
  SocialCampaignMonitorPolicyEntity,
} from './entities';
import { MetaCampaignHierarchyReadService } from './services/meta-campaign-hierarchy-read.service';
import { SocialCampaignMonitorScheduler } from './services/social-campaign-monitor.scheduler';
import { SocialCampaignMonitorService } from './services/social-campaign-monitor.service';
import { SocialBoostTemplateService } from './services/social-boost-template.service';
import { SocialCampaignsController } from './social-campaigns.controller';

@Module({
  imports: [
    PermissionsModule,
    TypeOrmModule.forFeature(
      [
        SocialBoostTemplateEntity,
        SocialCampaignMonitorPolicyEntity,
        SocialCampaignAlertEntity,
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
  ],
  exports: [
    SocialBoostTemplateService,
    MetaCampaignHierarchyReadService,
    SocialCampaignMonitorService,
  ],
})
export class SocialCampaignsModule {}
