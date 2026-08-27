import { randomUUID } from 'node:crypto';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import { LeadFlowClientSettingsEntity } from '../../leadflow-settings/entities';
import { LeadFlowBusinessMode } from '../../leadflow-settings/enums/leadflow-business-mode.enum';
import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import { CompanyContextService } from '../../leadflow-settings/services/company-context.service';
import {
  LeadFlowBriefingExtractionJobEntity,
  LeadFlowBriefingSourceEntity,
  LeadFlowBriefingSourceVersionEntity,
  LeadFlowBriefingSuggestionEntity,
} from '../entities';
import { LeadFlowBriefingSourceKind } from '../enums/leadflow-briefing-source-kind.enum';
import { LeadFlowBriefingSuggestionStatus } from '../enums/leadflow-briefing-suggestion-status.enum';
import { LeadFlowBriefingExtractionJobService } from './leadflow-briefing-extraction-job.service';
import { LeadFlowBriefingJobStateMachine } from './leadflow-briefing-job-state-machine';
import { LeadFlowBriefingSourceService } from './leadflow-briefing-source.service';
import { LeadFlowBriefingSuggestionService } from './leadflow-briefing-suggestion.service';
import { describePostgresIntegration } from '../../../testing/postgres-integration';

const run = describePostgresIntegration();

run('LeadFlow Briefing suggestions PostgreSQL', () => {
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  let sourceService: LeadFlowBriefingSourceService;
  let jobService: LeadFlowBriefingExtractionJobService;
  let suggestionService: LeadFlowBriefingSuggestionService;
  let settingsId: string;

  const ctx = () => ({ tenantId, workspaceId, userId: randomUUID() });

  async function makeJob() {
    const source = await sourceService.createSource(ctx(), {
      settingsId,
      contextType: LeadFlowSettingsContextType.Agency,
      agencyClientId: null,
      kind: LeadFlowBriefingSourceKind.Upload,
      label: 'Suggestion tests source',
      createdById: null,
    });
    const version = await sourceService.createSourceVersion(ctx(), {
      sourceId: source.id,
      kind: LeadFlowBriefingSourceKind.Upload,
      checksum: randomUUID(),
      createdById: null,
    });
    const job = await jobService.enqueueJob(ctx(), {
      settingsId,
      sourceId: source.id,
      sourceVersionId: version.id,
      jobKind: `suggestions-${randomUUID()}`,
      createdById: null,
    });
    return { source, version, job };
  }

  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
    sourceService = new LeadFlowBriefingSourceService(AgencyDataSource);
    jobService = new LeadFlowBriefingExtractionJobService(
      AgencyDataSource,
      new LeadFlowBriefingJobStateMachine(),
    );
    suggestionService = new LeadFlowBriefingSuggestionService(
      AgencyDataSource,
      new CompanyContextService(),
    );

    const settings = await AgencyDataSource.getRepository(LeadFlowClientSettingsEntity).save({
      tenantId,
      workspaceId,
      contextType: LeadFlowSettingsContextType.Agency,
      businessModeKey: LeadFlowBusinessMode.AgencyServices,
    });
    settingsId = settings.id;
  });

  afterAll(async () => {
    await AgencyDataSource.getRepository(LeadFlowBriefingSuggestionEntity).delete({ tenantId });
    await AgencyDataSource.getRepository(LeadFlowBriefingExtractionJobEntity).delete({
      tenantId,
    });
    await AgencyDataSource.getRepository(LeadFlowBriefingSourceVersionEntity).delete({
      tenantId,
    });
    await AgencyDataSource.getRepository(LeadFlowBriefingSourceEntity).delete({ tenantId });
    await AgencyDataSource.getRepository(LeadFlowClientSettingsEntity).delete({ tenantId });
  });

  it('rejects a field path outside the canonical root schema', async () => {
    const { job, version } = await makeJob();
    await expect(
      suggestionService.recordSuggestions(ctx(), {
        extractionJobId: job.id,
        settingsId,
        sourceVersionId: version.id,
        suggestions: [{ fieldPath: 'unknownSection.field', suggestedValue: 'x' }],
      }),
    ).rejects.toThrow();
  });

  it('rejects a forbidden/secret-like field path', async () => {
    const { job, version } = await makeJob();
    await expect(
      suggestionService.recordSuggestions(ctx(), {
        extractionJobId: job.id,
        settingsId,
        sourceVersionId: version.id,
        suggestions: [{ fieldPath: 'identity.apiKey', suggestedValue: 'x' }],
      }),
    ).rejects.toThrow();
  });

  it('rejects two suggestions for the same field from the same job', async () => {
    const { job, version } = await makeJob();
    const fieldPath = `identity.publicName`;
    await expect(
      suggestionService.recordSuggestions(ctx(), {
        extractionJobId: job.id,
        settingsId,
        sourceVersionId: version.id,
        suggestions: [
          { fieldPath, suggestedValue: 'A' },
          { fieldPath, suggestedValue: 'B' },
        ],
      }),
    ).rejects.toThrow();
  });

  it('auto-supersedes a still-pending sibling suggestion for the same field', async () => {
    const fieldPath = 'identity.summary';
    const first = await makeJob();
    const [firstSuggestion] = await suggestionService.recordSuggestions(ctx(), {
      extractionJobId: first.job.id,
      settingsId,
      sourceVersionId: first.version.id,
      suggestions: [{ fieldPath, suggestedValue: 'Resumo v1' }],
    });

    const second = await makeJob();
    const [secondSuggestion] = await suggestionService.recordSuggestions(ctx(), {
      extractionJobId: second.job.id,
      settingsId,
      sourceVersionId: second.version.id,
      suggestions: [{ fieldPath, suggestedValue: 'Resumo v2' }],
    });

    const reloadedFirst = await AgencyDataSource.getRepository(
      LeadFlowBriefingSuggestionEntity,
    ).findOne({ where: { id: firstSuggestion.id } });

    expect(reloadedFirst?.status).toBe(LeadFlowBriefingSuggestionStatus.Superseded);
    expect(reloadedFirst?.supersededBySuggestionId).toBe(secondSuggestion.id);
  });

  it('does not auto-supersede an already-applied sibling — marks a conflict instead', async () => {
    const fieldPath = 'identity.valueProposition';
    const first = await makeJob();
    const [firstSuggestion] = await suggestionService.recordSuggestions(ctx(), {
      extractionJobId: first.job.id,
      settingsId,
      sourceVersionId: first.version.id,
      suggestions: [{ fieldPath, suggestedValue: 'Proposta v1' }],
    });
    await suggestionService.applySuggestion(ctx(), {
      suggestionId: firstSuggestion.id,
      appliedById: randomUUID(),
    });

    const second = await makeJob();
    const [secondSuggestion] = await suggestionService.recordSuggestions(ctx(), {
      extractionJobId: second.job.id,
      settingsId,
      sourceVersionId: second.version.id,
      suggestions: [{ fieldPath, suggestedValue: 'Proposta v2' }],
    });

    const reloadedFirst = await AgencyDataSource.getRepository(
      LeadFlowBriefingSuggestionEntity,
    ).findOne({ where: { id: firstSuggestion.id } });
    expect(reloadedFirst?.status).toBe(LeadFlowBriefingSuggestionStatus.Applied);
    expect(reloadedFirst?.supersededBySuggestionId).toBeNull();
    expect(secondSuggestion.status).toBe(LeadFlowBriefingSuggestionStatus.Pending);
    expect(secondSuggestion.conflictsWithSuggestionId).toBe(firstSuggestion.id);
  });

  it('listForReview: conflito, lacuna, aplicação parcial e refresh — round trip completo', async () => {
    const contradictoryField = 'identity.differentiators';
    const untouchedField = 'identity.timezone';
    const gapField = 'qualification.conversionGoal';

    const first = await makeJob();
    const [firstSuggestion] = await suggestionService.recordSuggestions(ctx(), {
      extractionJobId: first.job.id,
      settingsId,
      sourceVersionId: first.version.id,
      suggestions: [
        { fieldPath: contradictoryField, suggestedValue: 'Atendimento 24h' },
        { fieldPath: untouchedField, suggestedValue: 'America/Sao_Paulo' },
      ],
    });

    // gap: before any suggestion targets it, a truly-empty scalar field shows up.
    const beforeSecondJob = await suggestionService.listForReview(ctx(), settingsId);
    expect(beforeSecondJob.gaps).toContain(gapField);

    // aplicação parcial: apply one of two pending suggestions from the same job.
    await suggestionService.applySuggestion(ctx(), {
      suggestionId: firstSuggestion.id,
      appliedById: randomUUID(),
    });

    const afterPartialApply = await suggestionService.listForReview(ctx(), settingsId);
    const untouchedRow = afterPartialApply.suggestions.find(
      (row) => row.fieldPath === untouchedField,
    );
    expect(untouchedRow?.status).toBe(LeadFlowBriefingSuggestionStatus.Pending);

    // refresh: the just-applied suggestion is immediately visible as Applied, no caching.
    const appliedRow = afterPartialApply.suggestions.find(
      (row) => row.fieldPath === contradictoryField,
    );
    expect(appliedRow?.status).toBe(LeadFlowBriefingSuggestionStatus.Applied);
    expect(appliedRow?.decidedById).toBeTruthy();
    expect(appliedRow?.decidedAt).toBeTruthy();

    // conflito: a second job proposes a contradictory value for the already-applied field.
    const second = await makeJob();
    const [conflictingSuggestion] = await suggestionService.recordSuggestions(ctx(), {
      extractionJobId: second.job.id,
      settingsId,
      sourceVersionId: second.version.id,
      suggestions: [{ fieldPath: contradictoryField, suggestedValue: 'Atendimento em horário comercial' }],
    });

    const afterConflict = await suggestionService.listForReview(ctx(), settingsId);
    const conflictRow = afterConflict.suggestions.find((row) => row.id === conflictingSuggestion.id);
    expect(conflictRow?.status).toBe(LeadFlowBriefingSuggestionStatus.Pending);
    expect(conflictRow?.conflictsWithSuggestionId).toBe(firstSuggestion.id);
    expect(conflictRow?.currentValue).toBe('Atendimento 24h');
    expect(conflictRow?.suggestedValue).toBe('Atendimento em horário comercial');

    // lacuna: a field with a pending suggestion is never double-counted as a gap.
    expect(afterConflict.gaps).not.toContain(untouchedField);
    expect(afterConflict.gaps).not.toContain(contradictoryField);
  });
});
