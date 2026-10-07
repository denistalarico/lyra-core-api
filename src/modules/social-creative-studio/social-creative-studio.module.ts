import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MediaAssetEntity, MediaAssetsModule } from '../../common/media-assets';
import { BrandKitModule } from '../brand-kit/brand-kit.module';
import { PermissionsModule } from '../permissions';
import { SocialOrganicModule } from '../social-organic/social-organic.module';
import { SocialApprovalsModule } from '../social-approvals/social-approvals.module';
import { SocialPlannerModule } from '../social-planner/social-planner.module';
import { CreativeAssetService } from './creative-asset.service';
import { CreativeStudioBrandContextService } from './creative-brand-context.service';
import { CreativeFolderService } from './creative-folder.service';
import { CreativeGenerationCleanupWorker } from './creative-generation-cleanup.worker';
import { CreativeGenerationConfigService } from './creative-generation-config';
import { CreativeGenerationContextService } from './creative-generation-context';
import { CreativeGenerationReferenceSelector } from './creative-generation-references';
import { CreativeImageGenerationController } from './creative-image-generation.controller';
import { bindImageGenerationProvider } from './creative-image-generation.binding';
import { ImageGenerationProvider } from './creative-image-generation.provider';
import { CreativeImageGenerationService } from './creative-image-generation.service';
import { CreativeImageGenerationWorker } from './creative-image-generation.worker';
import { CreativeThumbnailService } from './creative-thumbnail.service';
import { CreativeStudioController } from './creative-studio.controller';
import { CreativeVersionApprovalController } from './creative-version-approval.controller';
import { CreativeVersionApprovalService } from './creative-version-approval.service';
import {
  CreativeAssetEntity,
  CreativeAssetVersionEntity,
  CreativeFolderEntity,
  CreativeGenerationEntity,
  CreativeGenerationOutputEntity,
  CreativeGenerationReferenceEntity,
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
        CreativeGenerationEntity,
        CreativeGenerationOutputEntity,
        CreativeGenerationReferenceEntity,
        // CS3.2: reads the metadata of its own temporary outputs (scoped).
        MediaAssetEntity,
        SocialContentItemEntity,
        SocialPlanEntity,
      ],
      'agency',
    ),
  ],
  controllers: [
    CreativeStudioController,
    CreativeVersionApprovalController,
    CreativeImageGenerationController,
  ],
  providers: [
    CreativeAssetService,
    CreativeStudioBrandContextService,
    CreativeFolderService,
    CreativeThumbnailService,
    CreativeVersionApprovalService,
    CreativeImageGenerationService,
    CreativeImageGenerationWorker,
    // CS3.6.1: expires temporary outputs; off unless explicitly enabled.
    CreativeGenerationCleanupWorker,
    CreativeGenerationConfigService,
    CreativeGenerationContextService,
    CreativeGenerationReferenceSelector,
    // CS3.3: OpenAI only when explicitly enabled by env; disabled otherwise.
    {
      provide: ImageGenerationProvider,
      inject: [CreativeGenerationConfigService],
      useFactory: bindImageGenerationProvider,
    },
  ],
})
export class SocialCreativeStudioModule {}
