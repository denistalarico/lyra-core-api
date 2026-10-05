import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MediaAssetsModule } from '../../common/media-assets';
import { BrandKitModule } from '../brand-kit/brand-kit.module';
import { PermissionsModule } from '../permissions';
import { SocialOrganicModule } from '../social-organic/social-organic.module';
import { SocialApprovalsModule } from '../social-approvals/social-approvals.module';
import { SocialPlannerModule } from '../social-planner/social-planner.module';
import { CreativeAssetService } from './creative-asset.service';
import { CreativeStudioBrandContextService } from './creative-brand-context.service';
import { CreativeFolderService } from './creative-folder.service';
import { CreativeThumbnailService } from './creative-thumbnail.service';
import { CreativeStudioController } from './creative-studio.controller';
import { CreativeVersionApprovalController } from './creative-version-approval.controller';
import { CreativeVersionApprovalService } from './creative-version-approval.service';
import {
  CreativeAssetEntity,
  CreativeAssetVersionEntity,
  CreativeFolderEntity,
} from './entities';
import {
  SocialContentItemEntity,
  SocialPlanEntity,
} from '../social-planner/entities';

@Module({
  imports: [
    PermissionsModule,
    MediaAssetsModule,
    BrandKitModule,
    SocialOrganicModule,
    SocialApprovalsModule,
    // CS2B.4: Planner status reflection goes through the Planner's own
    // `SocialContentProductionStatusService`. One-way: Studio → Planner.
    SocialPlannerModule,
    TypeOrmModule.forFeature(
      [
        CreativeAssetEntity,
        CreativeAssetVersionEntity,
        CreativeFolderEntity,
        SocialContentItemEntity,
        SocialPlanEntity,
      ],
      'agency',
    ),
  ],
  controllers: [CreativeStudioController, CreativeVersionApprovalController],
  providers: [
    CreativeAssetService,
    CreativeStudioBrandContextService,
    CreativeFolderService,
    CreativeThumbnailService,
    CreativeVersionApprovalService,
  ],
})
export class SocialCreativeStudioModule {}
