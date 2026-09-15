import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionsModule } from '../permissions';
import {
  SocialAdAccountConnectionEntity,
  SocialAdEntity,
  SocialAdMetricDailyEntity,
} from '../social-integrations/entities';
import { SocialBoostTemplateEntity } from './entities';
import { MetaCampaignHierarchyReadService } from './services/meta-campaign-hierarchy-read.service';
import { SocialBoostTemplateService } from './services/social-boost-template.service';
import { SocialCampaignsController } from './social-campaigns.controller';

@Module({
  imports: [
    PermissionsModule,
    TypeOrmModule.forFeature(
      [
        SocialBoostTemplateEntity,
        SocialAdAccountConnectionEntity,
        SocialAdEntity,
        SocialAdMetricDailyEntity,
      ],
      'agency',
    ),
  ],
  controllers: [SocialCampaignsController],
  providers: [SocialBoostTemplateService, MetaCampaignHierarchyReadService],
  exports: [SocialBoostTemplateService, MetaCampaignHierarchyReadService],
})
export class SocialCampaignsModule {}
