/* eslint-disable @typescript-eslint/require-await -- scheduler test doubles expose partial service shapes. */
import type {
  SocialAdBackfillDecision,
  SocialAdBackfillPlannerService,
} from './social-ad-backfill-planner.service';
import type {
  SocialAdConnectionService,
  SocialAdSchedulableConnection,
} from './social-ad-connection.service';
import type { SocialAdSyncConfigService } from './social-ad-sync-config.service';
import type { SocialAdSyncRunService } from './social-ad-sync-run.service';
import {
  SocialAdSyncScheduler,
  intradayBucket,
} from './social-ad-sync.scheduler';

const SAO_PAULO: SocialAdSchedulableConnection = {
  connectionId: 'connection-sp',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  agencyClientId: null,
  provider: 'meta_ads',
  timezone: 'America/Sao_Paulo',
};

const AUCKLAND: SocialAdSchedulableConnection = {
  ...SAO_PAULO,
  connectionId: 'connection-nz',
  timezone: 'Pacific/Auckland',
};

function createHarness(
  options: {
    enabled?: boolean;
    lookbackDays?: number;
    connections?: SocialAdSchedulableConnection[];
    settled?: boolean;
    enqueueError?: Error;
    intradayIntervalHours?: number;
  } = {},
) {
  const enqueued: Record<string, unknown>[] = [];

  const config = {
    get enabled() {
      return options.enabled ?? true;
    },
    get dailyLookbackDays() {
      return options.lookbackDays ?? 7;
    },
    /**
     * Off unless a test turns it on.
     *
     * Not the production default, and deliberately not: every test in this file
     * that counts enqueues would otherwise be counting two cadences, and a
     * change to either one would break assertions about the other. The intraday
     * tests below opt in, which is also what makes them read as being about
     * intraday.
     */
    get intradayIntervalHours() {
      return options.intradayIntervalHours ?? 0;
    },
  } as SocialAdSyncConfigService;

  const connectionService = {
    listSchedulable: jest.fn(async () => options.connections ?? [SAO_PAULO]),
  };

  const runService = {
    hasSettledRun: jest.fn(async () => options.settled ?? false),
    enqueue: jest.fn(async (input: Record<string, unknown>) => {
      enqueued.push(input);

      if (options.enqueueError) throw options.enqueueError;

      return { run: { id: 'run-a' }, deduplicated: false };
    }),
  };

  const backfillPlanner = {
    planNext: jest.fn(
      async (): Promise<SocialAdBackfillDecision> => ({
        action: 'skipped',
        reason: 'complete',
      }),
    ),
  };

  const scheduler = new SocialAdSyncScheduler(
    config,
    connectionService as unknown as SocialAdConnectionService,
    runService as unknown as SocialAdSyncRunService,
    backfillPlanner as unknown as SocialAdBackfillPlannerService,
  );

  return {
    scheduler,
    connectionService,
    runService,
    enqueued,
    backfillPlanner,
  };
}

/** 09:00 in São Paulo, 00:00 the next day in Auckland. */
const MORNING_IN_SAO_PAULO = new Date('2026-08-26T12:00:00.000Z');

describe('SocialAdSyncScheduler', () => {
  it('queues the previous seven settled days once the local morning arrives', async () => {
    const harness = createHarness();

    expect(await harness.scheduler.enqueueDue(MORNING_IN_SAO_PAULO)).toBe(1);

    expect(harness.enqueued[0]).toMatchObject({
      connectionId: 'connection-sp',
      runKind: 'daily',
      // Inclusive on both ends: D-7 through D-1, ending at the last day the
      // account has finished.
      windowStart: '2026-08-19',
      windowEnd: '2026-08-25',
      requestedById: null,
    });
  });

  it('waits for the account own morning, not the server one', async () => {
    const harness = createHarness();

    // 02:00 in São Paulo. Meta is still attributing conversions to the day that
    // just closed, so a read now would store numbers that are wrong by
    // breakfast.
    expect(
      await harness.scheduler.enqueueDue(new Date('2026-08-26T05:00:00.000Z')),
    ).toBe(0);
    expect(harness.runService.enqueue).not.toHaveBeenCalled();
  });

  it('reads each account own day from the same tick', async () => {
    const harness = createHarness({ connections: [SAO_PAULO, AUCKLAND] });

    // One instant: 09:00 on the 26th in São Paulo, 00:00 on the 27th in
    // Auckland. Auckland's morning has not arrived, and its "yesterday" is a
    // different date from São Paulo's.
    await harness.scheduler.enqueueDue(MORNING_IN_SAO_PAULO);

    expect(harness.enqueued).toHaveLength(1);
    expect(harness.enqueued[0]).toMatchObject({
      connectionId: 'connection-sp',
    });

    const later = createHarness({ connections: [AUCKLAND] });

    // 06:00 in Auckland on the 27th: its last settled day is the 26th, which
    // in São Paulo is still today.
    await later.scheduler.enqueueDue(new Date('2026-08-26T18:00:00.000Z'));

    expect(later.enqueued[0]).toMatchObject({ windowEnd: '2026-08-26' });
  });

  it('does not queue the same morning twice', async () => {
    const harness = createHarness({ settled: true });

    await harness.scheduler.enqueueDue(MORNING_IN_SAO_PAULO);

    // Once today's run has settled the hourly tick has nothing to do, and it
    // will have nothing to do for the rest of the day: the window is part of
    // the key.
    expect(harness.runService.enqueue).not.toHaveBeenCalled();
  });

  it('asks about today window, so tomorrow gets a fresh attempt', async () => {
    const harness = createHarness({ settled: true });

    await harness.scheduler.enqueueDue(MORNING_IN_SAO_PAULO);

    const [, key] = harness.runService.hasSettledRun.mock
      .calls[0] as unknown as [string, string];

    expect(key).toContain(':daily:2026-08-19:2026-08-25:');
  });

  it('counts a failed run as attempted rather than retrying every hour', async () => {
    // `hasSettledRun` includes `failed` and `dead_letter` on purpose: a daily
    // run that died at 04:00 must not be re-queued at 05:00 and every hour
    // after, which is how one broken connection becomes twenty runs a day.
    const harness = createHarness({ settled: true });

    await harness.scheduler.enqueueDue(MORNING_IN_SAO_PAULO);
    await harness.scheduler.enqueueDue(new Date('2026-08-26T13:00:00.000Z'));

    expect(harness.runService.enqueue).not.toHaveBeenCalled();
  });

  it('catches up on a tick that was missed', async () => {
    const harness = createHarness();

    // The process was down at 04:00. Nothing depends on firing at a particular
    // minute — the 09:00 tick asks the same unanswered question.
    expect(await harness.scheduler.enqueueDue(MORNING_IN_SAO_PAULO)).toBe(1);
  });

  it('honours a configured lookback', async () => {
    const harness = createHarness({ lookbackDays: 1 });

    await harness.scheduler.enqueueDue(MORNING_IN_SAO_PAULO);

    expect(harness.enqueued[0]).toMatchObject({
      windowStart: '2026-08-25',
      windowEnd: '2026-08-25',
    });
  });

  it('queues nothing while the runtime is off', async () => {
    const harness = createHarness({ enabled: false });

    await harness.scheduler.tick();

    // Queueing into a stopped worker builds a backlog that executes all at once
    // the moment it is switched back on.
    expect(harness.connectionService.listSchedulable).not.toHaveBeenCalled();
  });

  it('lets one bad connection fail without stopping the others', async () => {
    const harness = createHarness({
      connections: [
        {
          ...SAO_PAULO,
          connectionId: 'connection-bad',
          timezone: 'Mars/Olympus',
        },
        SAO_PAULO,
      ],
    });

    expect(await harness.scheduler.enqueueDue(MORNING_IN_SAO_PAULO)).toBe(1);
    expect(harness.enqueued[0]).toMatchObject({
      connectionId: 'connection-sp',
    });
  });

  it('survives a tick that throws instead of ending the cron', async () => {
    const harness = createHarness();
    harness.connectionService.listSchedulable.mockRejectedValueOnce(
      new Error('connection terminated'),
    );

    await expect(harness.scheduler.tick()).resolves.toBeUndefined();
  });
});

describe('intradayBucket', () => {
  it('gives every three-hour period of the day its own label', () => {
    expect(intradayBucket(9, 3)).toBe('h09');
    expect(intradayBucket(10, 3)).toBe('h09');
    expect(intradayBucket(11, 3)).toBe('h09');
    // The hour that starts the next bucket is where a new snapshot is allowed.
    expect(intradayBucket(12, 3)).toBe('h12');
  });

  it('sorts the way the day runs', () => {
    // Zero-padded, so `h09` precedes `h12` as text. The label travels into an
    // idempotency key that people read in logs.
    expect(intradayBucket(6, 3) < intradayBucket(21, 3)).toBe(true);
  });

  it('follows the interval it is given', () => {
    expect(intradayBucket(7, 6)).toBe('h06');
    expect(intradayBucket(13, 6)).toBe('h12');
    expect(intradayBucket(13, 1)).toBe('h13');
  });
});

describe('SocialAdSyncScheduler — intraday', () => {
  /** 09:00 in São Paulo on the 26th. */
  const NINE_IN_SAO_PAULO = new Date('2026-08-26T12:00:00.000Z');

  function intradayHarness(options: Parameters<typeof createHarness>[0] = {}) {
    return createHarness({ intradayIntervalHours: 3, ...options });
  }

  /** Only the intraday rows, since a tick also queues the daily one. */
  const intradayOf = (harness: ReturnType<typeof createHarness>) =>
    harness.enqueued.filter((run) => run.runKind === 'intraday');

  it('queues the account own unfinished day, once per bucket', async () => {
    const harness = intradayHarness();

    await harness.scheduler.enqueueDue(NINE_IN_SAO_PAULO);

    expect(intradayOf(harness)).toEqual([
      expect.objectContaining({
        connectionId: 'connection-sp',
        runKind: 'intraday',
        // One day, both ends. A range containing today would drag settled days
        // into a partial write.
        windowStart: '2026-08-26',
        windowEnd: '2026-08-26',
        entityLevels: ['account', 'campaign'],
        bucket: 'h09',
        requestedById: null,
      }),
    ]);
  });

  it('queues the daily run before the intraday one', async () => {
    const harness = intradayHarness();

    await harness.scheduler.enqueueDue(NINE_IN_SAO_PAULO);

    // Not a priority column — the claim query takes the oldest due run first,
    // so the order rows are created in is the order they are executed in.
    // Yesterday's final numbers come before today's provisional ones.
    expect(harness.enqueued.map((run) => run.runKind)).toEqual([
      'daily',
      'intraday',
    ]);
  });

  it('does not read a day that has barely started', async () => {
    const harness = intradayHarness();

    // 05:00 in São Paulo: the account's day is five hours old, most accounts
    // have delivered nothing, and the pass would be replaced three hours later.
    await harness.scheduler.enqueueDue(new Date('2026-08-26T08:00:00.000Z'));

    expect(intradayOf(harness)).toHaveLength(0);
  });

  it('takes its first snapshot at six', async () => {
    const harness = intradayHarness();

    await harness.scheduler.enqueueDue(new Date('2026-08-26T09:00:00.000Z'));

    expect(intradayOf(harness)[0]).toMatchObject({ bucket: 'h06' });
  });

  it('asks the same question all through a bucket and enqueues once', async () => {
    // The tick is hourly and the bucket is three hours wide, so the second and
    // third hours find a run that has already settled. This is also what makes
    // a missed tick harmless: the next hour is still inside the bucket.
    const harness = intradayHarness({ settled: true });

    await harness.scheduler.enqueueDue(new Date('2026-08-26T13:00:00.000Z'));

    expect(intradayOf(harness)).toHaveLength(0);
  });

  it('keys each bucket separately, so the next one is allowed', async () => {
    const nine = intradayHarness();
    await nine.scheduler.enqueueDue(NINE_IN_SAO_PAULO);

    const noon = intradayHarness();
    await noon.scheduler.enqueueDue(new Date('2026-08-26T15:00:00.000Z'));

    // Every pass of one day asks for the same window, so without the bucket the
    // second would be deduplicated against the first and an account would get
    // one intraday reading a day.
    const [, nineKey] = nine.runService.hasSettledRun.mock.calls.at(
      -1,
    ) as unknown as [string, string];
    const [, noonKey] = noon.runService.hasSettledRun.mock.calls.at(
      -1,
    ) as unknown as [string, string];

    expect(nineKey).not.toBe(noonKey);
    expect(intradayOf(nine)[0]).toMatchObject({ bucket: 'h09' });
    expect(intradayOf(noon)[0]).toMatchObject({ bucket: 'h12' });
  });

  it('gives each account its own day and its own bucket from one tick', async () => {
    const harness = intradayHarness({ connections: [SAO_PAULO, AUCKLAND] });

    // 21:00 in São Paulo on the 26th is 12:00 in Auckland on the 27th.
    await harness.scheduler.enqueueDue(new Date('2026-08-27T00:00:00.000Z'));

    expect(intradayOf(harness)).toEqual([
      expect.objectContaining({
        connectionId: 'connection-sp',
        windowStart: '2026-08-26',
        bucket: 'h21',
      }),
      expect.objectContaining({
        connectionId: 'connection-nz',
        windowStart: '2026-08-27',
        bucket: 'h12',
      }),
    ]);
  });

  it('does nothing at all when intraday is switched off', async () => {
    const harness = createHarness({ intradayIntervalHours: 0 });

    await harness.scheduler.enqueueDue(NINE_IN_SAO_PAULO);

    // The table then has no rows for today, which is what it had before
    // intraday existed. The daily run still closes the day tomorrow.
    expect(intradayOf(harness)).toHaveLength(0);
    expect(harness.enqueued.map((run) => run.runKind)).toEqual(['daily']);
  });

  it('queues nothing while the runtime is off', async () => {
    const harness = intradayHarness({ enabled: false });

    await harness.scheduler.tick();

    expect(harness.enqueued).toHaveLength(0);
  });
});

describe('SocialAdSyncScheduler — backfill', () => {
  it('asks the planner about every schedulable connection', async () => {
    const harness = createHarness({ connections: [SAO_PAULO, AUCKLAND] });

    await harness.scheduler.enqueueDue(MORNING_IN_SAO_PAULO);

    // The recovery path for a chain that lost its hand-off, and the only path
    // that starts one for a connection made while the runtime was off.
    expect(harness.backfillPlanner.planNext).toHaveBeenCalledTimes(2);
  });

  it('counts a chunk it queued', async () => {
    const harness = createHarness();
    harness.backfillPlanner.planNext.mockResolvedValueOnce({
      action: 'enqueued',
      runKind: 'backfill',
      runId: 'run-b',
    });

    expect(await harness.scheduler.enqueueDue(MORNING_IN_SAO_PAULO)).toBe(2);
  });

  it('does not let one connection planning failure stop the tick', async () => {
    const harness = createHarness({ connections: [SAO_PAULO, AUCKLAND] });
    harness.backfillPlanner.planNext.mockRejectedValueOnce(
      new Error('queue unavailable'),
    );

    await expect(
      harness.scheduler.enqueueDue(MORNING_IN_SAO_PAULO),
    ).resolves.toBeGreaterThanOrEqual(0);
    expect(harness.backfillPlanner.planNext).toHaveBeenCalledTimes(2);
  });

  it('never reaches the planner while the runtime is off', async () => {
    const harness = createHarness({ enabled: false });

    await harness.scheduler.tick();

    expect(harness.backfillPlanner.planNext).not.toHaveBeenCalled();
  });
});
