import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions';
import { SocialGoogleModule } from '../social-google';
import { Ga4AnalyticsController } from './ga4-analytics.controller';
import { Ga4AnalyticsReadService } from './ga4-analytics-read.service';
import { Ga4DataClient } from './ga4-data.client';
import { Ga4PropertyDirectoryService } from './ga4-property-directory.service';
import { Ga4SyncController } from './ga4-sync.controller';
import { Ga4SyncScheduler } from './ga4-sync.scheduler';
import { Ga4SyncService } from './ga4-sync.service';

/**
 * GA4 read model, sync and read endpoints (G3). Kept apart from
 * `social-google` so the OAuth foundation does not grow a data pipeline; the
 * token still comes only from `SocialGoogleAuthorizationService.getAccessToken`.
 * Uses the agency `DataSource` directly (raw, scope-bound SQL), so no
 * `forFeature`; the entities are registered in `agencyEntities`.
 */
@Module({
  imports: [PermissionsModule, SocialGoogleModule],
  controllers: [Ga4AnalyticsController, Ga4SyncController],
  providers: [
    Ga4DataClient,
    Ga4PropertyDirectoryService,
    Ga4SyncService,
    Ga4SyncScheduler,
    Ga4AnalyticsReadService,
  ],
})
export class SocialGa4Module {}
