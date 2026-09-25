import type { SocialOrganicCredentialResolver } from '../credentials/social-organic-credential.resolver';
import type { SocialOrganicSyncRunEntity } from './entities/social-organic-sync-run.entity';
import type { MetaOrganicOnlineFollowersService } from './meta/meta-organic-online-followers.service';
import type {
  MetaOrganicPeriodMeasurement,
  MetaOrganicPeriodReachService,
} from './meta/meta-organic-period-reach.service';
import type { MetaOrganicStoriesService } from './meta/meta-organic-stories.service';
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

/**
 * A period measurement, all-null unless a test says otherwise.
 *
 * Written as a builder rather than a literal per test: the measurement carries
 * nineteen figures, and a test that spelled out all of them would be mostly
 * noise around the two it cares about — and would need editing every time a
 * surface is added.
 */
function measurement(
  overrides: Partial<MetaOrganicPeriodMeasurement> = {},
): MetaOrganicPeriodMeasurement {
  return {
    views: null,
    viewsOrganic: null,
    viewsPaid: null,
    viewsFeed: null,
    viewsReel: null,
    viewsStory: null,
    reach: null,
    reachOrganic: null,
    reachPaid: null,
    reachFeed: null,
    reachReel: null,
    reachStory: null,
    interactionsReel: null,
    interactionsStory: null,
    likesReel: null,
    commentsReel: null,
    savesReel: null,
    sharesReel: null,
    sharesStory: null,
    measuredSince: '2026-09-07',
    measuredUntil: '2026-09-08',
    truncated: false,
    apiCalls: 0,
    ...overrides,
  };
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

  // Likewise silent by default, so the existing counter assertions stay about
  // the metrics sync alone.
  const onlineFollowers = {
    sync: jest.fn(async () => ({
      rowsWritten: 0,
      daysCovered: 0,
      apiCalls: 0,
    })),
  };

  // Period reach: not an Instagram asset by default (apiCalls 0), so the
  // existing counter assertions stay about the metrics sync alone.
  //
  // `measurePeriod` is the method the worker calls. A double that only carried
  // `measure` still let every test pass — the worker swallows a failed
  // measurement so a good metrics run is not lost — while the pass threw
  // `TypeError` on every window and wrote nothing. The visible symptom was four
  // warnings per test in the log and a period card that stayed empty in
  // production, which is exactly the shape of failure the swallow is there to
  // cause on purpose for real errors and hides for this one.
  //
  // Typed against the real measurement rather than inferred: the default's
  // nulls would otherwise narrow every field to `null`, and a test overriding
  // one with a real figure would not compile.
  const periodReach = {
    measurePeriod: jest.fn<Promise<MetaOrganicPeriodMeasurement>, []>(
      async () => measurement(),
    ),
  };
  const reachWriter = { record: jest.fn(async () => undefined) };
  const stories = {
    sync: jest.fn(async () => ({
      storiesSeen: 0,
      rowsWritten: 0,
      apiCalls: 0,
    })),
  };

  return {
    claimed,
    runs,
    credentials,
    insights,
    audience,
    onlineFollowers,
    periodReach,
    reachWriter,
    stories,
    worker: new SocialOrganicSyncWorker(
      runs as unknown as SocialOrganicSyncRunService,
      credentials as unknown as SocialOrganicCredentialResolver,
      insights as unknown as MetaOrganicInsightsService,
      audience as unknown as MetaOrganicAudienceService,
      onlineFollowers as unknown as MetaOrganicOnlineFollowersService,
      periodReach as unknown as MetaOrganicPeriodReachService,
      reachWriter as unknown as SocialOrganicReachPeriodWriterService,
      stories as unknown as MetaOrganicStoriesService,
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

describe('period measurement', () => {
  it('stores all six figures, not just the total', async () => {
    // The gap this closes: `measurePeriod` computes views and reach with their
    // organic and paid slices from the same two API calls, and the worker used
    // to call the narrower `measure` and keep one number. The other five were
    // paid for and discarded, so the cards asking for them had nothing to read.
    const context = harness();
    context.periodReach.measurePeriod.mockResolvedValue(
      measurement({
        views: '9155',
        viewsOrganic: '509',
        viewsPaid: '8646',
        reach: '6783',
        reachOrganic: '156',
        reachPaid: '6645',
        reachFeed: '39',
        reachReel: '11',
        reachStory: '105',
        measuredSince: '2026-08-26',
        measuredUntil: '2026-09-24',
        apiCalls: 2,
      }),
    );

    await context.worker.processDue(1);

    expect(context.reachWriter.record).toHaveBeenCalledWith(
      expect.objectContaining({
        reach: '6783',
        reachOrganic: '156',
        reachPaid: '6645',
        reachFeed: '39',
        views: '9155',
        viewsOrganic: '509',
        viewsPaid: '8646',
      }),
    );
  });

  it('carries the measured range so a clamped window can say so', async () => {
    // Meta refuses a span wider than 30 days, so a longer request is measured
    // over its last 30. Storing the range keeps a card from labelling that
    // figure with the period the operator asked for.
    const context = harness();
    context.periodReach.measurePeriod.mockResolvedValue(
      measurement({
        views: '10',
        reach: '10',
        measuredSince: '2026-08-26',
        measuredUntil: '2026-09-24',
        truncated: true,
        apiCalls: 2,
      }),
    );

    await context.worker.processDue(1);

    expect(context.reachWriter.record).toHaveBeenCalledWith(
      expect.objectContaining({
        measuredSince: '2026-08-26',
        measuredUntil: '2026-09-24',
        truncated: true,
      }),
    );
  });
});

describe('online followers', () => {
  it('collects the hourly grid alongside the metrics window', async () => {
    // Same regression the audience test guards, and more costly here: Meta
    // keeps ~30 days of this metric, so a pass that is never called does not
    // just leave a table empty — it loses days permanently as they age out.
    const context = harness();

    await context.worker.processDue(1);

    expect(context.onlineFollowers.sync).toHaveBeenCalledTimes(1);
  });

  it('counts the grid rows into the run', async () => {
    const context = harness();
    context.onlineFollowers.sync.mockResolvedValueOnce({
      rowsWritten: 720,
      daysCovered: 30,
      apiCalls: 1,
    });

    await context.worker.processDue(1);

    const counters = (
      context.runs.markSucceeded.mock.calls as unknown as Array<
        [{ counters: { rowsWritten: number; apiCalls: number } }]
      >
    )[0]?.[0]?.counters;
    // 1 account row from the metrics sync, plus 30 days × 24 hours.
    expect(counters?.rowsWritten).toBe(721);
    expect(counters?.apiCalls).toBe(4);
  });

  it('a failed grid does not fail a good metrics run', async () => {
    const context = harness();
    context.onlineFollowers.sync.mockRejectedValueOnce(
      new Error('graph_unavailable'),
    );

    await context.worker.processDue(1);

    expect(context.runs.markSucceeded).toHaveBeenCalledTimes(1);
    expect(context.runs.markFailed).not.toHaveBeenCalled();
  });
});
