/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-assignment -- worker doubles use Jest asymmetric matchers. */
import type { SocialOrganicCredentialResolver } from '../credentials/social-organic-credential.resolver';
import type { SocialOrganicSyncRunEntity } from './entities/social-organic-sync-run.entity';
import type { MetaOrganicInsightsService } from './meta/meta-organic-insights.service';
import type { SocialOrganicSyncRunService } from './social-organic-sync-run.service';
import { SocialOrganicSyncWorker } from './social-organic-sync.worker';

function run(overrides: Partial<SocialOrganicSyncRunEntity> = {}) {
  return {
    id: 'run-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    agencyClientId: null,
    assetId: 'asset-1',
    windowStart: '2026-09-07',
    windowEnd: '2026-09-08',
    attempts: 1,
    maxAttempts: 5,
    ...overrides,
  } as SocialOrganicSyncRunEntity;
}

function harness() {
  const claimed = run();
  const runs = {
    claim: jest.fn(async () => [claimed]),
    recoverStale: jest.fn(async () => ({ requeued: 0, deadLettered: 0 })),
    markSucceeded: jest.fn(async () => true),
    reschedule: jest.fn(async () => true),
    markFailed: jest.fn(async () => true),
    markDeadLetter: jest.fn(async () => true),
  };
  const resolved = {
    assetTimezone: 'America/Sao_Paulo',
    credential: { assetId: 'asset-1' },
  };
  const credentials = {
    resolvePersistedForAnalytics: jest.fn(async () => resolved),
  };
  const insights = {
    sync: jest.fn(async () => ({
      postRows: [],
      accountRows: [{ assetId: 'asset-1' }],
      rowsSkipped: 2,
      apiCalls: 3,
    })),
  };

  return {
    claimed,
    runs,
    credentials,
    insights,
    worker: new SocialOrganicSyncWorker(
      runs as unknown as SocialOrganicSyncRunService,
      credentials as unknown as SocialOrganicCredentialResolver,
      insights as unknown as MetaOrganicInsightsService,
    ),
  };
}

describe('SocialOrganicSyncWorker', () => {
  it('revalidates durable triple scope and settles through the same lease owner', async () => {
    const { worker, runs, credentials, insights } = harness();

    await expect(worker.processDue(1)).resolves.toBe(1);

    expect(credentials.resolvePersistedForAnalytics).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      agencyClientId: null,
      assetId: 'asset-1',
    });
    expect(insights.sync).toHaveBeenCalledWith(
      expect.objectContaining({
        fromDate: '2026-09-07',
        toDate: '2026-09-08',
        syncRunId: 'run-1',
      }),
    );
    expect(runs.markSucceeded).toHaveBeenCalledWith({
      runId: 'run-1',
      lockedBy: expect.stringMatching(/:organic-insights$/),
      counters: { rowsWritten: 1, rowsSkipped: 2, apiCalls: 3 },
    });
  });

  it('fails a malformed durable window without calling provider code', async () => {
    const { worker, runs, credentials, insights } = harness();
    runs.claim.mockResolvedValueOnce([run({ windowStart: null })]);

    await expect(worker.processDue(1)).resolves.toBe(1);

    expect(credentials.resolvePersistedForAnalytics).not.toHaveBeenCalled();
    expect(insights.sync).not.toHaveBeenCalled();
    expect(runs.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-1',
        lastError: 'run_window_missing',
      }),
    );
  });
});
