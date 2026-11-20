import { CompanyProductsModule } from '../../common/company-products/company-products.module';
import { SocialPublicationCompanyProductParticipant } from './publication/social-publication-company-product.participant';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingsCryptoService } from '../../common/crypto/settings-crypto.service';
import { FilesModule } from '../../common/files/files.module';
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
import { LinkedInOrganicAnalyticsProvider } from './analytics/linkedin/linkedin-organic-analytics.provider';
import { TiktokOrganicAnalyticsProvider } from './analytics/tiktok/tiktok-organic-analytics.provider';
import { YoutubeAnalyticsClient } from './analytics/youtube/youtube-analytics.client';
import { YoutubeOrganicAnalyticsProvider } from './analytics/youtube/youtube-organic-analytics.provider';
import { SocialOrganicYoutubeService } from './connections/social-organic-youtube.service';
import { SocialGoogleModule } from '../social-google/social-google.module';
import {
  MetaOrganicAnalyticsProvider,
  MetaOrganicAudienceService,
  MetaOrganicOnlineFollowersService,
  MetaOrganicPeriodReachService,
  MetaOrganicFacebookReelsService,
  MetaOrganicStoriesService,
  MetaOrganicInsightsService,
  SocialConsolidatedAnalyticsService,
  SOCIAL_ORGANIC_ANALYTICS_PROVIDERS,
  SocialOrganicAnalyticsProviderRegistry,
  SocialOrganicAccountMetricDailyEntity,
  SocialOrganicReachPeriodEntity,
  SocialOrganicReachPeriodWriterService,
  SocialOrganicAnalyticsController,
  SocialOrganicAnalyticsReadService,
  SocialOrganicAudienceConfigService,
  SocialOrganicAudienceDailyEntity,
  SocialOrganicActivityReadService,
  SocialOrganicAudienceReadService,
  SocialOrganicAudienceWriterService,
  SocialOrganicOnlineFollowersEntity,
  SocialOrganicOnlineFollowersWriterService,
  SocialOrganicFacebookReelEntity,
  SocialOrganicFacebookReelWriterService,
  SocialOrganicStoryEntity,
  SocialOrganicStoryWriterService,
  SocialOrganicStoriesScheduler,
  SocialOrganicThumbnailService,
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
  SOCIAL_ORGANIC_HEALTH_PROVIDERS,
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
  SocialPublicationMediaEntity,
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
  DirectInstagramPublisherAdapter,
  MetaInstagramAssetDiscoveryService,
  MetaInstagramOAuthProvider,
  InstagramPublisherAdapter,
  MetaOrganicAssetDiscoveryService,
  MetaOrganicGraphService,
  MetaOrganicHealthService,
  MetaOrganicOAuthProvider,
  MetaPublisherRegistration,
  SocialPublisherRegistry,
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

export function createMetaOrganicOAuthProviders(
  meta: MetaOrganicOAuthProvider,
  instagram: MetaInstagramOAuthProvider,
  tiktok: TiktokOrganicOAuthProvider,
  linkedin: LinkedInOrganicOAuthProvider,
  tiktokBusiness: TiktokBusinessOAuthProvider,
) {
  return [meta, instagram, tiktok, linkedin, tiktokBusiness];
}

/** D-I4 (b): one analytics implementation per provider; YT/TT/LI plug here. */
export function createOrganicAnalyticsProviders(
  meta: MetaOrganicAnalyticsProvider,
  youtube: YoutubeOrganicAnalyticsProvider,
  tiktok: TiktokOrganicAnalyticsProvider,
  linkedin: LinkedInOrganicAnalyticsProvider,
) {
  return [meta, youtube, tiktok, linkedin];
}

/** D-I4 (c): one health implementation per provider; YT/TT/LI plug here. */
export function createOrganicHealthProviders(meta: MetaOrganicHealthService) {
  return [meta];
}

@Module({
  imports: [
    CompanyProductsModule,
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
    /**
     * D-I1: a `google_oauth` organic connection (YouTube) takes its token only
     * through `SocialGoogleAuthorizationService.getAccessToken`. One-way:
     * `SocialGoogleModule` imports only `PermissionsModule`, so no cycle.
     */
    SocialGoogleModule,
    TypeOrmModule.forFeature(
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
    /**
     * Registers itself into the Planner's guard on init, so deleting content
     * can be refused when a live publication would be stranded (E6).
     */
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
    // D-I9/D-I10: TikTok OAuth (`oauth_user` + refresh), Direct Post adapter and
    // the live `creator_info` read. Publishing stays behind
    // `SOCIAL_PUBLICATION_TIKTOK_ENABLED`.
    TiktokApiClient,
    TiktokOrganicOAuthProvider,
    TiktokPublisherAdapter,
    TiktokPublisherRegistration,
    TiktokCreatorInfoService,
    // TikTok accounts through the TikTok for Business app ("TikTok Accounts"):
    // account holder OAuth and `/business/video/publish/`. Publishing stays
    // behind `SOCIAL_PUBLICATION_TIKTOK_BUSINESS_ENABLED`.
    TiktokBusinessApiClient,
    TiktokBusinessOAuthProvider,
    TiktokBusinessPublisherAdapter,
    TiktokBusinessPublisherRegistration,
    // LI-ORG-BE: LinkedIn Pages (`oauth_user`, 500 calls/day while Development).
    LinkedInCallBudget,
    LinkedInOrganicApiClient,
    LinkedInOrganicOAuthProvider,
    LinkedInPublisherAdapter,
    LinkedInPublisherRegistration,
    MetaOrganicHealthService,
    {
      provide: SOCIAL_ORGANIC_HEALTH_PROVIDERS,
      useFactory: createOrganicHealthProviders,
      inject: [MetaOrganicHealthService],
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
    TiktokOrganicAnalyticsProvider,
    LinkedInOrganicAnalyticsProvider,
    SocialOrganicAnalyticsProviderRegistry,
    SocialOrganicMetricsWriterService,
    // Audience snapshots: a gate that is off by default, a reader that measures
    // a stock once rather than iterating days, a writer that owns one table, and
    // the read that takes the newest snapshot and never a range.
    SocialOrganicAudienceConfigService,
    MetaOrganicAudienceService,
    MetaOrganicPeriodReachService,
    SocialOrganicReachPeriodWriterService,
    SocialOrganicAudienceWriterService,
    SocialOrganicAudienceReadService,
    // The hourly grid behind "melhor dia" and "melhor horário": one collection
    // read two ways, on its own 30-day retention clock.
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
    // ML1: `page:leadgen` is relayed to the sink Forms registers on init, and
    // the Lead Ads door (Pages, Page token, Graph) is exported for it.
    SocialOrganicLeadgenRelay,
    SocialOrganicLeadAdsService,
    SettingsCryptoService,
    MediaPreparationService,
    MediaMetadataService,
    MediaAssetUploadService,
    MediaAssetDirectUploadService,
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
    SocialOrganicAudienceReadService,
    SocialOrganicActivityReadService,
    // CS5-B: Creative Studio production hands a selected version off through it.
    DestinationCreativeService,
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
    SocialOrganicLeadgenRelay,
    SocialOrganicLeadAdsService,
  ],
})
export class SocialOrganicModule {}
