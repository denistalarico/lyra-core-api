import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
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
import { LeadFlowBriefingExtractionJobService } from './services/leadflow-briefing-extraction-job.service';
import { LeadFlowBriefingJobStateMachine } from './services/leadflow-briefing-job-state-machine';
import { LeadFlowBriefingSourceService } from './services/leadflow-briefing-source.service';
import { LeadFlowBriefingSuggestionService } from './services/leadflow-briefing-suggestion.service';

/**
 * RFC/entities/migration/contracts only (LF-RF-F4-001) — no controller, no
 * ingestion, no extraction worker. Depends on LeadFlowSettingsModule for
 * CompanyContextService and the shared LeadFlowClientSettingsEntity rather
 * than redeclaring either.
 */
@Module({
  imports: [
    LeadFlowSettingsModule,
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
  providers: [
    LeadFlowBriefingJobStateMachine,
    LeadFlowBriefingSourceService,
    LeadFlowBriefingExtractionJobService,
    LeadFlowBriefingSuggestionService,
  ],
  exports: [
    LeadFlowBriefingJobStateMachine,
    LeadFlowBriefingSourceService,
    LeadFlowBriefingExtractionJobService,
    LeadFlowBriefingSuggestionService,
  ],
})
export class LeadFlowBriefingModule {}
