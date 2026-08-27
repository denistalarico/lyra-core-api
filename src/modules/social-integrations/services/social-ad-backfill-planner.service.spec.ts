/* eslint-disable @typescript-eslint/require-await -- planner test doubles expose partial service shapes. */
import {
  SocialAdBackfillPlannerService,
  advancesBackfillChain,
  resolveChunkState,
} from './social-ad-backfill-planner.service';
import type { SocialAdSchedulableConnection } from './social-ad-connection.service';
import type { SocialAdSyncConfigService } from './social-ad-sync-config.service';
import type {
  SocialAdBackfillChunkOutcome,
  SocialAdSyncRunService,
} from './social-ad-sync-run.service';

const CONNECTION: SocialAdSchedulableConnection = {
  connectionId: 'connection-sp',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  agencyClientId: null,
  provider: 'meta_ads',
  timezone: 'America/Sao_Paulo',
};

/** 15:00 in São Paulo on the 26th, so the account's last settled day is the 25th. */
const NOW = new Date('2026-08-26T18:00:00Z');
const ANCHOR = '2026-08-25';

function createHarness(
  options: {
    enabled?: boolean;
    backfillDays?: number;
    chunkDays?: number;
    inFlight?: boolean;
    /**
     * Backfill runs this connection already has. A bare string is shorthand for
     * a chunk that succeeded, which is the common case in these tests; the
     * object form is for the outcomes that must *not* count as coverage.
     */
    attempted?: (string | SocialAdBackfillChunkOutcome)[];
    settledHierarchy?: boolean;
  } = {},
) {
  const enqueued: Record<string, unknown>[] = [];

  const config = {
    get enabled() {
      return options.enabled ?? true;
    },
    get backfillDays() {
      return options.backfillDays ?? 90;
    },
    get backfillChunkDays() {
      return options.chunkDays ?? 7;
    },
  } as SocialAdSyncConfigService;

  const outcomes: SocialAdBackfillChunkOutcome[] = (
    options.attempted ?? []
  ).map((entry) =>
    typeof entry === 'string' ? { until: entry, status: 'succeeded' } : entry,
  );

  const runService = {
    hasInFlightRun: jest.fn(async () => options.inFlight ?? false),
    listBackfillChunkOutcomes: jest.fn(async () => outcomes),
    hasSettledRun: jest.fn(async () => options.settledHierarchy ?? false),
    enqueue: jest.fn(async (input: Record<string, unknown>) => {
      enqueued.push(input);

      return { run: { id: `run-${enqueued.length}` }, deduplicated: false };
    }),
  };

  const planner = new SocialAdBackfillPlannerService(
    config,
    runService as unknown as SocialAdSyncRunService,
  );

  return { planner, runService, enqueued };
}

/** The window ends of a full 90-day plan anchored at D-1, newest first. */
const FULL_PLAN_ENDS = Array.from({ length: 13 }, (_, index) =>
  shift(ANCHOR, -index * 7),
);

describe('SocialAdBackfillPlannerService — starting a chain', () => {
  it('reads the hierarchy first, and does not queue a chunk beside it', async () => {
    const harness = createHarness();

    const decision = await harness.planner.planNext(CONNECTION, NOW);

    expect(decision).toEqual({
      action: 'enqueued',
      runKind: 'entities',
      runId: 'run-1',
    });
    // One row, not two. The chunks wait for the mirror because a campaign that
    // appears in facts and not in the mirror renders as an id — and because
    // one piece of work at a time is what keeps the queue fair.
    expect(harness.enqueued).toHaveLength(1);
    expect(harness.enqueued[0]).toMatchObject({
      runKind: 'entities',
      windowStart: null,
      windowEnd: null,
      requestedById: null,
    });
  });

  it('skips the hierarchy when this connection has already had one', async () => {
    const harness = createHarness({ settledHierarchy: true });

    const decision = await harness.planner.planNext(CONNECTION, NOW);

    expect(decision).toMatchObject({ runKind: 'backfill' });
    expect(harness.enqueued[0]).toMatchObject({
      runKind: 'backfill',
      windowStart: '2026-08-19',
      windowEnd: ANCHOR,
    });
  });

  it('anchors the first chunk at the account last settled day', async () => {
    const harness = createHarness({ settledHierarchy: true });

    await harness.planner.planNext(CONNECTION, NOW);

    // D-1 in São Paulo, never D0 — a backfill writes closed days only — and
    // never the server's yesterday, which is a different date for part of
    // every day.
    expect(harness.enqueued[0]).toMatchObject({ windowEnd: '2026-08-25' });
  });

  it('reads the account own day, not the server one', async () => {
    const harness = createHarness({ settledHierarchy: true });

    // The same instant is already the 27th in Auckland, so its last settled
    // day is the 26th rather than the 25th.
    await harness.planner.planNext(
      { ...CONNECTION, timezone: 'Pacific/Auckland' },
      NOW,
    );

    expect(harness.enqueued[0]).toMatchObject({ windowEnd: '2026-08-26' });
  });

  it('claims only the levels a chunk actually reads', async () => {
    const harness = createHarness({ settledHierarchy: true });

    await harness.planner.planNext(CONNECTION, NOW);

    // Account and campaign. The chunk carries no hierarchy segment, so listing
    // ad sets and ads would describe work it does not do.
    expect(harness.enqueued[0]).toMatchObject({
      entityLevels: ['account', 'campaign'],
    });
  });
});

describe('SocialAdBackfillPlannerService — not starting one', () => {
  it('queues nothing at all while the runtime is off', async () => {
    const harness = createHarness({ enabled: false });

    expect(await harness.planner.planNext(CONNECTION, NOW)).toEqual({
      action: 'skipped',
      reason: 'sync_disabled',
    });

    // Not one row, and not one read either: a queue nothing drains would
    // execute every connection's whole history at once when it came back.
    expect(harness.enqueued).toHaveLength(0);
    expect(harness.runService.hasInFlightRun).not.toHaveBeenCalled();
  });

  it('resumes on a later call once the runtime is back', async () => {
    // The decision is derived from state that does not expire, so nothing
    // records that the connection was ever postponed. The scheduler's next
    // tick simply gets a different answer.
    const off = createHarness({ enabled: false, settledHierarchy: true });
    expect(await off.planner.planNext(CONNECTION, NOW)).toMatchObject({
      reason: 'sync_disabled',
    });

    const on = createHarness({ settledHierarchy: true });
    expect(await on.planner.planNext(CONNECTION, NOW)).toMatchObject({
      action: 'enqueued',
      runKind: 'backfill',
    });
  });

  it('queues nothing when backfill itself is switched off', async () => {
    const harness = createHarness({ backfillDays: 0 });

    expect(await harness.planner.planNext(CONNECTION, NOW)).toEqual({
      action: 'skipped',
      reason: 'backfill_disabled',
    });
    expect(harness.enqueued).toHaveLength(0);
  });

  it('waits while a piece of the chain is still in flight', async () => {
    const harness = createHarness({ inFlight: true, attempted: [ANCHOR] });

    expect(await harness.planner.planNext(CONNECTION, NOW)).toEqual({
      action: 'skipped',
      reason: 'chain_busy',
    });

    expect(harness.runService.hasInFlightRun).toHaveBeenCalledWith(
      CONNECTION.connectionId,
      ['entities', 'backfill'],
    );
    expect(harness.enqueued).toHaveLength(0);
  });

  it('starts a chain for a connection with zero backfill runs', async () => {
    // The only condition. Nothing else is consulted, and nothing else can
    // suppress it.
    const harness = createHarness({ attempted: [], settledHierarchy: true });

    expect(await harness.planner.planNext(CONNECTION, NOW)).toMatchObject({
      action: 'enqueued',
      runKind: 'backfill',
    });
    expect(harness.enqueued[0]).toMatchObject({ windowEnd: ANCHOR });
  });

  it('starts a chain even for a connection that already holds ninety days of facts', async () => {
    // Deliberately redundant with the test above, and kept for what it asserts
    // about intent: this planner has no way to see facts at all. An earlier
    // version compared stored days against a ratio and would have refused here.
    //
    // Facts prove metrics exist for the days they cover. They cannot prove a
    // window was *read* — a gap and a genuinely empty day are the same absence,
    // because Meta returns nothing for both. Only the run log certifies that a
    // window was requested, so only the run log is consulted.
    const harness = createHarness({ attempted: [], settledHierarchy: true });

    expect(await harness.planner.planNext(CONNECTION, NOW)).toMatchObject({
      action: 'enqueued',
      runKind: 'backfill',
    });
  });

  it('reads nothing but the run log to decide', async () => {
    const harness = createHarness({ settledHierarchy: true });

    await harness.planner.planNext(CONNECTION, NOW);

    // The planner takes two collaborators, and neither can answer a question
    // about `social_ad_metrics_daily`. That is the guarantee, expressed as the
    // shape of the service rather than as a mock nobody called.
    expect(SocialAdBackfillPlannerService.length).toBe(2);
    expect(harness.runService.listBackfillChunkOutcomes).toHaveBeenCalledWith(
      CONNECTION.connectionId,
    );
  });

  it('stops for good once every chunk has succeeded', async () => {
    const harness = createHarness({ attempted: FULL_PLAN_ENDS });

    expect(await harness.planner.planNext(CONNECTION, NOW)).toEqual({
      action: 'skipped',
      reason: 'complete',
    });
    expect(harness.enqueued).toHaveLength(0);
  });
});

describe('SocialAdBackfillPlannerService — continuing a chain', () => {
  it('queues the next chunk after the newest one', async () => {
    const harness = createHarness({ attempted: [ANCHOR] });

    await harness.planner.planNext(CONNECTION, NOW);

    expect(harness.enqueued[0]).toMatchObject({
      runKind: 'backfill',
      windowStart: '2026-08-12',
      windowEnd: '2026-08-18',
    });
  });

  it('never re-checks the hierarchy once a chain exists', async () => {
    const harness = createHarness({ attempted: [ANCHOR] });

    await harness.planner.planNext(CONNECTION, NOW);

    // A start condition only: the tree is swept once for the whole backfill,
    // not once per chunk.
    expect(harness.runService.hasSettledRun).not.toHaveBeenCalled();
  });

  it('keeps the anchor fixed as days pass', async () => {
    const harness = createHarness({ attempted: [ANCHOR] });

    // Four days later. A plan re-derived from the current date would slide
    // every remaining boundary and leave days that belong to no chunk.
    await harness.planner.planNext(
      CONNECTION,
      new Date('2026-08-30T18:00:00Z'),
    );

    expect(harness.enqueued[0]).toMatchObject({ windowEnd: '2026-08-18' });
  });

  it('walks the whole plan to its last, shorter chunk', async () => {
    const attempted = [...FULL_PLAN_ENDS];
    const last = attempted.pop() as string;

    const harness = createHarness({ attempted });

    await harness.planner.planNext(CONNECTION, NOW);

    expect(harness.enqueued[0]).toMatchObject({
      windowStart: '2026-05-28',
      windowEnd: last,
    });
  });

  it('stalls on a dead-lettered chunk rather than stepping over it', async () => {
    const harness = createHarness({
      attempted: [ANCHOR, { until: shift(ANCHOR, -7), status: 'dead_letter' }],
    });

    // The alternative — skip it, keep going — finishes the plan and reports a
    // complete backfill with a silent hole in week two. A stall is visible; a
    // hole is not, and only one of the two can be found later.
    expect(await harness.planner.planNext(CONNECTION, NOW)).toEqual({
      action: 'skipped',
      reason: 'chain_stalled',
    });
    expect(harness.enqueued).toHaveLength(0);
  });

  it('stalls on a partial chunk, which fetched only one of its levels', async () => {
    const harness = createHarness({
      attempted: [ANCHOR, { until: shift(ANCHOR, -7), status: 'partial' }],
    });

    expect(await harness.planner.planNext(CONNECTION, NOW)).toEqual({
      action: 'skipped',
      reason: 'chain_stalled',
    });
  });

  it('stalls on a failed chunk and on a cancelled one', async () => {
    for (const status of ['failed', 'cancelled'] as const) {
      const harness = createHarness({
        attempted: [ANCHOR, { until: shift(ANCHOR, -7), status }],
      });

      expect(await harness.planner.planNext(CONNECTION, NOW)).toEqual({
        action: 'skipped',
        reason: 'chain_stalled',
      });
    }
  });

  it('resumes the moment the stalled window is re-run successfully', async () => {
    // What an operator does about a stall: sync that window by hand. The run
    // settles `succeeded` under the same window end, and the chain moves on
    // without anything being reset.
    const harness = createHarness({
      attempted: [ANCHOR, shift(ANCHOR, -7)],
    });

    await harness.planner.planNext(CONNECTION, NOW);

    expect(harness.enqueued[0]).toMatchObject({
      windowEnd: shift(ANCHOR, -14),
    });
  });

  it('does not re-enqueue a window that already has a settled run', async () => {
    // The in-flight index cannot stop this one: that run has settled. Without
    // the stall the planner would produce a fresh attempt every hour for a
    // window that already exhausted its retries.
    const harness = createHarness({
      attempted: [{ until: ANCHOR, status: 'dead_letter' }],
    });

    await harness.planner.planNext(CONNECTION, NOW);

    expect(harness.enqueued).toHaveLength(0);
  });

  it('fills a hole left in the middle of a plan', async () => {
    const attempted = FULL_PLAN_ENDS.filter((day) => day !== FULL_PLAN_ENDS[5]);

    const harness = createHarness({ attempted });

    await harness.planner.planNext(CONNECTION, NOW);

    expect(harness.enqueued[0]).toMatchObject({ windowEnd: FULL_PLAN_ENDS[5] });
  });
});

describe('SocialAdBackfillPlannerService — the whole chain, chunk by chunk', () => {
  it('produces exactly thirteen chunks and then stops', async () => {
    const walked = await walkAsync();

    expect(walked.windows).toHaveLength(13);
    expect(walked.reason).toBe('complete');
  });

  it('covers ninety days with no gap and no overlap', async () => {
    const { windows } = await walkAsync();

    const days = windows.flatMap(({ since, until }) => {
      const out: string[] = [];

      for (let day = since; day <= until; day = shift(day, 1)) out.push(day);

      return out;
    });

    expect(days).toHaveLength(90);
    expect(new Set(days).size).toBe(90);
    // Contiguous from D-90 to D-1 inclusive, in the account's own calendar.
    expect(days.slice().sort()[0]).toBe('2026-05-28');
    expect(days.slice().sort().at(-1)).toBe(ANCHOR);
  });

  it('keeps the same boundaries when the process restarts days later', async () => {
    const { windows } = await walkAsync();

    // Replay the same chain from every point it could have been interrupted,
    // each time as a fresh planner running nineteen days later than the one
    // that started it. A plan re-derived from the current date would slide
    // every remaining boundary by a day per day the chain took; these are the
    // boundaries the first pass produced, and they must not move.
    for (let done = 1; done < windows.length; done += 1) {
      const harness = createHarness({
        attempted: windows.slice(0, done).map((window) => window.until),
        settledHierarchy: true,
      });

      await harness.planner.planNext(
        CONNECTION,
        new Date('2026-09-14T18:00:00Z'),
      );

      expect(harness.enqueued[0]).toMatchObject({
        windowStart: windows[done].since,
        windowEnd: windows[done].until,
      });
    }
  });

  it('does not create the next chunk while the current one is retrying', async () => {
    const harness = createHarness({
      attempted: [ANCHOR],
      inFlight: true,
      settledHierarchy: true,
    });

    // A retry is the same run, still queued. `hasInFlightRun` is what makes a
    // retry invisible to the chain rather than a second piece of work.
    expect(await harness.planner.planNext(CONNECTION, NOW)).toEqual({
      action: 'skipped',
      reason: 'chain_busy',
    });
    expect(harness.enqueued).toHaveLength(0);
  });

  it('never runs two chains beside each other', async () => {
    // Every entry point — connect, tick, run settling — goes through the same
    // in-flight gate, so concurrent callers produce at most the one piece of
    // work the chain is already owed.
    const harness = createHarness({ attempted: [ANCHOR], inFlight: true });

    await Promise.all([
      harness.planner.planNext(CONNECTION, NOW),
      harness.planner.planForConnectedAccount({
        id: CONNECTION.connectionId,
        tenantId: CONNECTION.tenantId,
        workspaceId: CONNECTION.workspaceId,
        agencyClientId: null,
        provider: 'meta_ads',
        connectionStatus: 'connected',
        externalAccountId: 'act_415877197389621',
        timezone: CONNECTION.timezone,
      }),
    ]);

    expect(harness.enqueued).toHaveLength(0);
  });

  /**
   * Drives the chain the way the runtime does: plan, mark the chunk succeeded,
   * plan again, with a freshly constructed planner every step. The planner
   * holding no state between calls is the point — a restart mid-backfill is a
   * new process reading the same run log, and it must reach the same plan.
   */
  async function walkAsync(now: Date = NOW) {
    const succeeded: string[] = [];
    const windows: { since: string; until: string }[] = [];

    for (let step = 0; step < 40; step += 1) {
      const harness = createHarness({
        attempted: [...succeeded],
        settledHierarchy: true,
      });

      const decision = await harness.planner.planNext(CONNECTION, now);

      if (decision.action === 'skipped') {
        return { windows, reason: decision.reason };
      }

      const enqueued = harness.enqueued[0] as {
        windowStart: string;
        windowEnd: string;
      };

      windows.push({ since: enqueued.windowStart, until: enqueued.windowEnd });
      succeeded.push(enqueued.windowEnd);
    }

    throw new Error('chain did not terminate');
  }
});

describe('SocialAdBackfillPlannerService — reconnecting', () => {
  const connected = {
    id: CONNECTION.connectionId,
    tenantId: CONNECTION.tenantId,
    workspaceId: CONNECTION.workspaceId,
    agencyClientId: null,
    provider: 'meta_ads',
    connectionStatus: 'connected',
    externalAccountId: 'act_415877197389621',
    timezone: CONNECTION.timezone,
  };

  it('does not start a second chain after a complete backfill', async () => {
    const harness = createHarness({ attempted: FULL_PLAN_ENDS });

    await harness.planner.planForConnectedAccount(connected);

    expect(harness.enqueued).toHaveLength(0);
  });

  it('continues an incomplete chain rather than duplicating it', async () => {
    const harness = createHarness({
      attempted: [ANCHOR, shift(ANCHOR, -7)],
      settledHierarchy: true,
    });

    await harness.planner.planForConnectedAccount(connected);

    // The next chunk of the *existing* plan, anchored where it always was.
    expect(harness.enqueued).toHaveLength(1);
    expect(harness.enqueued[0]).toMatchObject({
      windowEnd: shift(ANCHOR, -14),
    });
  });

  it('does not restart a chain that is stalled on a failed week', async () => {
    const harness = createHarness({
      attempted: [{ until: ANCHOR, status: 'dead_letter' }],
    });

    await harness.planner.planForConnectedAccount(connected);

    expect(harness.enqueued).toHaveLength(0);
  });
});

describe('SocialAdBackfillPlannerService — connecting an account', () => {
  const row = {
    id: CONNECTION.connectionId,
    tenantId: CONNECTION.tenantId,
    workspaceId: CONNECTION.workspaceId,
    agencyClientId: null,
    provider: 'meta_ads',
    connectionStatus: 'connected',
    externalAccountId: 'act_415877197389621',
    timezone: 'America/Sao_Paulo',
  };

  it('plans as soon as an account is actually bound', async () => {
    const harness = createHarness({ settledHierarchy: true });

    await harness.planner.planForConnectedAccount(row);

    expect(harness.enqueued).toHaveLength(1);
  });

  it.each([
    ['no account bound yet', { externalAccountId: null }],
    ['no timezone yet', { timezone: null }],
    ['still authorizing', { connectionStatus: 'pending' }],
  ])('does nothing for a connection that is %s', async (_case, overrides) => {
    const harness = createHarness();

    await harness.planner.planForConnectedAccount({ ...row, ...overrides });

    // These are the states an OAuth callback leaves behind, several steps
    // before an account exists. There is no window to compute and no account
    // to read, and the hourly tick finds the connection when it is ready.
    expect(harness.enqueued).toHaveLength(0);
  });

  it('never lets a planning failure reach the person who just connected', async () => {
    const harness = createHarness({ settledHierarchy: true });

    harness.runService.enqueue.mockRejectedValueOnce(
      new Error('queue unavailable'),
    );

    await expect(
      harness.planner.planForConnectedAccount(row),
    ).resolves.toBeUndefined();
  });
});

describe('resolveChunkState', () => {
  const attempt = (status: string) =>
    ({ until: ANCHOR, status }) as SocialAdBackfillChunkOutcome;

  it('reads an untouched window as not started', () => {
    expect(resolveChunkState([])).toBe('not_started');
  });

  it('reads a succeeded run as covered', () => {
    expect(resolveChunkState([attempt('succeeded')])).toBe('covered');
  });

  it.each(['queued', 'processing'])('reads a %s run as in flight', (status) => {
    expect(resolveChunkState([attempt(status)])).toBe('in_flight');
  });

  it.each(['partial', 'failed', 'dead_letter', 'cancelled'])(
    'reads a settled %s run as stalled',
    (status) => {
      expect(resolveChunkState([attempt(status)])).toBe('stalled');
    },
  );

  it('lets a later success outrank an earlier failure', () => {
    // The whole point of resuming. An old dead_letter must not keep a window
    // stalled after a retry has read it.
    expect(
      resolveChunkState([attempt('dead_letter'), attempt('succeeded')]),
    ).toBe('covered');
  });

  it('counts a success whatever order the rows arrive in', () => {
    expect(
      resolveChunkState([attempt('succeeded'), attempt('dead_letter')]),
    ).toBe('covered');
  });

  it('reads a resumed window as in flight, not as the failure it retries', () => {
    expect(resolveChunkState([attempt('dead_letter'), attempt('queued')])).toBe(
      'in_flight',
    );
  });

  it('stays stalled while every attempt has settled short', () => {
    expect(resolveChunkState([attempt('failed'), attempt('dead_letter')])).toBe(
      'stalled',
    );
  });
});

describe('SocialAdBackfillPlannerService — repeated attempts at one window', () => {
  it('moves on once a retried window has a succeeded run', async () => {
    const harness = createHarness({
      attempted: [
        ANCHOR,
        { until: shift(ANCHOR, -7), status: 'dead_letter' },
        { until: shift(ANCHOR, -7), status: 'succeeded' },
      ],
    });

    expect(await harness.planner.planNext(CONNECTION, NOW)).toMatchObject({
      action: 'enqueued',
    });
    expect(harness.enqueued[0]).toMatchObject({
      windowEnd: shift(ANCHOR, -14),
    });
  });

  it('waits while a resumed window is queued again', async () => {
    const harness = createHarness({
      attempted: [
        ANCHOR,
        { until: shift(ANCHOR, -7), status: 'dead_letter' },
        { until: shift(ANCHOR, -7), status: 'queued' },
      ],
    });

    expect(await harness.planner.planNext(CONNECTION, NOW)).toEqual({
      action: 'skipped',
      reason: 'chain_stalled',
    });
    expect(harness.enqueued).toHaveLength(0);
  });

  it('keeps the anchor where it was after a window is retried', async () => {
    const harness = createHarness({
      attempted: [
        { until: ANCHOR, status: 'dead_letter' },
        { until: ANCHOR, status: 'succeeded' },
      ],
      settledHierarchy: true,
    });

    // A second run of the anchor window must not become a second anchor. The
    // query orders by `window_end` first, so both rows sit at the top and the
    // date is the same either way — this pins that the plan below it does not
    // move.
    await harness.planner.planNext(CONNECTION, NOW);

    expect(harness.enqueued[0]).toMatchObject({
      windowStart: '2026-08-12',
      windowEnd: shift(ANCHOR, -7),
    });
  });
});

describe('advancesBackfillChain', () => {
  it('covers the two kinds the chain is made of', () => {
    expect(advancesBackfillChain('backfill')).toBe(true);
    expect(advancesBackfillChain('entities')).toBe(true);
  });

  it('ignores the cadences that have nothing to hand over', () => {
    expect(advancesBackfillChain('daily')).toBe(false);
    expect(advancesBackfillChain('intraday')).toBe(false);
    expect(advancesBackfillChain('manual')).toBe(false);
  });
});

function shift(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number);

  return new Date(Date.UTC(year, month - 1, date + days))
    .toISOString()
    .slice(0, 10);
}
