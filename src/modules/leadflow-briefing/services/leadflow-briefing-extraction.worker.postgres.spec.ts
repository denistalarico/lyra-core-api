import { randomUUID } from 'node:crypto';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import { CompanyContextService } from '../../leadflow-settings/services/company-context.service';
import { LeadFlowClientSettingsEntity } from '../../leadflow-settings/entities';
import { LeadFlowBusinessMode } from '../../leadflow-settings/enums/leadflow-business-mode.enum';
import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import {
  LeadFlowBriefingExtractionJobEntity,
  LeadFlowBriefingSourceEntity,
  LeadFlowBriefingSourceVersionEntity,
  LeadFlowBriefingSuggestionEntity,
} from '../entities';
import { LeadFlowBriefingJobStatus } from '../enums/leadflow-briefing-job-status.enum';
import { LeadFlowBriefingSourceKind } from '../enums/leadflow-briefing-source-kind.enum';
import { LeadFlowBriefingSourceVersionStatus } from '../enums/leadflow-briefing-source-version-status.enum';
import { LeadFlowBriefingExtractionJobService } from './leadflow-briefing-extraction-job.service';
import { LeadFlowBriefingExtractionProvider } from './leadflow-briefing-extraction-provider';
import { LeadFlowBriefingExtractionWorker } from './leadflow-briefing-extraction.worker';
import { LeadFlowBriefingJobStateMachine } from './leadflow-briefing-job-state-machine';
import { LeadFlowBriefingSourceService } from './leadflow-briefing-source.service';
import { LeadFlowBriefingSuggestionService } from './leadflow-briefing-suggestion.service';
import { describePostgresIntegration } from '../../../testing/postgres-integration';

const run = describePostgresIntegration();

function fakeExtractionConfig(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'mock',
    reserveCents: 5,
    dailyBudgetCents: 500,
    maxPdfPages: 30,
    maxExtractedChars: 1000,
    maxImagesPerJob: 3,
    ...overrides,
  } as never;
}

function fakePermissionService(allowed = true) {
  return { canAccessProduct: jest.fn().mockResolvedValue(allowed) } as never;
}

run('LeadFlowBriefingExtractionWorker PostgreSQL', () => {
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  let settingsId: string;
  let sourceService: LeadFlowBriefingSourceService;
  let jobService: LeadFlowBriefingExtractionJobService;
  let suggestionService: LeadFlowBriefingSuggestionService;

  const ctx = () => ({ tenantId, workspaceId, userId: randomUUID() });

  function makeWorker(opts: { entitlementAllowed?: boolean; configOverrides?: Record<string, unknown> } = {}) {
    const provider = new LeadFlowBriefingExtractionProvider(
      fakeExtractionConfig(opts.configOverrides),
    );
    return new LeadFlowBriefingExtractionWorker(
      AgencyDataSource,
      { getPrivateAsset: jest.fn() } as never,
      jobService,
      suggestionService,
      provider,
      fakeExtractionConfig(opts.configOverrides),
      fakePermissionService(opts.entitlementAllowed ?? true),
    );
  }

  async function makeQueuedJob(overrides: { attempts?: number; maxAttempts?: number } = {}) {
    const source = await sourceService.createSource(ctx(), {
      settingsId,
      contextType: LeadFlowSettingsContextType.Agency,
      agencyClientId: null,
      kind: LeadFlowBriefingSourceKind.Paste,
      label: 'Worker test source',
      createdById: null,
    });
    const version = await sourceService.createSourceVersion(ctx(), {
      sourceId: source.id,
      kind: LeadFlowBriefingSourceKind.Paste,
      rawText: 'Nossa empresa vende widgets para outras empresas.',
      mimeType: 'text/plain',
      checksum: `worker-${randomUUID()}`,
      status: LeadFlowBriefingSourceVersionStatus.Available,
      createdById: null,
    });
    const job = await jobService.enqueueJob(ctx(), {
      settingsId,
      sourceId: source.id,
      sourceVersionId: version.id,
      jobKind: `worker-test-${randomUUID()}`,
      createdById: null,
    });
    if (overrides.attempts || overrides.maxAttempts) {
      await AgencyDataSource.getRepository(LeadFlowBriefingExtractionJobEntity).update(
        { id: job.id },
        {
          attempts: overrides.attempts ?? 0,
          maxAttempts: overrides.maxAttempts ?? 5,
        },
      );
    }
    return { sourceId: source.id, versionId: version.id, jobId: job.id };
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
    await AgencyDataSource.getRepository(LeadFlowBriefingExtractionJobEntity).delete({ tenantId });
    await AgencyDataSource.getRepository(LeadFlowBriefingSourceVersionEntity).delete({ tenantId });
    await AgencyDataSource.getRepository(LeadFlowBriefingSourceEntity).delete({ tenantId });
    await AgencyDataSource.getRepository(LeadFlowClientSettingsEntity).delete({ tenantId });
  });

  it('claims a due queued job, records real suggestions, and marks it Succeeded', async () => {
    const { jobId } = await makeQueuedJob();
    const worker = makeWorker();

    const claimed = await worker.processPending(5);
    expect(claimed).toBeGreaterThanOrEqual(1);

    const job = await AgencyDataSource.getRepository(LeadFlowBriefingExtractionJobEntity).findOneBy({
      id: jobId,
    });
    expect(job?.status).toBe(LeadFlowBriefingJobStatus.Succeeded);

    const suggestions = await AgencyDataSource.getRepository(LeadFlowBriefingSuggestionEntity).find({
      where: { extractionJobId: jobId },
    });
    expect(suggestions.length).toBeGreaterThan(0);
  });

  it('reclaims a stale (lease-expired) processing job instead of leaving it stuck', async () => {
    const { jobId } = await makeQueuedJob();
    await AgencyDataSource.getRepository(LeadFlowBriefingExtractionJobEntity).update(
      { id: jobId },
      {
        status: LeadFlowBriefingJobStatus.Processing,
        lockedAt: new Date(Date.now() - 10 * 60 * 1000),
        lockedBy: 'dead-worker:1',
        attempts: 1,
      },
    );

    const worker = makeWorker();
    const claimed = await worker.processPending(5);
    expect(claimed).toBeGreaterThanOrEqual(1);

    const job = await AgencyDataSource.getRepository(LeadFlowBriefingExtractionJobEntity).findOneBy({
      id: jobId,
    });
    expect(job?.status).toBe(LeadFlowBriefingJobStatus.Succeeded);
    expect(job?.attempts).toBe(2);
  });

  it('never double-processes the same job under two concurrent claim batches (FOR UPDATE SKIP LOCKED)', async () => {
    const { jobId } = await makeQueuedJob();
    const workerA = makeWorker();
    const workerB = makeWorker();

    await Promise.all([workerA.processPending(5), workerB.processPending(5)]);

    const job = await AgencyDataSource.getRepository(LeadFlowBriefingExtractionJobEntity).findOneBy({
      id: jobId,
    });
    expect(job?.status).toBe(LeadFlowBriefingJobStatus.Succeeded);
    expect(job?.attempts).toBe(1);
  });

  it('dead-letters a job once attempts are exhausted when the tenant entitlement is inactive', async () => {
    const { jobId } = await makeQueuedJob({ attempts: 4, maxAttempts: 5 });
    const worker = makeWorker({ entitlementAllowed: false });

    await worker.processPending(5);

    const job = await AgencyDataSource.getRepository(LeadFlowBriefingExtractionJobEntity).findOneBy({
      id: jobId,
    });
    expect(job?.status).toBe(LeadFlowBriefingJobStatus.DeadLetter);
    expect(job?.lastError).toBe('leadflow_entitlement_inactive');
  });
});
