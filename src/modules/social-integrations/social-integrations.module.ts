import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingsCryptoService } from '../../common/crypto/settings-crypto.service';
import { PermissionsModule } from '../permissions';
import { SocialAdCredentialResolver } from './credentials/social-ad-credential.resolver';
import {
  SocialAdAccountConnectionEntity,
  SocialAdDestinationObservationEntity,
  SocialAdEntity,
  SocialAdMetricDailyEntity,
  SocialAdSyncRunEntity,
} from './entities';
import { SocialPaidMediaIntelligenceAdapter } from './intelligence/social-paid-media-intelligence.adapter';
import { SocialInternalAccessService } from './internal/social-internal-access.service';
import { SocialAdBackfillPlannerService } from './services/social-ad-backfill-planner.service';
import { SocialAdBackfillResumeService } from './services/social-ad-backfill-resume.service';
import { MetaAdsEntityReaderService } from './services/meta-ads-entity-reader.service';
import { MetaAdsGraphService } from './services/meta-ads-graph.service';
import { MetaAdsInsightsReaderService } from './services/meta-ads-insights-reader.service';
import { MetaAdsOAuthService } from './services/meta-ads-oauth.service';
import { MetaAdsSystemUserService } from './services/meta-ads-system-user.service';
import { SocialAdConnectionService } from './services/social-ad-connection.service';
import { SocialAdDestinationBreakdownReadService } from './services/social-ad-destination-breakdown.read.service';
import { SocialAdHierarchyLookupReadService } from './services/social-ad-hierarchy-lookup.read.service';
import { SocialAdDestinationHistoryReadService } from './services/social-ad-destination-history.read.service';
import { SocialAdDestinationObserverService } from './services/social-ad-destination-observer.service';
import { SocialAdEntityWriterService } from './services/social-ad-entity-writer.service';
import { SocialAdHierarchySyncService } from './services/social-ad-hierarchy-sync.service';
import { SocialAdInsightsSyncService } from './services/social-ad-insights-sync.service';
import { SocialAdMetricsWriterService } from './services/social-ad-metrics-writer.service';
import { SocialAdRetentionConfigService } from './services/social-ad-retention-config.service';
import { SocialAdRetentionService } from './services/social-ad-retention.service';
import { SocialAdRetentionScheduler } from './services/social-ad-retention.scheduler';
import { SocialAdSyncConfigService } from './services/social-ad-sync-config.service';
import { SocialAdSyncRunService } from './services/social-ad-sync-run.service';
import { SocialAdSyncScheduler } from './services/social-ad-sync.scheduler';
import { SocialAdSyncWorker } from './services/social-ad-sync.worker';
import { SocialAnalyticsReadService } from './services/social-analytics-read.service';
import { SocialAnalyticsController } from './social-analytics.controller';
import { SocialIntegrationsController } from './social-integrations.controller';

/**
 * Ad account connections for Lyra Social.
 *
 * Imports `PermissionsModule` (guard, entitlement, managed context) and
 * nothing from Inbox. The only shared pieces are platform-level primitives —
 * `SettingsCryptoService` and the Meta app credentials — which belong to the
 * platform rather than to either product.
 */
@Module({
  imports: [
    PermissionsModule,
    // `SocialAdSyncRunEntity` joins now that it has an owner:
    // `SocialAdSyncRunService` is the only thing that reads or writes it, and
    // the worker reaches the table through that service rather than through a
    // repository of its own.
    TypeOrmModule.forFeature(
      [
        SocialAdAccountConnectionEntity,
        SocialAdDestinationObservationEntity,
        SocialAdEntity,
        SocialAdMetricDailyEntity,
        SocialAdSyncRunEntity,
      ],
      'agency',
    ),
  ],
  controllers: [SocialIntegrationsController, SocialAnalyticsController],
  providers: [
    MetaAdsGraphService,
    MetaAdsOAuthService,
    MetaAdsSystemUserService,
    SocialAdConnectionService,
    SocialAdCredentialResolver,
    SocialInternalAccessService,
    MetaAdsEntityReaderService,
    SocialAdDestinationObserverService,
    SocialAdDestinationHistoryReadService,
    SocialAdDestinationBreakdownReadService,
    SocialAdHierarchyLookupReadService,
    SocialAdEntityWriterService,
    SocialAdHierarchySyncService,
    MetaAdsInsightsReaderService,
    SocialAdMetricsWriterService,
    SocialAdInsightsSyncService,
    SocialAdSyncConfigService,
    SocialAdSyncRunService,
    SocialAdBackfillPlannerService,
    SocialAdBackfillResumeService,
    SocialAdSyncWorker,
    SocialAdSyncScheduler,
    // Housekeeping over the run log, on its own switch and its own daily
    // schedule. It shares no state with the sync services above and reaches no
    // credential — it deletes rows from one table by age.
    SocialAdRetentionConfigService,
    SocialAdRetentionService,
    SocialAdRetentionScheduler,
    // Reads the same tables the sync services write, and nothing else. It is
    // deliberately not given the credential resolver: the read path has no
    // token to use and must not fail when one expires.
    SocialAnalyticsReadService,
    // The shared-contract face of the read service. Built on it rather than
    // beside it: the four filters that make these numbers correct
    // (`entity_level`, `source`, `attribution_setting`, reach) have one
    // implementation, and a second one would drift silently.
    SocialPaidMediaIntelligenceAdapter,
    SettingsCryptoService,
  ],
  // The resolver is exported with no consumer yet on purpose: it is the
  // boundary the read model will import, and having it already be the module's
  // public way to reach a credential is what keeps the next module from
  // reaching for the connection repository instead.
  exports: [
    SocialAdConnectionService,
    SocialAdCredentialResolver,
    SocialPaidMediaIntelligenceAdapter,
    // Exported for the cross-domain cohort view, which needs the ad account's
    // timezone to cut both domains' days on the same boundary. It goes through
    // this service rather than the connection repository because this is where
    // "which connections may this scope see?" is decided — a second answer to
    // that question is how one client's account id becomes readable from
    // another's context.
    SocialAnalyticsReadService,
    // Exported for the same consumer, and kept a separate service rather than
    // folded into the one above: that service's every method is governed by
    // the four rules that make paid-media metrics correct, and destination
    // history obeys none of them — it is per ad set, has no attribution
    // setting, and is evidence about configuration rather than delivery.
    SocialAdDestinationHistoryReadService,
    SocialAdDestinationBreakdownReadService,
    SocialAdHierarchyLookupReadService,
  ],
})
export class SocialIntegrationsModule {}
