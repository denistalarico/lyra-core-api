jest.mock('@nestjs/typeorm', () => ({
  InjectDataSource: jest.fn(() => jest.fn()),
  InjectRepository: jest.fn(() => jest.fn()),
  TypeOrmModule: {
    forFeature: jest.fn(() => class AgencySocialOrganicTypeOrmFeatureModule {}),
  },
}));

import { MODULE_METADATA } from '@nestjs/common/constants';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CompanyProductsModule } from '../../common/company-products/company-products.module';
import { SettingsCryptoService } from '../../common/crypto/settings-crypto.service';
import { FilesModule } from '../../common/files/files.module';
import { LinkedInOrganicAnalyticsProvider } from './analytics/linkedin/linkedin-organic-analytics.provider';
import { TiktokOrganicAnalyticsProvider } from './analytics/tiktok/tiktok-organic-analytics.provider';
import { YoutubeAnalyticsClient } from './analytics/youtube/youtube-analytics.client';
import { YoutubeOrganicAnalyticsProvider } from './analytics/youtube/youtube-organic-analytics.provider';
import { YoutubeDataRetentionScheduler } from './analytics/youtube/youtube-data-retention.scheduler';
import { YoutubeDataRetentionService } from './analytics/youtube/youtube-data-retention.service';
import { YoutubeOrganicHealthService } from './providers/youtube/youtube-organic-health.service';
import {
  MEDIA_ASSET_METADATA_READER,
  MediaAssetController,
  MediaAssetDirectUploadService,
  MediaAssetUploadService,
  MediaAssetsModule,
} from '../../common/media-assets';
import { PermissionsModule } from '../permissions';
import { NotificationsModule } from '../notifications';
import { AgencyWorkspaceUserEntity } from '../agency/entities/agency-settings.entities';
import { SocialIntegrationsModule } from '../social-integrations/social-integrations.module';
import { SocialPlannerModule } from '../social-planner/social-planner.module';
import {
  MetaOrganicAnalyticsProvider,
  MetaOrganicAudienceService,
  MetaOrganicOnlineFollowersService,
  SOCIAL_ORGANIC_ANALYTICS_PROVIDERS,
  SocialOrganicAnalyticsProviderRegistry,
  MetaOrganicFacebookReelsService,
  MetaOrganicStoriesService,
  SocialOrganicFacebookReelWriterService,
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
  SocialOrganicFacebookReelEntity,
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
  SOCIAL_ORGANIC_HEALTH_PROVIDERS,
  SOCIAL_ORGANIC_OAUTH_PROVIDERS,
  SocialOrganicController,
  SocialOrganicConnectionService,
  SocialOrganicYoutubeService,
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
import { SocialPublicationCompanyProductParticipant } from './publication/social-publication-company-product.participant';
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
  LinkedInCallBudget,
  LinkedInOrganicApiClient,
  LinkedInOrganicOAuthProvider,
  LinkedInPublisherAdapter,
  LinkedInPublisherRegistration,
  TiktokApiClient,
  TiktokCreatorInfoService,
  TiktokOrganicOAuthProvider,
  TiktokPublisherAdapter,
  TiktokPublisherRegistration,
  TiktokBusinessApiClient,
  TiktokBusinessOAuthProvider,
  TiktokBusinessPublisherAdapter,
  TiktokBusinessPublisherRegistration,
  YoutubeApiClient,
  YoutubePublisherAdapter,
  YoutubePublisherRegistration,
  YoutubeUploadQuota,
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
import { SocialOrganicLeadgenRelay } from './webhooks/social-organic-leadgen.relay';
import { SocialOrganicLeadAdsService } from './lead-ads/social-organic-lead-ads.service';
import { SocialGoogleModule } from '../social-google/social-google.module';
import {
  createMetaOrganicOAuthProviders,
  createOrganicAnalyticsProviders,
  createOrganicHealthProviders,
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
        SocialOrganicFacebookReelEntity,
        SocialOrganicStoryEntity,
        SocialOrganicSyncRunEntity,
        SocialOrganicWebhookEventEntity,
        SocialOrganicInteractionEntity,
      ],
      'agency',
    ]);
    expect(
      Reflect.getMetadata(MODULE_METADATA.IMPORTS, SocialOrganicModule),
    ).toContain(CompanyProductsModule);
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
    // D-I1: `google_oauth` tokens come only from the Google module (one-way).
    expect(
      Reflect.getMetadata(MODULE_METADATA.IMPORTS, SocialOrganicModule),
    ).toContain(SocialGoogleModule);
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
      SocialPublicationCompanyProductParticipant,
      MetaOrganicGraphService,
      MetaOrganicAssetDiscoveryService,
      MetaOrganicOAuthProvider,
      MetaInstagramAssetDiscoveryService,
      MetaInstagramOAuthProvider,
      {
        provide: SOCIAL_ORGANIC_OAUTH_PROVIDERS,
        useFactory: createMetaOrganicOAuthProviders,
        inject: [
          MetaOrganicOAuthProvider,
          MetaInstagramOAuthProvider,
          TiktokOrganicOAuthProvider,
          LinkedInOrganicOAuthProvider,
          TiktokBusinessOAuthProvider,
        ],
      },
      SocialOrganicCredentialResolver,
      SocialOrganicOAuthProviderRegistry,
      SocialOrganicOAuthService,
      SocialOrganicConnectionService,
      SocialOrganicYoutubeService,
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
      YoutubeApiClient,
      YoutubeUploadQuota,
      YoutubePublisherAdapter,
      YoutubePublisherRegistration,
      TiktokApiClient,
      TiktokOrganicOAuthProvider,
      TiktokPublisherAdapter,
      TiktokPublisherRegistration,
      TiktokCreatorInfoService,
      TiktokBusinessApiClient,
      TiktokBusinessOAuthProvider,
      TiktokBusinessPublisherAdapter,
      TiktokBusinessPublisherRegistration,
      LinkedInCallBudget,
      LinkedInOrganicApiClient,
      LinkedInOrganicOAuthProvider,
      LinkedInPublisherAdapter,
      LinkedInPublisherRegistration,
      MetaOrganicHealthService,
      YoutubeOrganicHealthService,
      {
        provide: SOCIAL_ORGANIC_HEALTH_PROVIDERS,
        useFactory: createOrganicHealthProviders,
        inject: [MetaOrganicHealthService, YoutubeOrganicHealthService],
      },
      SocialOrganicHealthScheduler,
      MetaOrganicInsightsService,
      MetaOrganicAnalyticsProvider,
      {
        provide: SOCIAL_ORGANIC_ANALYTICS_PROVIDERS,
        useFactory: createOrganicAnalyticsProviders,
        inject: [
          MetaOrganicAnalyticsProvider,
          YoutubeOrganicAnalyticsProvider,
          TiktokOrganicAnalyticsProvider,
          LinkedInOrganicAnalyticsProvider,
        ],
      },
      YoutubeAnalyticsClient,
      YoutubeOrganicAnalyticsProvider,
      YoutubeDataRetentionService,
      YoutubeDataRetentionScheduler,
      TiktokOrganicAnalyticsProvider,
      LinkedInOrganicAnalyticsProvider,
      SocialOrganicAnalyticsProviderRegistry,
      SocialOrganicMetricsWriterService,
      SocialOrganicAudienceConfigService,
      MetaOrganicAudienceService,
      MetaOrganicPeriodReachService,
      SocialOrganicReachPeriodWriterService,
      SocialOrganicAudienceWriterService,
      SocialOrganicAudienceReadService,
      MetaOrganicOnlineFollowersService,
      SocialOrganicOnlineFollowersWriterService,
      MetaOrganicFacebookReelsService,
      MetaOrganicStoriesService,
      SocialOrganicFacebookReelWriterService,
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
      // ML1: the `leadgen` relay and the Lead Ads door Forms uses.
      SocialOrganicLeadgenRelay,
      SocialOrganicLeadAdsService,
      SettingsCryptoService,
      MediaPreparationService,
      MediaMetadataService,
      MediaAssetUploadService,
      MediaAssetDirectUploadService,
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
      SocialOrganicAudienceReadService,
      SocialOrganicActivityReadService,
      // CS5-B: the Creative Studio hands a selected version off to a
      // destination through the destination owner.
      DestinationCreativeService,
      // Re-exported so `SocialCreativeStudioModule`, which imports this
      // module, resolves the shared upload service and the metadata port
      // bound here. Without them the Creative Studio's providers cannot be
      // constructed.
      MediaAssetUploadService,
      MediaAssetDirectUploadService,
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
      // ML1: Forms registers its sink into the relay and reads leads through
      // the Lead Ads door; nothing here imports Forms.
      SocialOrganicLeadgenRelay,
      SocialOrganicLeadAdsService,
    ]);
  });
});
