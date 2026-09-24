/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-assignment -- worker doubles use Jest asymmetric matchers. */
import type { SocialOrganicCredentialResolver } from '../credentials/social-organic-credential.resolver';
import type { SocialOrganicSyncRunEntity } from './entities/social-organic-sync-run.entity';
import type { MetaOrganicPeriodReachService } from './meta/meta-organic-period-reach.service';
import type { SocialOrganicReachPeriodWriterService } from './social-organic-reach-period-writer.service';
import type { MetaOrganicAudienceService } from './meta/meta-organic-audience.service';
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

  // The demographics snapshot, which the worker takes alongside the window.
  // Defaults to the shape a closed gate returns, so existing assertions about
  // counters stay about the metrics sync alone.
  const audience = {
    sync: jest.fn(async () => ({
      assetId: 'asset-1',
      dimensions: 0,
      rowsWritten: 0,
      apiCalls: 0,
    })),
  };

  // Period reach: not an Instagram asset by default (apiCalls 0), so the
  // existing counter assertions stay about the metrics sync alone.
  const periodReach = {
    measure: jest.fn(async () => ({ reach: null, apiCalls: 0 })),
  };
  const reachWriter = { record: jest.fn(async () => undefined) };

  return {
    claimed,
    runs,
    credentials,
    insights,
    audience,
    periodReach,
    reachWriter,
    worker: new SocialOrganicSyncWorker(
      runs as unknown as SocialOrganicSyncRunService,
      credentials as unknown as SocialOrganicCredentialResolver,
      insights as unknown as MetaOrganicInsightsService,
      audience as unknown as MetaOrganicAudienceService,
      periodReach as unknown as MetaOrganicPeriodReachService,
      reachWriter as unknown as SocialOrganicReachPeriodWriterService,
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

describe('audience snapshot', () => {
  it('takes a demographics snapshot alongside the metrics window', async () => {
    // The regression this guards: the audience service was written and
    // registered in the module, and nothing ever called it — so the table
    // stayed empty regardless of what the feature gate said, and enabling the
    // gate looked like it had simply not worked.
    const context = harness();

    await context.worker.processDue(1);

    expect(context.audience.sync).toHaveBeenCalledTimes(1);
  });

  it('counts the snapshot rows into the run', async () => {
    const context = harness();
    context.audience.sync.mockResolvedValueOnce({
      assetId: 'asset-1',
      dimensions: 4,
      rowsWritten: 12,
      apiCalls: 4,
    });

    await context.worker.processDue(1);

    const counters = (
      context.runs.markSucceeded.mock.calls as unknown as Array<
        [{ counters: { rowsWritten: number; apiCalls: number } }]
      >
    )[0]?.[0]?.counters;
    // 1 account row from the metrics sync, plus the snapshot's 12.
    expect(counters?.rowsWritten).toBe(13);
    expect(counters?.apiCalls).toBe(7);
  });

  it('a failed snapshot does not fail a good metrics run', async () => {
    // The facts are already written and correct. Rescheduling the window over
    // a demographics read would re-fetch all of them against the same quota,
    // which is a larger harm than losing one day of demographics.
    const context = harness();
    context.audience.sync.mockRejectedValueOnce(new Error('graph_unavailable'));

    await context.worker.processDue(1);

    expect(context.runs.markSucceeded).toHaveBeenCalledTimes(1);
    expect(context.runs.markFailed).not.toHaveBeenCalled();
  });
});
