/* eslint-disable @typescript-eslint/require-await -- scheduler test doubles expose partial service shapes. */
import type {
  SocialAdConnectionService,
  SocialAdSchedulableConnection,
} from './social-ad-connection.service';
import type { SocialAdSyncConfigService } from './social-ad-sync-config.service';
import type { SocialAdSyncRunService } from './social-ad-sync-run.service';
import { SocialAdSyncScheduler } from './social-ad-sync.scheduler';

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

  const scheduler = new SocialAdSyncScheduler(
    config,
    connectionService as unknown as SocialAdConnectionService,
    runService as unknown as SocialAdSyncRunService,
  );

  return { scheduler, connectionService, runService, enqueued };
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
