/* eslint-disable @typescript-eslint/require-await -- worker test doubles expose partial service shapes. */
import type { ResolvedAdCredential } from '../credentials/resolved-ad-credential';
import { SocialAdCredentialError } from '../credentials/social-ad-credential.error';
import type { SocialAdCredentialResolver } from '../credentials/social-ad-credential.resolver';
import type { SocialAdSyncRunEntity } from '../entities/social-ad-sync-run.entity';
import { MetaGraphError } from './meta-graph-error';
import type { SocialAdConnectionService } from './social-ad-connection.service';
import type { SocialAdHierarchySyncService } from './social-ad-hierarchy-sync.service';
import type { SocialAdInsightsSyncService } from './social-ad-insights-sync.service';
import type { SocialAdSyncConfigService } from './social-ad-sync-config.service';
import type { SocialAdSyncRunService } from './social-ad-sync-run.service';
import type { SocialAdBackfillPlannerService } from './social-ad-backfill-planner.service';
import { currentDayIn } from '../sync/insights-window';
import { SocialAdSyncWorker } from './social-ad-sync.worker';

const CREDENTIAL = {
  connectionId: 'connection-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  agencyClientId: null,
  provider: 'meta_ads',
  externalAccountId: 'act_415877197389621',
  currency: 'BRL',
  timezone: 'America/Sao_Paulo',
} as unknown as ResolvedAdCredential;

function run(
  overrides: Partial<SocialAdSyncRunEntity> = {},
): SocialAdSyncRunEntity {
  return {
    id: 'run-a',
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    agencyClientId: null,
    connectionId: 'connection-a',
    provider: 'meta_ads',
    runKind: 'manual',
    status: 'processing',
    windowStart: '2026-07-18',
    windowEnd: '2026-07-22',
    entityLevels: ['account', 'campaign', 'adset', 'ad'],
    idempotencyKey: 'key',
    requestedById: 'user-a',
    attempts: 1,
    maxAttempts: 5,
    availableAt: new Date(),
    lockedAt: new Date(),
    lockedBy: 'host:1:social-sync',
    startedAt: new Date(),
    finishedAt: null,
    rowsWritten: 0,
    rowsSkipped: 0,
    entitiesWritten: 0,
    apiCalls: 0,
    lastError: null,
    failedSegments: [],
    cursorState: {},
    retainUntil: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as SocialAdSyncRunEntity;
}

type HarnessOptions = {
  enabled?: boolean;
  runs?: SocialAdSyncRunEntity[];
  resolveError?: Error;
  hierarchyError?: Error;
  insightsErrorFor?: 'account' | 'campaign';
  insightsError?: Error;
};

function createHarness(options: HarnessOptions = {}) {
  const levels: string[] = [];
  const order: string[] = [];

  const config = {
    get enabled() {
      return options.enabled ?? true;
    },
  } as SocialAdSyncConfigService;

  const runService = {
    claim: jest.fn(async () => options.runs ?? [run()]),
    recoverStale: jest.fn(async () => ({ requeued: 0, deadLettered: 0 })),
    markSucceeded: jest.fn(async () => true),
    markPartial: jest.fn(async () => true),
    markFailed: jest.fn(async () => true),
    markDeadLetter: jest.fn(async () => true),
    reschedule: jest.fn(async () => true),
  };

  const credentialResolver = {
    resolve: jest.fn(async () => {
      if (options.resolveError) throw options.resolveError;

      return CREDENTIAL;
    }),
  };

  const hierarchySync = {
    syncHierarchyWith: jest.fn(async () => {
      order.push('hierarchy');

      if (options.hierarchyError) throw options.hierarchyError;

      return {
        entitiesWritten: 12,
        apiCalls: 4,
        levels: [
          { level: 'account', skipped: 0 },
          { level: 'campaign', skipped: 1 },
        ],
      };
    }),
  };

  const insightsSync = {
    ingestLevel: jest.fn(async (input: { level: 'account' | 'campaign' }) => {
      order.push(`${input.level}_insights`);
      levels.push(input.level);

      if (options.insightsError && options.insightsErrorFor === input.level) {
        throw options.insightsError;
      }

      return {
        level: input.level,
        status: 'completed',
        read: 5,
        written: 5,
        skipped: 0,
        apiCalls: 1,
      };
    }),
  };

  const connectionService = {
    recordSyncOutcome: jest.fn(async () => undefined),
  };

  const backfillPlanner = {
    planNext: jest.fn(async () => ({ action: 'skipped', reason: 'complete' })),
  };

  const worker = new SocialAdSyncWorker(
    config,
    runService as unknown as SocialAdSyncRunService,
    credentialResolver as unknown as SocialAdCredentialResolver,
    hierarchySync as unknown as SocialAdHierarchySyncService,
    insightsSync as unknown as SocialAdInsightsSyncService,
    connectionService as unknown as SocialAdConnectionService,
    backfillPlanner as unknown as SocialAdBackfillPlannerService,
  );

  return {
    worker,
    runService,
    credentialResolver,
    hierarchySync,
    insightsSync,
    connectionService,
    backfillPlanner,
    levels,
    order,
  };
}

/**
 * The first argument one of the doubles was called with.
 *
 * The doubles are declared without parameters — they only ever return — so
 * TypeScript reads `mock.calls` as a list of empty tuples. Reaching through
 * `unknown` once here beats repeating the cast at every assertion.
 */
function firstCall<T>(fn: { mock: { calls: unknown[][] } }): T {
  return fn.mock.calls[0][0] as T;
}

describe('SocialAdSyncWorker — a run that works', () => {
  it('executes the hierarchy before the insights that reference it', async () => {
    const harness = createHarness();

    await harness.worker.processDue();

    expect(harness.order).toEqual([
      'hierarchy',
      'account_insights',
      'campaign_insights',
    ]);
  });

  it('resolves the credential once for the whole run', async () => {
    const harness = createHarness();

    await harness.worker.processDue();

    // Three segments, one credential. Resolving per segment would decrypt the
    // same token three times and let one unit of work execute against three
    // separately resolved credentials.
    expect(harness.credentialResolver.resolve).toHaveBeenCalledTimes(1);
    expect(harness.credentialResolver.resolve).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: null,
      connectionId: 'connection-a',
    });
  });

  it('reuses the proven services instead of reading Meta itself', async () => {
    const harness = createHarness();

    await harness.worker.processDue();

    expect(harness.hierarchySync.syncHierarchyWith).toHaveBeenCalledWith(
      CREDENTIAL,
    );
    expect(harness.insightsSync.ingestLevel).toHaveBeenCalledWith(
      expect.objectContaining({
        credential: CREDENTIAL,
        window: { since: '2026-07-18', until: '2026-07-22', days: 5 },
      }),
    );
  });

  it('stamps every fact of one run with one instant', async () => {
    const harness = createHarness();

    await harness.worker.processDue();

    const calls = harness.insightsSync.ingestLevel.mock.calls as unknown as [
      { syncedAt: Date },
    ][];

    expect(calls[0][0].syncedAt).toEqual(calls[1][0].syncedAt);
  });

  it('records what the run actually cost', async () => {
    const harness = createHarness();

    await harness.worker.processDue();

    expect(harness.runService.markSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-a',
        counters: {
          rowsWritten: 10,
          // One unkeyable hierarchy row: the column counts everything the
          // pipeline saw and could not store, whichever level produced it.
          rowsSkipped: 1,
          entitiesWritten: 12,
          apiCalls: 6,
        },
        failedSegments: [],
        lastError: null,
      }),
    );
  });

  it('marks the connection fresh and clears its error', async () => {
    const harness = createHarness();

    await harness.worker.processDue();

    expect(harness.connectionService.recordSyncOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: 'connection-a', error: null }),
    );
    expect(
      firstCall(harness.connectionService.recordSyncOutcome),
    ).toMatchObject({ syncedAt: expect.any(Date) as Date });
  });

  it('runs only the hierarchy for a run with no window', async () => {
    const harness = createHarness({
      runs: [run({ runKind: 'entities', windowStart: null, windowEnd: null })],
    });

    await harness.worker.processDue();

    expect(harness.order).toEqual(['hierarchy']);
    expect(harness.insightsSync.ingestLevel).not.toHaveBeenCalled();
  });

  it('resumes only what the last attempt did not finish', async () => {
    const harness = createHarness({
      runs: [
        run({
          attempts: 2,
          failedSegments: [
            { segment: 'campaign_insights', errorCode: 'meta_rate_limited' },
          ],
        }),
      ],
    });

    await harness.worker.processDue();

    // `failed_segments` is the retry plan: re-reading the hierarchy and the
    // account level would pay again for days that already landed.
    expect(harness.order).toEqual(['campaign_insights']);
  });

  it('falls back to the full plan when the stored one names nothing real', async () => {
    const harness = createHarness({
      runs: [run({ failedSegments: [{ segment: 'adset_insights' }] })],
    });

    await harness.worker.processDue();

    expect(harness.order).toEqual([
      'hierarchy',
      'account_insights',
      'campaign_insights',
    ]);
  });
});

describe('SocialAdSyncWorker — a run that partly works', () => {
  const authFailure = new MetaGraphError({
    kind: 'auth',
    safeMessage: 'Meta Ads campaign insights read failed.',
    metaCode: 200,
  });

  it('keeps what landed and says which segment did not', async () => {
    const harness = createHarness({
      insightsErrorFor: 'campaign',
      insightsError: authFailure,
    });

    await harness.worker.processDue();

    expect(harness.runService.markPartial).toHaveBeenCalledWith(
      expect.objectContaining({
        lastError: 'meta_permission_denied',
        failedSegments: [
          {
            segment: 'campaign_insights',
            errorCode: 'meta_permission_denied',
          },
        ],
      }),
    );
    expect(harness.runService.markFailed).not.toHaveBeenCalled();
  });

  it('still advances the connection timestamp, and still shows the error', async () => {
    const harness = createHarness({
      insightsErrorFor: 'campaign',
      insightsError: authFailure,
    });

    await harness.worker.processDue();

    // Both are true: facts landed, and something is broken. Clearing the error
    // would hide the hole; withholding the timestamp would show a connection
    // as staler than it is.
    expect(harness.connectionService.recordSyncOutcome).toHaveBeenCalledWith({
      connectionId: 'connection-a',
      syncedAt: expect.any(Date) as Date,
      error: 'meta_permission_denied',
    });
  });

  it('stops at the first failure rather than spending more quota', async () => {
    const harness = createHarness({
      insightsErrorFor: 'account',
      insightsError: new MetaGraphError({
        kind: 'rate_limited',
        safeMessage: 'Meta Ads account insights read failed.',
      }),
    });

    await harness.worker.processDue();

    // The campaign read would have discovered the same throttle, and spent
    // quota that has already run out doing it.
    expect(harness.levels).toEqual(['account']);
  });

  it('lists the segments it never reached as never reached', async () => {
    const harness = createHarness({
      insightsErrorFor: 'account',
      insightsError: new MetaGraphError({
        kind: 'auth',
        safeMessage: 'read failed',
        metaCode: 190,
      }),
    });

    await harness.worker.processDue();

    expect(firstCall(harness.runService.markPartial)).toMatchObject({
      failedSegments: [
        { segment: 'account_insights', errorCode: 'meta_credential_invalid' },
        { segment: 'campaign_insights', errorCode: 'not_attempted' },
      ],
    });
  });
});

describe('SocialAdSyncWorker — a run that fails', () => {
  it('requeues a transient failure with a backoff', async () => {
    const harness = createHarness({
      hierarchyError: new MetaGraphError({
        kind: 'transient',
        safeMessage: 'Meta Graph API request timed out.',
      }),
    });

    await harness.worker.processDue();

    const call = firstCall<{ availableAt: Date; lastError: string }>(
      harness.runService.reschedule,
    );

    expect(call.lastError).toBe('meta_transient');
    expect(call.availableAt.getTime()).toBeGreaterThan(Date.now());
    expect(harness.runService.markFailed).not.toHaveBeenCalled();
  });

  it('waits minutes, not seconds, after a rate limit', async () => {
    const harness = createHarness({
      hierarchyError: new MetaGraphError({
        kind: 'rate_limited',
        safeMessage: 'Meta Ads campaigns read failed.',
      }),
    });

    await harness.worker.processDue();

    const call = firstCall<{ availableAt: Date }>(
      harness.runService.reschedule,
    );

    expect(call.availableAt.getTime() - Date.now()).toBeGreaterThan(4 * 60_000);
  });

  it('never hammers an expired credential', async () => {
    const harness = createHarness({
      hierarchyError: new MetaGraphError({
        kind: 'auth',
        safeMessage: 'read failed',
        metaCode: 190,
      }),
    });

    await harness.worker.processDue();

    // Four more attempts would write four identical failures into the log and
    // present an operator with a connection that broke five different times.
    expect(harness.runService.reschedule).not.toHaveBeenCalled();
    expect(harness.runService.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({ lastError: 'meta_credential_invalid' }),
    );
  });

  it('does not advance the timestamp when nothing landed', async () => {
    const harness = createHarness({
      hierarchyError: new MetaGraphError({
        kind: 'permanent',
        safeMessage: 'read failed',
      }),
    });

    await harness.worker.processDue();

    // "Last synced" has to mean "we have facts as of then". Advancing it here
    // would present a broken connection as up to date.
    expect(harness.connectionService.recordSyncOutcome).toHaveBeenCalledWith({
      connectionId: 'connection-a',
      syncedAt: null,
      error: 'meta_permanent',
    });
  });

  it('dead-letters a retryable failure once the attempts are spent', async () => {
    const harness = createHarness({
      runs: [run({ attempts: 5, maxAttempts: 5 })],
      hierarchyError: new MetaGraphError({
        kind: 'transient',
        safeMessage: 'Meta Graph API request failed.',
      }),
    });

    await harness.worker.processDue();

    expect(harness.runService.reschedule).not.toHaveBeenCalled();
    expect(harness.runService.markDeadLetter).toHaveBeenCalled();
  });

  it('separates giving up from not bothering', async () => {
    // `failed` means retrying is pointless; `dead_letter` means it was worth
    // retrying and the tries ran out. Collapsing them would show "gave up" for
    // a credential that needs thirty seconds of somebody's attention.
    const stopped = createHarness({
      hierarchyError: new MetaGraphError({
        kind: 'permanent',
        safeMessage: 'read failed',
      }),
    });

    await stopped.worker.processDue();

    expect(stopped.runService.markFailed).toHaveBeenCalled();
    expect(stopped.runService.markDeadLetter).not.toHaveBeenCalled();
  });

  it('fails a run whose connection it cannot resolve, without executing anything', async () => {
    const harness = createHarness({
      resolveError: new SocialAdCredentialError('connection_not_found'),
    });

    await harness.worker.processDue();

    // A worker holding a connection id is not a worker holding permission: the
    // resolver scopes the lookup again, so a connection that moved out of the
    // run's scope simply is not found.
    expect(harness.hierarchySync.syncHierarchyWith).not.toHaveBeenCalled();
    expect(harness.runService.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        lastError: 'connection_not_found',
        counters: {
          rowsWritten: 0,
          rowsSkipped: 0,
          entitiesWritten: 0,
          apiCalls: 0,
        },
      }),
    );
  });

  it('refuses a run that asks for insights and carries no window', async () => {
    const harness = createHarness({
      runs: [run({ runKind: 'manual', windowStart: null, windowEnd: null })],
    });

    await harness.worker.processDue();

    // Unreachable from the endpoint, which derives the kind from the window.
    // The alternative to refusing is guessing a window and storing days nobody
    // asked for.
    expect(harness.runService.markPartial).toHaveBeenCalledWith(
      expect.objectContaining({ lastError: 'run_window_missing' }),
    );
    expect(harness.runService.reschedule).not.toHaveBeenCalled();
  });

  it('never lets a provider message reach the run', async () => {
    const harness = createHarness({
      hierarchyError: new MetaGraphError({
        kind: 'permanent',
        safeMessage:
          'Unsupported get request on act_415877197389621 with token EAAG.',
      }),
    });

    await harness.worker.processDue();

    const call = firstCall<{ lastError: string }>(
      harness.runService.markFailed,
    );

    expect(call.lastError).toBe('meta_permanent');
    expect(JSON.stringify(call)).not.toContain('EAAG');
    expect(JSON.stringify(call)).not.toContain('act_415877197389621');
  });
});

/**
 * The state machine, one test per transition.
 *
 * Two questions decide every outcome, in order: *will there be another
 * attempt?*, and only if not, *did anything land?* The tests below fix that
 * order, because the interesting bug it prevents is silent — a run that wrote
 * half its segments and has a backoff scheduled must not be recorded as
 * `partial`, which is a terminal state, in the middle of still running.
 */
describe('SocialAdSyncWorker — the state machine', () => {
  const transient = () =>
    new MetaGraphError({
      kind: 'transient',
      safeMessage: 'Meta Graph API request timed out.',
    });

  const permanent = () =>
    new MetaGraphError({ kind: 'permanent', safeMessage: 'read failed' });

  it('retryable after progress: back to queued, never partial', async () => {
    const harness = createHarness({
      insightsErrorFor: 'account',
      insightsError: transient(),
    });

    await harness.worker.processDue();

    const call = firstCall<{
      counters: { entitiesWritten: number };
      failedSegments: { segment: string; errorCode: string }[];
      availableAt: Date;
      lastError: string;
    }>(harness.runService.reschedule);

    // The hierarchy landed and is kept; the run has a backoff and is not over.
    expect(call.counters.entitiesWritten).toBe(12);
    expect(call.availableAt.getTime()).toBeGreaterThan(Date.now());
    expect(call.lastError).toBe('meta_transient');
    expect(call.failedSegments).toEqual([
      { segment: 'account_insights', errorCode: 'meta_transient' },
      { segment: 'campaign_insights', errorCode: 'not_attempted' },
    ]);

    // Terminal states are what this must not be. `partial` in the history of a
    // run that is about to run again is a lie about how it ended.
    expect(harness.runService.markPartial).not.toHaveBeenCalled();
    expect(harness.runService.markFailed).not.toHaveBeenCalled();
    expect(harness.runService.markDeadLetter).not.toHaveBeenCalled();
  });

  it('the next claim executes only what that plan named', async () => {
    const first = createHarness({
      insightsErrorFor: 'account',
      insightsError: transient(),
    });

    await first.worker.processDue();

    const { failedSegments } = firstCall<{
      failedSegments: { segment: string; errorCode: string }[];
    }>(first.runService.reschedule);

    // The row as the queue would hand it back, carrying that plan.
    const second = createHarness({
      runs: [run({ attempts: 2, failedSegments })],
    });

    await second.worker.processDue();

    // The hierarchy is not read again: it already landed, and re-reading it
    // would spend four more requests to write the same rows.
    expect(second.order).toEqual(['account_insights', 'campaign_insights']);
    expect(second.runService.markSucceeded).toHaveBeenCalled();
  });

  it('non-retryable after progress: partial, terminal', async () => {
    const harness = createHarness({
      insightsErrorFor: 'campaign',
      insightsError: permanent(),
    });

    await harness.worker.processDue();

    const call = firstCall<{
      counters: { rowsWritten: number; entitiesWritten: number };
      failedSegments: { segment: string }[];
    }>(harness.runService.markPartial);

    // Hierarchy and account insights are kept; the campaign hole is recorded.
    expect(call.counters.entitiesWritten).toBe(12);
    expect(call.counters.rowsWritten).toBe(5);
    expect(call.failedSegments).toEqual([
      { segment: 'campaign_insights', errorCode: 'meta_permanent' },
    ]);

    // Nothing will claim it again: no backoff was scheduled.
    expect(harness.runService.reschedule).not.toHaveBeenCalled();
  });

  it('non-retryable without progress: failed', async () => {
    const harness = createHarness({ hierarchyError: permanent() });

    await harness.worker.processDue();

    expect(harness.runService.markFailed).toHaveBeenCalled();
    expect(harness.runService.reschedule).not.toHaveBeenCalled();
    expect(harness.runService.markPartial).not.toHaveBeenCalled();
    expect(harness.runService.markDeadLetter).not.toHaveBeenCalled();
  });

  it('retryable with the attempts spent and nothing written: dead_letter', async () => {
    const harness = createHarness({
      runs: [run({ attempts: 5, maxAttempts: 5 })],
      hierarchyError: transient(),
    });

    await harness.worker.processDue();

    expect(harness.runService.markDeadLetter).toHaveBeenCalled();
    expect(harness.runService.reschedule).not.toHaveBeenCalled();
    expect(harness.runService.markFailed).not.toHaveBeenCalled();
  });

  it('retryable with the attempts spent after progress: partial, not dead_letter', async () => {
    const harness = createHarness({
      runs: [run({ attempts: 5, maxAttempts: 5 })],
      insightsErrorFor: 'account',
      insightsError: transient(),
    });

    await harness.worker.processDue();

    // Retrying is over, so question two decides — and something landed.
    // `dead_letter` here would say nothing was accomplished, with 452 entities
    // in the table saying otherwise.
    expect(harness.runService.markPartial).toHaveBeenCalled();
    expect(harness.runService.markDeadLetter).not.toHaveBeenCalled();
  });

  it('spends exactly the attempts it was given', async () => {
    // The boundary: attempt 4 of 5 still retries, attempt 5 does not.
    const fourth = createHarness({
      runs: [run({ attempts: 4, maxAttempts: 5 })],
      hierarchyError: transient(),
    });
    await fourth.worker.processDue();

    expect(fourth.runService.reschedule).toHaveBeenCalled();

    const fifth = createHarness({
      runs: [run({ attempts: 5, maxAttempts: 5 })],
      hierarchyError: transient(),
    });
    await fifth.worker.processDue();

    expect(fifth.runService.reschedule).not.toHaveBeenCalled();
  });
});

describe('SocialAdSyncWorker — the tick', () => {
  it('claims nothing while the runtime is off', async () => {
    const harness = createHarness({ enabled: false });

    await harness.worker.tick();

    expect(harness.runService.claim).not.toHaveBeenCalled();
    expect(harness.runService.recoverStale).not.toHaveBeenCalled();
  });

  it('recovers abandoned leases before claiming, so this tick can take them', async () => {
    const harness = createHarness();

    await harness.worker.tick();

    const recovered =
      harness.runService.recoverStale.mock.invocationCallOrder[0];
    const claimed = harness.runService.claim.mock.invocationCallOrder[0];

    expect(recovered).toBeLessThan(claimed);
  });

  it('identifies itself by host and process, and claims one run at a time', async () => {
    const harness = createHarness();

    await harness.worker.tick();

    expect(harness.runService.claim).toHaveBeenCalledWith({
      workerId: expect.stringMatching(/^.+:\d+:social-sync$/) as string,
      limit: 1,
    });
  });

  it('survives a cycle that throws instead of ending the interval', async () => {
    const harness = createHarness();
    harness.runService.recoverStale.mockRejectedValueOnce(
      new Error('connection terminated'),
    );

    await expect(harness.worker.tick()).resolves.toBeUndefined();

    // And the next tick still runs: a swallowed error that also left the guard
    // set would stop the worker permanently.
    await harness.worker.tick();
    expect(harness.runService.claim).toHaveBeenCalledTimes(1);
  });
});

describe('SocialAdSyncWorker — closed windows and today', () => {
  /** The account's own current day, whenever this suite happens to run. */
  const today = () => currentDayIn('America/Sao_Paulo');

  it('stores a closed window as final', async () => {
    const harness = createHarness({ runs: [run({ runKind: 'daily' })] });

    await harness.worker.processDue();

    expect(
      firstCall<{ isPartial: boolean }>(harness.insightsSync.ingestLevel),
    ).toMatchObject({ isPartial: false });
  });

  it('stores a backfill chunk as final, like any other closed window', async () => {
    const harness = createHarness({
      runs: [
        run({
          runKind: 'backfill',
          windowStart: '2026-05-01',
          windowEnd: '2026-05-07',
        }),
      ],
    });

    await harness.worker.processDue();

    // A backfill reads history, and history is settled. Nothing about a run
    // being automatic makes its days provisional.
    expect(
      firstCall<{ isPartial: boolean }>(harness.insightsSync.ingestLevel),
    ).toMatchObject({ isPartial: false });
  });

  it('reads only insights for a backfill chunk, never the hierarchy again', async () => {
    const harness = createHarness({
      runs: [
        run({
          runKind: 'backfill',
          windowStart: '2026-05-01',
          windowEnd: '2026-05-07',
        }),
      ],
    });

    await harness.worker.processDue();

    // The chain sweeps the tree once, ahead of the chunks. Thirteen chunks each
    // re-reading 450 objects would learn nothing after the first.
    expect(harness.hierarchySync.syncHierarchyWith).not.toHaveBeenCalled();
    expect(harness.order).toEqual(['account_insights', 'campaign_insights']);
  });

  it('stores an intraday window as provisional', async () => {
    const day = today();
    const harness = createHarness({
      runs: [run({ runKind: 'intraday', windowStart: day, windowEnd: day })],
    });

    await harness.worker.processDue();

    expect(
      firstCall<{ isPartial: boolean }>(harness.insightsSync.ingestLevel),
    ).toMatchObject({ isPartial: true, window: { since: day, until: day } });
    expect(harness.runService.markSucceeded).toHaveBeenCalled();
  });

  it('refuses an intraday run whose day turned over while it waited', async () => {
    // Queued at 23:59, claimed after the account's midnight. The window it was
    // created for is now a settled day, and writing it as provisional would
    // advertise a final number as still moving.
    const harness = createHarness({
      runs: [
        run({
          runKind: 'intraday',
          windowStart: '2026-07-18',
          windowEnd: '2026-07-18',
          attempts: 1,
        }),
      ],
    });

    await harness.worker.processDue();

    expect(harness.insightsSync.ingestLevel).not.toHaveBeenCalled();
    // Terminal, not retried: the date will never be today again, and five
    // attempts would write five identical failures into the log.
    expect(harness.runService.reschedule).not.toHaveBeenCalled();
    expect(harness.runService.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({ lastError: 'insights_window_not_intraday' }),
    );
  });

  it('refuses a closed run that reaches into an unfinished day', async () => {
    const day = today();
    const harness = createHarness({
      runs: [run({ runKind: 'daily', windowStart: day, windowEnd: day })],
    });

    await harness.worker.processDue();

    expect(harness.insightsSync.ingestLevel).not.toHaveBeenCalled();
    // `partial` rather than `failed`: a daily run reads the hierarchy first,
    // and that segment landed. The refusal is terminal either way — no retry
    // makes an unfinished day finished any sooner than the clock does.
    expect(harness.runService.reschedule).not.toHaveBeenCalled();
    expect(harness.runService.markPartial).toHaveBeenCalledWith(
      expect.objectContaining({ lastError: 'insights_window_not_closed' }),
    );
  });
});

describe('SocialAdSyncWorker — the backfill chain', () => {
  const chunk = (overrides: Partial<SocialAdSyncRunEntity> = {}) =>
    run({
      runKind: 'backfill',
      windowStart: '2026-05-01',
      windowEnd: '2026-05-07',
      ...overrides,
    });

  it('hands over to the next chunk as soon as one succeeds', async () => {
    const harness = createHarness({ runs: [chunk()] });

    await harness.worker.processDue();

    // Seconds rather than the hour the scheduler would take. The planner is
    // what refuses to queue two at once, so this cannot outrun itself.
    expect(harness.backfillPlanner.planNext).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'connection-a',
        timezone: 'America/Sao_Paulo',
      }),
    );
  });

  it('hands over after a chunk gives up, so one bad week is not the end', async () => {
    const harness = createHarness({
      runs: [chunk({ attempts: 5 })],
      insightsErrorFor: 'account',
      insightsError: new MetaGraphError({
        kind: 'permanent',
        safeMessage: 'Unsupported request.',
      }),
    });

    await harness.worker.processDue();

    expect(harness.runService.markFailed).toHaveBeenCalled();
    expect(harness.backfillPlanner.planNext).toHaveBeenCalled();
  });

  it('does not hand over while a retry is still coming', async () => {
    const harness = createHarness({
      runs: [chunk()],
      insightsErrorFor: 'account',
      insightsError: new MetaGraphError({
        kind: 'transient',
        safeMessage: 'Please retry.',
      }),
    });

    await harness.worker.processDue();

    // The run is back in the queue. Queueing the next chunk beside it would put
    // two of this connection's backfill runs in flight at once.
    expect(harness.runService.reschedule).toHaveBeenCalled();
    expect(harness.backfillPlanner.planNext).not.toHaveBeenCalled();
  });

  it('cannot hand over when the credential never resolved', async () => {
    const harness = createHarness({
      runs: [chunk()],
      resolveError: new SocialAdCredentialError('token_missing'),
    });

    await harness.worker.processDue();

    // There is no timezone to anchor a plan with. The scheduler's hourly tick
    // is the recovery path.
    expect(harness.backfillPlanner.planNext).not.toHaveBeenCalled();
  });

  it('leaves the cadences alone', async () => {
    const harness = createHarness({ runs: [run({ runKind: 'daily' })] });

    await harness.worker.processDue();

    expect(harness.backfillPlanner.planNext).not.toHaveBeenCalled();
  });

  it('does not let a planning failure disturb a settled run', async () => {
    const harness = createHarness({ runs: [chunk()] });
    harness.backfillPlanner.planNext.mockRejectedValueOnce(
      new Error('queue unavailable'),
    );

    await expect(harness.worker.processDue()).resolves.toBe(1);
    expect(harness.runService.markSucceeded).toHaveBeenCalled();
  });
});
