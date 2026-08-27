import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import { AgencyClient } from '../../clients/entities';
import { TenantProductEntitlementEntity } from '../../platform';
import { LeadFlowClientSettingsEntity } from '../entities';
import { LeadFlowBusinessMode } from '../enums/leadflow-business-mode.enum';
import { LeadFlowSettingsContextType } from '../enums/leadflow-settings-context-type.enum';
import { CompanyContextService } from './company-context.service';
import { LeadFlowClientSettingsService } from './leadflow-client-settings.service';
import {
  LeadFlowBriefingContextSnapshotEntity,
  LeadFlowBriefingExtractionJobEntity,
  LeadFlowBriefingSourceEntity,
  LeadFlowBriefingSourceVersionEntity,
  LeadFlowBriefingSuggestionApplicationEntity,
  LeadFlowBriefingSuggestionEntity,
} from '../../leadflow-briefing/entities';
import { LeadFlowBriefingSnapshotKind } from '../../leadflow-briefing/enums/leadflow-briefing-snapshot-kind.enum';
import { LeadFlowBriefingSourceKind } from '../../leadflow-briefing/enums/leadflow-briefing-source-kind.enum';
import { LeadFlowBriefingSourceService } from '../../leadflow-briefing/services/leadflow-briefing-source.service';
import { LeadFlowBriefingExtractionJobService } from '../../leadflow-briefing/services/leadflow-briefing-extraction-job.service';
import { LeadFlowBriefingJobStateMachine } from '../../leadflow-briefing/services/leadflow-briefing-job-state-machine';
import { LeadFlowBriefingSuggestionService } from '../../leadflow-briefing/services/leadflow-briefing-suggestion.service';
import { describePostgresIntegration } from '../../../testing/postgres-integration';

const run = describePostgresIntegration();

run('LeadFlowClientSettingsService publish PostgreSQL round trip', () => {
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  let settingsService: LeadFlowClientSettingsService;
  let sourceService: LeadFlowBriefingSourceService;
  let jobService: LeadFlowBriefingExtractionJobService;
  let suggestionService: LeadFlowBriefingSuggestionService;
  let settingsId: string;

  const ctx = () => ({ tenantId, workspaceId, userId: randomUUID() });

  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();

    settingsService = new LeadFlowClientSettingsService(
      AgencyDataSource,
      AgencyDataSource.getRepository(AgencyClient),
      AgencyDataSource.getRepository(LeadFlowClientSettingsEntity),
      AgencyDataSource.getRepository(TenantProductEntitlementEntity),
      {} as never,
      new CompanyContextService(),
    );
    sourceService = new LeadFlowBriefingSourceService(AgencyDataSource);
    jobService = new LeadFlowBriefingExtractionJobService(
      AgencyDataSource,
      new LeadFlowBriefingJobStateMachine(),
    );
    suggestionService = new LeadFlowBriefingSuggestionService(
      AgencyDataSource,
      new CompanyContextService(),
    );

    const settings = await AgencyDataSource.getRepository(
      LeadFlowClientSettingsEntity,
    ).save({
      tenantId,
      workspaceId,
      contextType: LeadFlowSettingsContextType.Agency,
      businessModeKey: LeadFlowBusinessMode.AgencyServices,
    });
    settingsId = settings.id;
  });

  afterAll(async () => {
    await AgencyDataSource.getRepository(
      LeadFlowBriefingContextSnapshotEntity,
    ).delete({ tenantId });
    await AgencyDataSource.getRepository(
      LeadFlowBriefingSuggestionApplicationEntity,
    ).delete({ tenantId });
    await AgencyDataSource.getRepository(LeadFlowBriefingSuggestionEntity).delete({
      tenantId,
    });
    await AgencyDataSource.getRepository(
      LeadFlowBriefingExtractionJobEntity,
    ).delete({ tenantId });
    await AgencyDataSource.getRepository(
      LeadFlowBriefingSourceVersionEntity,
    ).delete({ tenantId });
    await AgencyDataSource.getRepository(LeadFlowBriefingSourceEntity).delete({
      tenantId,
    });
    await AgencyDataSource.getRepository(LeadFlowClientSettingsEntity).delete({
      tenantId,
    });
  });

  async function applyOneSuggestion(fieldPath: string, value: string) {
    const source = await sourceService.createSource(ctx(), {
      settingsId,
      contextType: LeadFlowSettingsContextType.Agency,
      agencyClientId: null,
      kind: LeadFlowBriefingSourceKind.Upload,
      label: 'Publish round trip source',
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
    const [suggestion] = await suggestionService.recordSuggestions(ctx(), {
      extractionJobId: job.id,
      settingsId,
      sourceVersionId: version.id,
      suggestions: [{ fieldPath, suggestedValue: value }],
    });
    const applierId = randomUUID();
    await suggestionService.applySuggestion(ctx(), {
      suggestionId: suggestion.id,
      appliedById: applierId,
    });
    return { suggestionId: suggestion.id, appliedById: applierId };
  }

  it('reflects an AI-assisted apply as origin=suggestion, publishes it, then a manual edit as origin=manual, then detects a stale preview as a conflict', async () => {
    // 1. Apply a briefing suggestion into the draft.
    const { suggestionId, appliedById } = await applyOneSuggestion(
      'identity.publicName',
      'Acme Assisted',
    );

    // 2. Preview shows exactly one suggestion-origin change.
    const firstPreview = await settingsService.previewCompanyContext(ctx());
    expect(firstPreview.hasChanges).toBe(true);
    const publicNameChange = firstPreview.changes.find(
      (change) => change.fieldPath === 'identity.publicName',
    );
    expect(publicNameChange).toMatchObject({
      origin: 'suggestion',
      suggestionId,
      appliedById,
      nextValue: 'Acme Assisted',
    });

    // 3. Publish with the previewed hash succeeds; version increments; a
    //    Published-kind ledger row is written.
    const published = await settingsService.publishCompanyContext(
      ctx(),
      undefined,
      firstPreview.hash,
    );
    expect(published.companyContextPublishedVersion).toBe(1);
    expect(published.companyContextPublished).toMatchObject({
      identity: expect.objectContaining({ publicName: 'Acme Assisted' }),
    });

    const publishedSnapshots = await AgencyDataSource.getRepository(
      LeadFlowBriefingContextSnapshotEntity,
    ).find({
      where: {
        settingsId,
        snapshotKind: LeadFlowBriefingSnapshotKind.Published,
      },
    });
    expect(publishedSnapshots).toHaveLength(1);
    expect(publishedSnapshots[0].publishedVersion).toBe(1);

    // 4. Refresh: preview immediately after publish has no changes left.
    const settledPreview = await settingsService.previewCompanyContext(ctx());
    expect(settledPreview.hasChanges).toBe(false);

    // 5. Manual edit to a different field.
    await settingsService.updateAgencySettings(ctx(), {
      companyContextDraft: {
        identity: { publicName: 'Acme Assisted' },
        service: { businessHours: 'Seg-Sex 9h-18h' },
      },
    } as never);

    const manualPreview = await settingsService.previewCompanyContext(ctx());
    expect(manualPreview.hasChanges).toBe(true);
    expect(
      manualPreview.changes.find(
        (change) => change.fieldPath === 'service.businessHours',
      ),
    ).toMatchObject({ origin: 'manual' });

    // 6. Conflict: preview, then mutate the draft again before confirming —
    //    publishing with the now-stale hash must be refused, not silently
    //    applied.
    const stalePreviewHash = manualPreview.hash;
    await applyOneSuggestion('qualification.conversionGoal', 'Agendar reunião');

    await expect(
      settingsService.publishCompanyContext(ctx(), undefined, stalePreviewHash),
    ).rejects.toThrow(ConflictException);

    const afterConflict = await AgencyDataSource.getRepository(
      LeadFlowClientSettingsEntity,
    ).findOne({ where: { id: settingsId } });
    expect(afterConflict?.companyContextPublishedVersion).toBe(1);
  });
});
