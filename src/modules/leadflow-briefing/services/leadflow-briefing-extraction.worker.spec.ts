import { Logger } from '@nestjs/common';
import { LeadFlowBriefingExtractionWorker } from './leadflow-briefing-extraction.worker';
import {
  LeadFlowBriefingExtractionJobEntity,
  LeadFlowBriefingSourceVersionEntity,
} from '../entities';
import { LeadFlowBriefingJobStatus } from '../enums/leadflow-briefing-job-status.enum';
import { LeadFlowBriefingSourceVersionStatus } from '../enums/leadflow-briefing-source-version-status.enum';

function baseJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    settingsId: 'settings-1',
    sourceId: 'source-1',
    sourceVersionId: 'version-1',
    idempotencyKey: 'briefing-extraction:version-1:ai_extraction',
    status: LeadFlowBriefingJobStatus.Processing,
    lockedBy: 'this-worker',
    attempts: 1,
    maxAttempts: 5,
    ...overrides,
  };
}

function baseVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'version-1',
    sourceId: 'source-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    status: LeadFlowBriefingSourceVersionStatus.Available,
    objectKey: null,
    rawText: 'texto de briefing colado pelo usuário',
    mimeType: 'text/plain',
    byteSize: null,
    ...overrides,
  };
}

function setup(options: {
  job?: ReturnType<typeof baseJob> | null;
  version?: ReturnType<typeof baseVersion> | null;
  claimedIds?: string[];
  spentCents?: number;
  entitlementAllowed?: boolean;
}) {
  const job = 'job' in options ? options.job : baseJob();
  const version = 'version' in options ? options.version : baseVersion();
  const claimedIds = options.claimedIds ?? (job ? [job.id as string] : []);

  const jobRepo = {
    findOneBy: jest.fn().mockResolvedValue(job),
    update: jest.fn().mockResolvedValue({}),
  };
  const versionRepo = { findOne: jest.fn().mockResolvedValue(version) };

  const manager = {
    query: jest.fn().mockResolvedValue(claimedIds.map((id) => ({ id }))),
    createQueryBuilder: () => ({
      update: () => ({
        set: () => ({
          whereInIds: () => ({ execute: jest.fn().mockResolvedValue({}) }),
        }),
      }),
    }),
  };

  const dataSource = {
    transaction: jest.fn(async (run: (m: typeof manager) => Promise<unknown>) => run(manager)),
    query: jest.fn().mockResolvedValue([{ spent: String((options.spentCents ?? 0)) }]),
    getRepository: jest.fn((entity: unknown) =>
      entity === LeadFlowBriefingExtractionJobEntity ? jobRepo : versionRepo,
    ),
  };

  const files = { getPrivateAsset: jest.fn() };
  const jobService = { transitionJob: jest.fn().mockResolvedValue({}) };
  const suggestionService = { recordSuggestions: jest.fn().mockResolvedValue([]) };
  const provider = { extract: jest.fn() };
  const config = {
    mode: 'live',
    reserveCents: 5,
    dailyBudgetCents: 500,
    maxPdfPages: 30,
    maxExtractedChars: 1000,
    maxImagesPerJob: 3,
  };
  const permissionService = {
    canAccessProduct: jest.fn().mockResolvedValue(options.entitlementAllowed ?? true),
  };

  const worker = new LeadFlowBriefingExtractionWorker(
    dataSource as never,
    files as never,
    jobService as never,
    suggestionService as never,
    provider as never,
    config as never,
    permissionService as never,
  );

  return { worker, dataSource, jobRepo, versionRepo, jobService, suggestionService, provider, permissionService, manager };
}

describe('LeadFlowBriefingExtractionWorker', () => {
  afterEach(() => jest.restoreAllMocks());

  it('claim query reclaims stale (lease-expired) processing rows as well as due queued ones', async () => {
    const { worker, manager } = setup({ job: null, claimedIds: [] });

    await worker.processPending(5);

    const sql = manager.query.mock.calls[0]?.[0] as string;
    expect(sql).toContain("status = 'queued' AND available_at <= now()");
    expect(sql).toContain("status = 'processing' AND locked_at < now() - interval '5 minutes'");
  });

  it('silently skips a job that was raced away (e.g. cancelled) between claim and processing', async () => {
    const { worker, jobService, provider } = setup({ job: null, claimedIds: ['job-1'] });

    await worker.processPending(1);

    expect(jobService.transitionJob).not.toHaveBeenCalled();
    expect(provider.extract).not.toHaveBeenCalled();
  });

  it('fails a job whose tenant entitlement is inactive without calling the provider', async () => {
    const { worker, jobService, provider } = setup({ entitlementAllowed: false });

    await worker.processPending(1);

    expect(provider.extract).not.toHaveBeenCalled();
    expect(jobService.transitionJob).toHaveBeenCalledWith(
      expect.anything(),
      'job-1',
      LeadFlowBriefingJobStatus.Failed,
      expect.objectContaining({ lastError: 'leadflow_entitlement_inactive' }),
    );
  });

  it('fails a job over the derived daily budget without calling the provider', async () => {
    const { worker, jobService, provider } = setup({ spentCents: 500 });

    await worker.processPending(1);

    expect(provider.extract).not.toHaveBeenCalled();
    expect(jobService.transitionJob).toHaveBeenCalledWith(
      expect.anything(),
      'job-1',
      LeadFlowBriefingJobStatus.Failed,
      expect.objectContaining({ lastError: 'extraction_budget_exhausted' }),
    );
  });

  it('records suggestions and transitions to Succeeded on a full success round trip', async () => {
    const { worker, jobService, suggestionService, provider } = setup({});
    provider.extract.mockResolvedValue({
      suggestions: [{ fieldPath: 'identity.publicName', value: 'Acme', confidence: 0.8, rationale: 'r' }],
      provider: 'mock',
      model: 'mock',
      usage: { images: 0 },
      latencyMs: 10,
      attempts: 1,
    });

    await worker.processPending(1);

    expect(suggestionService.recordSuggestions).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        extractionJobId: 'job-1',
        settingsId: 'settings-1',
        sourceVersionId: 'version-1',
        suggestions: [
          { fieldPath: 'identity.publicName', suggestedValue: 'Acme', confidence: 0.8, rationale: 'r' },
        ],
      }),
    );
    expect(jobService.transitionJob).toHaveBeenCalledWith(
      expect.anything(),
      'job-1',
      LeadFlowBriefingJobStatus.Succeeded,
      expect.objectContaining({ costBudgetCents: expect.any(Number) }),
    );
  });

  it('backs off into Queued on a retryable provider failure while attempts remain', async () => {
    const { worker, jobService, provider } = setup({ job: baseJob({ attempts: 1, maxAttempts: 5 }) });
    provider.extract.mockRejectedValue(new Error('provider_boom'));

    await worker.processPending(1);

    expect(jobService.transitionJob).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      'job-1',
      LeadFlowBriefingJobStatus.Failed,
      expect.objectContaining({ lastError: 'provider_boom' }),
    );
    expect(jobService.transitionJob).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'job-1',
      LeadFlowBriefingJobStatus.Queued,
      expect.objectContaining({ availableAt: expect.any(Date) }),
    );
  });

  it('dead-letters a job once attempts are exhausted (poison job never retries forever)', async () => {
    const { worker, jobService, suggestionService, provider } = setup({
      job: baseJob({ attempts: 5, maxAttempts: 5 }),
    });
    provider.extract.mockResolvedValue({
      suggestions: [{ fieldPath: 'identity.publicName', value: 'x', confidence: 1, rationale: null }],
      provider: 'mock',
      model: 'mock',
      usage: { images: 0 },
      latencyMs: 1,
      attempts: 1,
    });
    suggestionService.recordSuggestions.mockRejectedValue(
      new Error('unknown_or_forbidden_field_path'),
    );

    await worker.processPending(1);

    expect(jobService.transitionJob).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'job-1',
      LeadFlowBriefingJobStatus.DeadLetter,
      {},
    );
  });

  it('never logs the raw error message or document content — only a normalized code', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const secret = 'SENSITIVE DOCUMENT TEXT sk-should-never-appear-in-logs';
    const { worker, provider } = setup({ job: baseJob({ attempts: 1, maxAttempts: 5 }) });
    provider.extract.mockRejectedValue(new Error(secret));

    await worker.processPending(1);

    for (const call of errorSpy.mock.calls) {
      const message = String(call[0]);
      expect(message).not.toContain(secret);
    }
    expect(errorSpy).toHaveBeenCalled();
  });

  it('logs nothing on a clean success run', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { worker, provider } = setup({});
    provider.extract.mockResolvedValue({
      suggestions: [],
      provider: 'mock',
      model: 'mock',
      usage: { images: 0 },
      latencyMs: 1,
      attempts: 1,
    });

    await worker.processPending(1);

    expect(errorSpy).not.toHaveBeenCalled();
  });
});
