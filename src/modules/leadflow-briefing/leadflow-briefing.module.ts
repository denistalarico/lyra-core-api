import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FilesModule } from '../../common/files/files.module';
import { PermissionsModule } from '../permissions';
import { LeadFlowClientSettingsEntity } from '../leadflow-settings/entities';
import { LeadFlowSettingsModule } from '../leadflow-settings/leadflow-settings.module';
import {
  LeadFlowBriefingContextSnapshotEntity,
  LeadFlowBriefingExtractionJobEntity,
  LeadFlowBriefingSourceEntity,
  LeadFlowBriefingSourceVersionEntity,
  LeadFlowBriefingSuggestionApplicationEntity,
  LeadFlowBriefingSuggestionEntity,
} from './entities';
import { LeadFlowBriefingController } from './leadflow-briefing.controller';
import { ClamAvScannerAdapter } from './services/clamav-scanner.adapter';
import { LeadFlowBriefingContentService } from './services/leadflow-briefing-content.service';
import { LeadFlowBriefingExtractionConfigService } from './services/leadflow-briefing-extraction-config.service';
import { LeadFlowBriefingExtractionJobService } from './services/leadflow-briefing-extraction-job.service';
import { LeadFlowBriefingExtractionProvider } from './services/leadflow-briefing-extraction-provider';
import { LeadFlowBriefingExtractionWorker } from './services/leadflow-briefing-extraction.worker';
import { LeadFlowBriefingIngestionService } from './services/leadflow-briefing-ingestion.service';
import { LeadFlowBriefingJobStateMachine } from './services/leadflow-briefing-job-state-machine';
import { LeadFlowBriefingQuotaService } from './services/leadflow-briefing-quota.service';
import { LeadFlowBriefingSourceService } from './services/leadflow-briefing-source.service';
import { LeadFlowBriefingSuggestionService } from './services/leadflow-briefing-suggestion.service';
import { MALWARE_SCANNER_ADAPTER } from './services/malware-scanner.adapter';
import { SsrfSafeUrlFetcherService } from './services/ssrf-safe-url-fetcher.service';

/**
 * F4-001 laid the RFC/entities/migration/contracts. F4-002 added the
 * ingestion surface (upload/URL/paste, SSRF guard, ClamAV scan, quota).
 * F4-003 adds the worker that claims queued extraction jobs and turns
 * already-safe source-version content into suggestion rows. Still no
 * review/apply endpoints — that's F4-004.
 */
@Module({
  imports: [
    LeadFlowSettingsModule,
    FilesModule,
    PermissionsModule,
    TypeOrmModule.forFeature(
      [
        LeadFlowClientSettingsEntity,
        LeadFlowBriefingSourceEntity,
        LeadFlowBriefingSourceVersionEntity,
        LeadFlowBriefingExtractionJobEntity,
        LeadFlowBriefingSuggestionEntity,
        LeadFlowBriefingContextSnapshotEntity,
        LeadFlowBriefingSuggestionApplicationEntity,
      ],
      'agency',
    ),
  ],
  controllers: [LeadFlowBriefingController],
  providers: [
    LeadFlowBriefingJobStateMachine,
    LeadFlowBriefingSourceService,
    LeadFlowBriefingExtractionJobService,
    LeadFlowBriefingSuggestionService,
    LeadFlowBriefingQuotaService,
    LeadFlowBriefingIngestionService,
    LeadFlowBriefingContentService,
    SsrfSafeUrlFetcherService,
    { provide: MALWARE_SCANNER_ADAPTER, useClass: ClamAvScannerAdapter },
    LeadFlowBriefingExtractionConfigService,
    LeadFlowBriefingExtractionProvider,
    LeadFlowBriefingExtractionWorker,
  ],
  exports: [
    LeadFlowBriefingJobStateMachine,
    LeadFlowBriefingSourceService,
    LeadFlowBriefingExtractionJobService,
    LeadFlowBriefingSuggestionService,
    LeadFlowBriefingQuotaService,
    LeadFlowBriefingIngestionService,
    LeadFlowBriefingContentService,
  ],
})
export class LeadFlowBriefingModule {}
