import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingsCryptoService } from '../../common/crypto/settings-crypto.service';
import { PermissionsModule } from '../permissions';
import { SocialAdCredentialResolver } from './credentials/social-ad-credential.resolver';
import {
  SocialAdAccountConnectionEntity,
  SocialAdEntity,
  SocialAdMetricDailyEntity,
  SocialAdSyncRunEntity,
} from './entities';
import { SocialInternalAccessService } from './internal/social-internal-access.service';
import { SocialAdBackfillPlannerService } from './services/social-ad-backfill-planner.service';
import { SocialAdBackfillResumeService } from './services/social-ad-backfill-resume.service';
import { MetaAdsEntityReaderService } from './services/meta-ads-entity-reader.service';
import { MetaAdsGraphService } from './services/meta-ads-graph.service';
import { MetaAdsInsightsReaderService } from './services/meta-ads-insights-reader.service';
import { MetaAdsOAuthService } from './services/meta-ads-oauth.service';
import { MetaAdsSystemUserService } from './services/meta-ads-system-user.service';
import { SocialAdConnectionService } from './services/social-ad-connection.service';
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
    SettingsCryptoService,
  ],
  // The resolver is exported with no consumer yet on purpose: it is the
  // boundary the read model will import, and having it already be the module's
  // public way to reach a credential is what keeps the next module from
  // reaching for the connection repository instead.
  exports: [SocialAdConnectionService, SocialAdCredentialResolver],
})
export class SocialIntegrationsModule {}
