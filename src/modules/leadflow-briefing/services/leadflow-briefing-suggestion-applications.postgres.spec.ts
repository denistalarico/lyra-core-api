import { randomUUID } from 'node:crypto';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import { LeadFlowClientSettingsEntity } from '../../leadflow-settings/entities';
import { LeadFlowBusinessMode } from '../../leadflow-settings/enums/leadflow-business-mode.enum';
import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import { CompanyContextService } from '../../leadflow-settings/services/company-context.service';
import {
  LeadFlowBriefingContextSnapshotEntity,
  LeadFlowBriefingExtractionJobEntity,
  LeadFlowBriefingSourceEntity,
  LeadFlowBriefingSourceVersionEntity,
  LeadFlowBriefingSuggestionApplicationEntity,
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

run('LeadFlow Briefing suggestion applications PostgreSQL', () => {
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  let sourceService: LeadFlowBriefingSourceService;
  let jobService: LeadFlowBriefingExtractionJobService;
  let suggestionService: LeadFlowBriefingSuggestionService;
  let settingsId: string;

  const ctx = () => ({ tenantId, workspaceId, userId: randomUUID() });

  async function makeJob(sourceId?: string) {
    const source = sourceId
      ? { id: sourceId }
      : await sourceService.createSource(ctx(), {
          settingsId,
          contextType: LeadFlowSettingsContextType.Agency,
          agencyClientId: null,
          kind: LeadFlowBriefingSourceKind.Upload,
          label: 'Application tests source',
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
      jobKind: `apply-${randomUUID()}`,
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
    await AgencyDataSource.getRepository(LeadFlowBriefingSuggestionApplicationEntity).delete({
      tenantId,
    });
    await AgencyDataSource.getRepository(LeadFlowBriefingContextSnapshotEntity).delete({
      tenantId,
    });
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

  it('applies a pending suggestion, writing only the targeted field', async () => {
    const { job, version } = await makeJob();
    const [suggestion] = await suggestionService.recordSuggestions(ctx(), {
      extractionJobId: job.id,
      settingsId,
      sourceVersionId: version.id,
      suggestions: [{ fieldPath: 'identity.publicName', suggestedValue: 'Loja Demo' }],
    });

    const application = await suggestionService.applySuggestion(ctx(), {
      suggestionId: suggestion.id,
      appliedById: randomUUID(),
    });

    expect(application.fieldPath).toBe('identity.publicName');
    const settings = await AgencyDataSource.getRepository(LeadFlowClientSettingsEntity).findOne({
      where: { id: settingsId },
    });
    expect((settings?.companyContextDraft as { identity: { publicName: string } }).identity.publicName).toBe(
      'Loja Demo',
    );

    const snapshot = await AgencyDataSource.getRepository(
      LeadFlowBriefingContextSnapshotEntity,
    ).findOne({ where: { id: application.resultingSnapshotId } });
    expect(snapshot).not.toBeNull();
  });

  it('rejects applying the same suggestion twice', async () => {
    const { job, version } = await makeJob();
    const [suggestion] = await suggestionService.recordSuggestions(ctx(), {
      extractionJobId: job.id,
      settingsId,
      sourceVersionId: version.id,
      suggestions: [{ fieldPath: 'identity.legalName', suggestedValue: 'Loja Demo LTDA' }],
    });

    await suggestionService.applySuggestion(ctx(), {
      suggestionId: suggestion.id,
      appliedById: randomUUID(),
    });

    await expect(
      suggestionService.applySuggestion(ctx(), {
        suggestionId: suggestion.id,
        appliedById: randomUUID(),
      }),
    ).rejects.toThrow();
  });

  it('rejects applying a rejected suggestion', async () => {
    const { job, version } = await makeJob();
    const [suggestion] = await suggestionService.recordSuggestions(ctx(), {
      extractionJobId: job.id,
      settingsId,
      sourceVersionId: version.id,
      suggestions: [{ fieldPath: 'service.businessHours', suggestedValue: '9-18' }],
    });

    await suggestionService.rejectSuggestion(ctx(), {
      suggestionId: suggestion.id,
      decidedById: randomUUID(),
    });

    await expect(
      suggestionService.applySuggestion(ctx(), {
        suggestionId: suggestion.id,
        appliedById: randomUUID(),
      }),
    ).rejects.toThrow();
  });

  it('rejecting a suggestion never touches the draft', async () => {
    const { job, version } = await makeJob();
    const [suggestion] = await suggestionService.recordSuggestions(ctx(), {
      extractionJobId: job.id,
      settingsId,
      sourceVersionId: version.id,
      suggestions: [{ fieldPath: 'service.serviceLevel', suggestedValue: 'premium' }],
    });

    const before = await AgencyDataSource.getRepository(LeadFlowClientSettingsEntity).findOne({
      where: { id: settingsId },
    });
    await suggestionService.rejectSuggestion(ctx(), {
      suggestionId: suggestion.id,
      decidedById: randomUUID(),
    });
    const after = await AgencyDataSource.getRepository(LeadFlowClientSettingsEntity).findOne({
      where: { id: settingsId },
    });

    expect(after?.companyContextDraft).toEqual(before?.companyContextDraft);
  });

  it('field provenance is "manual" when there is no application row', async () => {
    const provenance = await suggestionService.getFieldProvenance(
      ctx(),
      settingsId,
      'qualification.conversionGoal',
    );
    expect(provenance.origin).toBe('manual');
  });

  it('field provenance resolves the full chain back to the source for an applied field', async () => {
    const { job, version, source } = await makeJob();
    const [suggestion] = await suggestionService.recordSuggestions(ctx(), {
      extractionJobId: job.id,
      settingsId,
      sourceVersionId: version.id,
      suggestions: [{ fieldPath: 'identity.timezone', suggestedValue: 'America/Sao_Paulo' }],
    });
    await suggestionService.applySuggestion(ctx(), {
      suggestionId: suggestion.id,
      appliedById: randomUUID(),
    });

    const provenance = await suggestionService.getFieldProvenance(
      ctx(),
      settingsId,
      'identity.timezone',
    );
    expect(provenance.origin).toBe('suggestion');
    expect(provenance.suggestionId).toBe(suggestion.id);
    expect(provenance.sourceVersionId).toBe(version.id);
    expect(provenance.sourceId).toBe(source.id);
  });

  it('the previous draft snapshot remains queryable after a later apply (draft-recovery guarantee)', async () => {
    const { job, version } = await makeJob();
    const [suggestion] = await suggestionService.recordSuggestions(ctx(), {
      extractionJobId: job.id,
      settingsId,
      sourceVersionId: version.id,
      suggestions: [{ fieldPath: 'identity.differentiators', suggestedValue: 'Atendimento 24h' }],
    });
    const firstApplication = await suggestionService.applySuggestion(ctx(), {
      suggestionId: suggestion.id,
      appliedById: randomUUID(),
    });

    const { job: job2, version: version2 } = await makeJob(version.sourceId);
    const [suggestion2] = await suggestionService.recordSuggestions(ctx(), {
      extractionJobId: job2.id,
      settingsId,
      sourceVersionId: version2.id,
      suggestions: [{ fieldPath: 'identity.targetAudience', suggestedValue: 'PMEs' }],
    });
    await suggestionService.applySuggestion(ctx(), {
      suggestionId: suggestion2.id,
      appliedById: randomUUID(),
    });

    const firstSnapshotStillThere = await AgencyDataSource.getRepository(
      LeadFlowBriefingContextSnapshotEntity,
    ).findOne({ where: { id: firstApplication.resultingSnapshotId } });
    expect(firstSnapshotStillThere).not.toBeNull();
    expect(
      (firstSnapshotStillThere?.draftValue as { identity: { differentiators: string } }).identity
        .differentiators,
    ).toBe('Atendimento 24h');
  });

  it('end-to-end: two source versions, partial application, conflict on an applied field, supersede on a pending field', async () => {
    const source = await sourceService.createSource(ctx(), {
      settingsId,
      contextType: LeadFlowSettingsContextType.Agency,
      agencyClientId: null,
      kind: LeadFlowBriefingSourceKind.Upload,
      label: 'End-to-end scenario source',
      createdById: null,
    });
    const v1 = await sourceService.createSourceVersion(ctx(), {
      sourceId: source.id,
      kind: LeadFlowBriefingSourceKind.Upload,
      checksum: randomUUID(),
      createdById: null,
    });
    const jobV1 = await jobService.enqueueJob(ctx(), {
      settingsId,
      sourceId: source.id,
      sourceVersionId: v1.id,
      jobKind: `e2e-v1-${randomUUID()}`,
      createdById: null,
    });

    const fieldA = 'links'; // applied, then conflicted by v2
    const fieldB = 'policies'; // applied, untouched by v2
    const fieldC = 'legacyTone'; // stays pending, then superseded by v2

    const [suggA1, suggB1, suggC1] = await suggestionService.recordSuggestions(ctx(), {
      extractionJobId: jobV1.id,
      settingsId,
      sourceVersionId: v1.id,
      suggestions: [
        { fieldPath: fieldA, suggestedValue: ['https://example.com'] },
        { fieldPath: fieldB, suggestedValue: 'Sem reembolso após 7 dias' },
        { fieldPath: fieldC, suggestedValue: 'consultivo' },
      ],
    });

    // Partial application: apply A and B, leave C pending.
    await suggestionService.applySuggestion(ctx(), {
      suggestionId: suggA1.id,
      appliedById: randomUUID(),
    });
    await suggestionService.applySuggestion(ctx(), {
      suggestionId: suggB1.id,
      appliedById: randomUUID(),
    });

    const v2 = await sourceService.createSourceVersion(ctx(), {
      sourceId: source.id,
      kind: LeadFlowBriefingSourceKind.Upload,
      checksum: randomUUID(),
      createdById: null,
    });
    const jobV2 = await jobService.enqueueJob(ctx(), {
      settingsId,
      sourceId: source.id,
      sourceVersionId: v2.id,
      jobKind: `e2e-v2-${randomUUID()}`,
      createdById: null,
    });

    const [suggA2, suggC2] = await suggestionService.recordSuggestions(ctx(), {
      extractionJobId: jobV2.id,
      settingsId,
      sourceVersionId: v2.id,
      suggestions: [
        { fieldPath: fieldA, suggestedValue: ['https://example.com/v2'] },
        { fieldPath: fieldC, suggestedValue: 'direto' },
      ],
    });

    const reloadedA1 = await AgencyDataSource.getRepository(
      LeadFlowBriefingSuggestionEntity,
    ).findOne({ where: { id: suggA1.id } });
    const reloadedB1 = await AgencyDataSource.getRepository(
      LeadFlowBriefingSuggestionEntity,
    ).findOne({ where: { id: suggB1.id } });
    const reloadedC1 = await AgencyDataSource.getRepository(
      LeadFlowBriefingSuggestionEntity,
    ).findOne({ where: { id: suggC1.id } });

    // Field A: applied suggestion untouched, new one is pending with a conflict marker.
    expect(reloadedA1?.status).toBe(LeadFlowBriefingSuggestionStatus.Applied);
    expect(reloadedA1?.supersededBySuggestionId).toBeNull();
    expect(suggA2.status).toBe(LeadFlowBriefingSuggestionStatus.Pending);
    expect(suggA2.conflictsWithSuggestionId).toBe(suggA1.id);

    // Field B: never touched by v2 at all, stays applied.
    expect(reloadedB1?.status).toBe(LeadFlowBriefingSuggestionStatus.Applied);

    // Field C: still-pending sibling is auto-superseded, no conflict (nothing was committed).
    expect(reloadedC1?.status).toBe(LeadFlowBriefingSuggestionStatus.Superseded);
    expect(reloadedC1?.supersededBySuggestionId).toBe(suggC2.id);
    expect(suggC2.conflictsWithSuggestionId).toBeNull();
  });
});
