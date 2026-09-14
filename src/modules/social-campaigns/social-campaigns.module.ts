import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionsModule } from '../permissions';
import { SocialBoostTemplateEntity } from './entities';
import { SocialBoostTemplateService } from './services/social-boost-template.service';
import { SocialCampaignsController } from './social-campaigns.controller';

@Module({
  imports: [
    PermissionsModule,
    TypeOrmModule.forFeature([SocialBoostTemplateEntity], 'agency'),
  ],
  controllers: [SocialCampaignsController],
  providers: [SocialBoostTemplateService],
  exports: [SocialBoostTemplateService],
})
export class SocialCampaignsModule {}
