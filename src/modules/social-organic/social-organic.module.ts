import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingsCryptoService } from '../../common/crypto/settings-crypto.service';
import { FilesModule } from '../../common/files/files.module';
import {
  MEDIA_ASSET_METADATA_READER,
  MediaAssetController,
  MediaAssetUploadService,
  MediaAssetsModule,
} from '../../common/media-assets';
import { PermissionsModule } from '../permissions';
import { NotificationsModule } from '../notifications';
import { AgencyWorkspaceUserEntity } from '../agency/entities/agency-settings.entities';
import { SocialIntegrationsModule } from '../social-integrations/social-integrations.module';
import {
  MetaOrganicInsightsService,
  SocialConsolidatedAnalyticsService,
  SocialOrganicAccountMetricDailyEntity,
  SocialOrganicAnalyticsController,
  SocialOrganicAnalyticsReadService,
  SocialOrganicMetricsWriterService,
  SocialOrganicPostMetricDailyEntity,
  SocialOrganicSyncRunEntity,
  SocialOrganicSyncRunService,
  SocialOrganicSyncScheduler,
  SocialOrganicSyncWorker,
} from './analytics';
import { SocialContentDestinationEntity } from '../social-planner/entities/social-content-destination.entity';
import { SocialContentItemEntity } from '../social-planner/entities/social-content-item.entity';
import { SocialDestinationCreativeEntity } from '../social-planner/entities/social-destination-creative.entity';
import { SocialPlannerModule } from '../social-planner/social-planner.module';
import {
  SOCIAL_ORGANIC_OAUTH_PROVIDERS,
  SocialOrganicController,
  SocialOrganicConnectionService,
  SocialOrganicHealthScheduler,
  SocialOrganicOAuthProviderRegistry,
  SocialOrganicOAuthService,
} from './connections';
import { SocialOrganicCredentialResolver } from './credentials';
import {
  SocialOrganicAssetEntity,
  SocialOrganicConnectionEntity,
} from './entities';
import { MediaMetadataService } from './media/media-metadata.service';
import { MediaPreparationService } from './media/media-preparation.service';
import {
  DestinationCreativeController,
  DestinationCreativeService,
  SocialPublicationController,
  SocialPublicationEntity,
  SocialContentPublicationSourceService,
  SocialPublicationConfigService,
  SocialPublicationRunService,
  SocialPublicationScheduler,
  SocialPublicationService,
  SocialPublicationNotificationPublisher,
  SocialPublicationWorker,
} from './publication';
import { SocialPublicationExecutorService } from './publication/social-publication.executor';
import { SOCIAL_PUBLICATION_EXECUTOR } from './publication/social-publication.worker';
import {
  FacebookPublisherAdapter,
  InstagramPublisherAdapter,
  MetaOrganicAssetDiscoveryService,
  MetaOrganicGraphService,
  MetaOrganicHealthService,
  MetaOrganicOAuthProvider,
  MetaPublisherRegistration,
  SocialPublisherRegistry,
} from './providers';
import {
  MetaOrganicWebhookController,
  MetaOrganicWebhookSignatureService,
  SocialOrganicInteractionEntity,
  SocialOrganicInteractionService,
  SocialOrganicWebhookEventEntity,
  SocialOrganicWebhookService,
  SocialOrganicWebhookWorker,
} from './webhooks';

export function createMetaOrganicOAuthProviders(
  meta: MetaOrganicOAuthProvider,
) {
  return [meta];
}

@Module({
  imports: [
    PermissionsModule,
    NotificationsModule,
    FilesModule,
    MediaAssetsModule,
    // A4 injects `SocialAnalyticsReadService` for the consolidated
    // paid+organic view. `SocialIntegrationsModule` imports nothing from
    // this module (confirmed before wiring), so this is a one-directional
    // dependency — mirrors `intelligence-analytics.module.ts`'s own import
    // of `SocialIntegrationsModule` for the same service.
    SocialIntegrationsModule,
    /**
     * Imported for `SocialContentPublicationGuard` (E6), which the Planner owns
     * and this module registers into on init so the Planner can refuse to
     * delete content that still has live publications.
     *
     * This is the arrow that already existed, now made explicit at the module
     * level: `social-organic` depends on `social-planner`, never the reverse.
     * `SocialPlannerModule` imports only `PermissionsModule` and TypeORM, so
     * there is no cycle to break here.
     */
    SocialPlannerModule,
    TypeOrmModule.forFeature(
      [
        SocialOrganicConnectionEntity,
        SocialOrganicAssetEntity,
        SocialPublicationEntity,
        AgencyWorkspaceUserEntity,
        SocialContentItemEntity,
        SocialContentDestinationEntity,
        SocialDestinationCreativeEntity,
        SocialOrganicPostMetricDailyEntity,
        SocialOrganicAccountMetricDailyEntity,
        SocialOrganicSyncRunEntity,
        SocialOrganicWebhookEventEntity,
        SocialOrganicInteractionEntity,
      ],
      'agency',
    ),
  ],
  controllers: [
    SocialOrganicController,
    SocialPublicationController,
    // Serves `/social/planner/...` paths from this module because choosing a
    // creative must be validated against the provider registry, which lives
    // here. The module arrow social-organic → social-planner already exists
    // and is never inverted; see the controller's own docblock.
    DestinationCreativeController,
    // Mounted here rather than in `MediaAssetsModule`: the endpoint's
    // authorization is Social's (see the controller's own docblock), so the
    // shared boundary must not force it on every importer.
    MediaAssetController,
    MetaOrganicWebhookController,
    SocialOrganicAnalyticsController,
  ],
  providers: [
    MetaOrganicGraphService,
    MetaOrganicAssetDiscoveryService,
    MetaOrganicOAuthProvider,
    {
      provide: SOCIAL_ORGANIC_OAUTH_PROVIDERS,
      useFactory: createMetaOrganicOAuthProviders,
      inject: [MetaOrganicOAuthProvider],
    },
    SocialOrganicCredentialResolver,
    SocialOrganicOAuthProviderRegistry,
    SocialOrganicOAuthService,
    SocialOrganicConnectionService,
    SocialPublicationRunService,
    SocialPublicationNotificationPublisher,
    SocialPublicationScheduler,
    SocialPublicationService,
    SocialPublicationWorker,
    SocialPublicationConfigService,
    DestinationCreativeService,
    /**
     * Registers itself into the Planner's guard on init, so deleting content
     * can be refused when a live publication would be stranded (E6).
     */
    SocialContentPublicationSourceService,
    SocialPublisherRegistry,
    FacebookPublisherAdapter,
    InstagramPublisherAdapter,
    MetaPublisherRegistration,
    MetaOrganicHealthService,
    SocialOrganicHealthScheduler,
    MetaOrganicInsightsService,
    SocialOrganicMetricsWriterService,
    SocialOrganicSyncRunService,
    SocialOrganicSyncScheduler,
    SocialOrganicSyncWorker,
    SocialOrganicAnalyticsReadService,
    SocialConsolidatedAnalyticsService,
    MetaOrganicWebhookSignatureService,
    SocialOrganicWebhookService,
    SocialOrganicInteractionService,
    SocialOrganicWebhookWorker,
    SettingsCryptoService,
    MediaPreparationService,
    MediaMetadataService,
    MediaAssetUploadService,
    // Binds M2's extractor to the port `common/media-assets` declares, so the
    // shared boundary reads media metadata without importing a product module.
    // The arrow stays social-organic → common, never the reverse.
    {
      provide: MEDIA_ASSET_METADATA_READER,
      useExisting: MediaMetadataService,
    },
    SocialPublicationExecutorService,
    {
      provide: SOCIAL_PUBLICATION_EXECUTOR,
      useExisting: SocialPublicationExecutorService,
    },
  ],
  exports: [
    SocialOrganicCredentialResolver,
    SocialOrganicOAuthProviderRegistry,
    SocialOrganicOAuthService,
    SocialOrganicConnectionService,
    SocialPublicationRunService,
    SocialPublicationService,
    SocialPublisherRegistry,
    SocialOrganicSyncRunService,
    SocialOrganicAnalyticsReadService,
  ],
})
export class SocialOrganicModule {}
