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
import {
  CreativeImageGenerationController,
  CreativeVersionVariationController,
} from './creative-image-generation.controller';
import { bindImageGenerationProvider } from './creative-image-generation.binding';
import { ImageGenerationProvider } from './creative-image-generation.provider';
import { CreativeImageGenerationService } from './creative-image-generation.service';
import { CreativeImageGenerationWorker } from './creative-image-generation.worker';
import { CreativeThumbnailService } from './creative-thumbnail.service';
import { CreativeVideoAvatarCatalogService } from './creative-video-avatar-catalog.service';
import { CreativeVideoCallbackService } from './creative-video-callback.service';
import {
  bindVideoGenerationProviders,
  CreativeVideoProviderRegistry,
} from './creative-video-generation.binding';
import { CreativeVideoGenerationConfigService } from './creative-video-generation-config';
import {
  CreativeVideoAvatarController,
  CreativeVideoCallbackController,
  CreativeVideoGenerationController,
} from './creative-video-generation.controller';
import { CreativeVideoGenerationService } from './creative-video-generation.service';
import { CreativeVideoGenerationWorker } from './creative-video-generation.worker';
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
  CreativeVideoAvatarEntity,
  CreativeVideoGenerationEntity,
  CreativeVideoOperationEntity,
  CreativeVideoReferenceEntity,
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
        // CS4-B: Reel generation, its provider-operation ledger and avatars.
        CreativeVideoGenerationEntity,
        CreativeVideoOperationEntity,
        CreativeVideoReferenceEntity,
        CreativeVideoAvatarEntity,
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
    CreativeVersionVariationController,
    CreativeVideoGenerationController,
    CreativeVideoAvatarController,
    CreativeVideoCallbackController,
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
    // CS4-B: Reels. Vidu (generative) / HeyGen (UGC) only with the global
    // switch, a dedicated key and a confirmed pricing version; else 503.
    CreativeVideoGenerationConfigService,
    {
      provide: CreativeVideoProviderRegistry,
      inject: [CreativeVideoGenerationConfigService],
      useFactory: bindVideoGenerationProviders,
    },
    CreativeVideoGenerationService,
    CreativeVideoGenerationWorker,
    CreativeVideoAvatarCatalogService,
    CreativeVideoCallbackService,
  ],
})
export class SocialCreativeStudioModule {}
