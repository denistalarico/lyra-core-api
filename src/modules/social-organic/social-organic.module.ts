import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingsCryptoService } from '../../common/crypto/settings-crypto.service';
import { FilesModule } from '../../common/files/files.module';
import { MediaAssetsModule } from '../../common/media-assets';
import { PermissionsModule } from '../permissions';
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
import { MediaPreparationService } from './media/media-preparation.service';
import {
  SocialPublicationController,
  SocialPublicationEntity,
  SocialPublicationConfigService,
  SocialPublicationRunService,
  SocialPublicationScheduler,
  SocialPublicationService,
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
    FilesModule,
    MediaAssetsModule,
    // A4 injects `SocialAnalyticsReadService` for the consolidated
    // paid+organic view. `SocialIntegrationsModule` imports nothing from
    // this module (confirmed before wiring), so this is a one-directional
    // dependency — mirrors `intelligence-analytics.module.ts`'s own import
    // of `SocialIntegrationsModule` for the same service.
    SocialIntegrationsModule,
    TypeOrmModule.forFeature(
      [
        SocialOrganicConnectionEntity,
        SocialOrganicAssetEntity,
        SocialPublicationEntity,
        SocialContentItemEntity,
        SocialContentDestinationEntity,
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
    SocialPublicationScheduler,
    SocialPublicationService,
    SocialPublicationWorker,
    SocialPublicationConfigService,
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
