jest.mock('@nestjs/typeorm', () => ({
  InjectDataSource: jest.fn(() => jest.fn()),
  InjectRepository: jest.fn(() => jest.fn()),
  TypeOrmModule: {
    forFeature: jest.fn(() => class AgencySocialOrganicTypeOrmFeatureModule {}),
  },
}));

import { MODULE_METADATA } from '@nestjs/common/constants';
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
import { SocialPlannerModule } from '../social-planner/social-planner.module';
import {
  MetaOrganicAudienceService,
  MetaOrganicOnlineFollowersService,
  MetaOrganicStoriesService,
  SocialOrganicStoryWriterService,
  SocialOrganicStoriesScheduler,
  MetaOrganicPeriodReachService,
  SocialOrganicOnlineFollowersWriterService,
  SocialOrganicReachPeriodWriterService,
  MetaOrganicInsightsService,
  SocialConsolidatedAnalyticsService,
  SocialOrganicAccountMetricDailyEntity,
  SocialOrganicReachPeriodEntity,
  SocialOrganicAnalyticsController,
  SocialOrganicAudienceConfigService,
  SocialOrganicAudienceDailyEntity,
  SocialOrganicOnlineFollowersEntity,
  SocialOrganicStoryEntity,
  SocialOrganicActivityReadService,
  SocialOrganicAudienceReadService,
  SocialOrganicThumbnailService,
  SocialOrganicAudienceWriterService,
  SocialOrganicAnalyticsReadService,
  SocialOrganicMetricsWriterService,
  SocialOrganicPostMetricDailyEntity,
  SocialOrganicSyncRunEntity,
  SocialOrganicSyncRunService,
  SocialOrganicSyncScheduler,
  SocialOrganicSyncWorker,
} from './analytics';
import { SocialContentDestinationEntity } from '../social-planner/entities/social-content-destination.entity';
import { SocialDestinationCreativeEntity } from '../social-planner/entities/social-destination-creative.entity';
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
import { MediaMetadataService } from './media/media-metadata.service';
import { MediaPreparationService } from './media/media-preparation.service';
import {
  DestinationCreativeController,
  DestinationCreativeService,
  SocialContentPublicationSourceService,
  SocialPublicationController,
  SocialPublicationEntity,
  SocialPublicationMediaEntity,
  SocialPublicationConfigService,
  SocialPublicationNotificationPublisher,
  SocialPublicationRunService,
  SocialPublicationScheduler,
  SocialPublicationService,
  SocialPublicationWorker,
} from './publication';
import { SocialPublicationExecutorService } from './publication/social-publication.executor';
import { SOCIAL_PUBLICATION_EXECUTOR } from './publication/social-publication.worker';
import {
  FacebookPublisherAdapter,
  DirectInstagramPublisherAdapter,
  InstagramPublisherAdapter,
  MetaInstagramAssetDiscoveryService,
  MetaInstagramOAuthProvider,
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
import {
  createMetaOrganicOAuthProviders,
  SocialOrganicModule,
} from './social-organic.module';

describe('SocialOrganicModule', () => {
  it('binds repositories and the credential boundary to the agency module', () => {
    expect((TypeOrmModule.forFeature as jest.Mock).mock.calls).toContainEqual([
      [
        SocialOrganicConnectionEntity,
        SocialOrganicAssetEntity,
        SocialPublicationEntity,
        SocialPublicationMediaEntity,
        AgencyWorkspaceUserEntity,
        SocialContentItemEntity,
        SocialContentDestinationEntity,
        SocialDestinationCreativeEntity,
        SocialOrganicPostMetricDailyEntity,
        SocialOrganicAccountMetricDailyEntity,
        SocialOrganicReachPeriodEntity,
        SocialOrganicAudienceDailyEntity,
        SocialOrganicOnlineFollowersEntity,
        SocialOrganicStoryEntity,
        SocialOrganicSyncRunEntity,
        SocialOrganicWebhookEventEntity,
        SocialOrganicInteractionEntity,
      ],
      'agency',
    ]);
    expect(
      Reflect.getMetadata(MODULE_METADATA.IMPORTS, SocialOrganicModule),
    ).toContain(PermissionsModule);
    expect(
      Reflect.getMetadata(MODULE_METADATA.IMPORTS, SocialOrganicModule),
    ).toContain(NotificationsModule);
    expect(
      Reflect.getMetadata(MODULE_METADATA.IMPORTS, SocialOrganicModule),
    ).toContain(FilesModule);
    expect(
      Reflect.getMetadata(MODULE_METADATA.IMPORTS, SocialOrganicModule),
    ).toContain(MediaAssetsModule);
    expect(
      Reflect.getMetadata(MODULE_METADATA.IMPORTS, SocialOrganicModule),
    ).toContain(SocialIntegrationsModule);
    /**
     * The E6 delete guard: Organic imports the Planner to register its
     * publication source into the guard the Planner owns. Asserted here so a
     * future edit cannot quietly invert the arrow by moving the guard into
     * this module instead.
     */
    expect(
      Reflect.getMetadata(MODULE_METADATA.IMPORTS, SocialOrganicModule),
    ).toContain(SocialPlannerModule);
    expect(
      Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, SocialOrganicModule),
    ).toEqual([
      SocialOrganicController,
      SocialPublicationController,
      DestinationCreativeController,
      MediaAssetController,
      MetaOrganicWebhookController,
      SocialOrganicAnalyticsController,
    ]);
    expect(
      Reflect.getMetadata(MODULE_METADATA.PROVIDERS, SocialOrganicModule),
    ).toEqual([
      MetaOrganicGraphService,
      MetaOrganicAssetDiscoveryService,
      MetaOrganicOAuthProvider,
      MetaInstagramAssetDiscoveryService,
      MetaInstagramOAuthProvider,
      {
        provide: SOCIAL_ORGANIC_OAUTH_PROVIDERS,
        useFactory: createMetaOrganicOAuthProviders,
        inject: [MetaOrganicOAuthProvider, MetaInstagramOAuthProvider],
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
      SocialContentPublicationSourceService,
      SocialPublisherRegistry,
      FacebookPublisherAdapter,
      InstagramPublisherAdapter,
      DirectInstagramPublisherAdapter,
      MetaPublisherRegistration,
      MetaOrganicHealthService,
      SocialOrganicHealthScheduler,
      MetaOrganicInsightsService,
      SocialOrganicMetricsWriterService,
      SocialOrganicAudienceConfigService,
      MetaOrganicAudienceService,
      MetaOrganicPeriodReachService,
      SocialOrganicReachPeriodWriterService,
      SocialOrganicAudienceWriterService,
      SocialOrganicAudienceReadService,
      MetaOrganicOnlineFollowersService,
      SocialOrganicOnlineFollowersWriterService,
      MetaOrganicStoriesService,
      SocialOrganicStoryWriterService,
      SocialOrganicStoriesScheduler,
      SocialOrganicActivityReadService,
      SocialOrganicThumbnailService,
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
      // The port binding that lets `common/media-assets` read media metadata
      // without importing this product module.
      {
        provide: MEDIA_ASSET_METADATA_READER,
        useExisting: MediaMetadataService,
      },
      SocialPublicationExecutorService,
      {
        provide: SOCIAL_PUBLICATION_EXECUTOR,
        useExisting: SocialPublicationExecutorService,
      },
    ]);
    expect(
      Reflect.getMetadata(MODULE_METADATA.EXPORTS, SocialOrganicModule),
    ).toEqual([
      // Re-exported so `SocialCreativeStudioModule`, which imports this
      // module, resolves the shared upload service and the metadata port
      // bound here. Without them the Creative Studio's providers cannot be
      // constructed.
      MediaAssetUploadService,
      MEDIA_ASSET_METADATA_READER,
      SocialOrganicCredentialResolver,
      SocialOrganicOAuthProviderRegistry,
      SocialOrganicOAuthService,
      SocialOrganicConnectionService,
      SocialPublicationRunService,
      SocialPublicationService,
      SocialPublisherRegistry,
      SocialOrganicSyncRunService,
      SocialOrganicAnalyticsReadService,
    ]);
  });
});
