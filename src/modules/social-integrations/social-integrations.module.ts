import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingsCryptoService } from '../../common/crypto/settings-crypto.service';
import { PermissionsModule } from '../permissions';
import { SocialAdCredentialResolver } from './credentials/social-ad-credential.resolver';
import {
  SocialAdAccountConnectionEntity,
  SocialAdEntity,
  SocialAdMetricDailyEntity,
} from './entities';
import { SocialInternalAccessService } from './internal/social-internal-access.service';
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
    // `SocialAdMetricDailyEntity` joins now that the metrics writer consumes
    // it. `SocialAdSyncRunEntity` stays out until something reads or writes it
    // — a repository registered ahead of its consumer is an invitation to reach
    // for it from outside the pipeline that owns it, and the run table's owner
    // is the worker that does not exist yet.
    TypeOrmModule.forFeature(
      [
        SocialAdAccountConnectionEntity,
        SocialAdEntity,
        SocialAdMetricDailyEntity,
      ],
      'agency',
    ),
  ],
  controllers: [SocialIntegrationsController],
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
    SettingsCryptoService,
  ],
  // The resolver is exported with no consumer yet on purpose: it is the
  // boundary the read model will import, and having it already be the module's
  // public way to reach a credential is what keeps the next module from
  // reaching for the connection repository instead.
  exports: [SocialAdConnectionService, SocialAdCredentialResolver],
})
export class SocialIntegrationsModule {}
