import { Logger } from '@nestjs/common';
import type {
  SocialAdConnectionService,
  SocialAdSchedulableConnection,
} from './social-ad-connection.service';
import type { SocialAdReachPeriodConfigService } from './social-ad-reach-period-config.service';
import { SocialAdReachPeriodScheduler } from './social-ad-reach-period.scheduler';
import type { SocialAdReachPeriodService } from './social-ad-reach-period.service';

const SAO_PAULO: SocialAdSchedulableConnection = {
  connectionId: 'connection-sp',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  agencyClientId: null,
  provider: 'meta_ads',
  timezone: 'America/Sao_Paulo',
};

const AUCKLAND: SocialAdSchedulableConnection = {
  connectionId: 'connection-nz',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  agencyClientId: 'client-a',
  provider: 'meta_ads',
  timezone: 'Pacific/Auckland',
};

function createHarness(
  options: {
    enabled?: boolean;
    connections?: SocialAdSchedulableConnection[];
    failFor?: string;
  } = {},
) {
  const prewarmed: Record<string, unknown>[] = [];

  const config = { enabled: options.enabled ?? true };

  const connectionService = {
    listSchedulable: jest.fn(() =>
      Promise.resolve(options.connections ?? [SAO_PAULO, AUCKLAND]),
    ),
  };

  const reachPeriods = {
    prewarmConnection: jest.fn((input: Record<string, unknown>) => {
      if (options.failFor === input.connectionId) {
        return Promise.reject(new Error('boom'));
      }

      prewarmed.push(input);

      return Promise.resolve({ connectionId: input.connectionId });
    }),
  };

  return {
    scheduler: new SocialAdReachPeriodScheduler(
      config as unknown as SocialAdReachPeriodConfigService,
      connectionService as unknown as SocialAdConnectionService,
      reachPeriods as unknown as SocialAdReachPeriodService,
    ),
    connectionService,
    reachPeriods,
    prewarmed,
  };
}

describe('SocialAdReachPeriodScheduler', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('lists nothing at all when the switch is off', async () => {
    const harness = createHarness({ enabled: false });

    await harness.scheduler.tick();

    // Checked before listing, so a disabled deployment does not even read the
    // connection table for a capability nobody turned on.
    expect(harness.connectionService.listSchedulable).not.toHaveBeenCalled();
  });

  it('prewarms an account whose local morning has arrived', async () => {
    const harness = createHarness({ connections: [SAO_PAULO] });

    // 12:00 UTC is 09:00 in São Paulo — past the 05:00 local start.
    const prewarmed = await harness.scheduler.prewarmDue(
      new Date('2026-09-20T12:00:00.000Z'),
    );

    expect(prewarmed).toBe(1);
    expect(harness.prewarmed[0]).toMatchObject({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: null,
      connectionId: 'connection-sp',
    });
  });

  it('leaves an account whose local morning has not arrived', async () => {
    const harness = createHarness({ connections: [SAO_PAULO] });

    // 06:00 UTC is 03:00 in São Paulo — before the 05:00 local start, and before
    // the previous day has settled enough to be worth counting.
    const prewarmed = await harness.scheduler.prewarmDue(
      new Date('2026-09-20T06:00:00.000Z'),
    );

    expect(prewarmed).toBe(0);
    expect(harness.reachPeriods.prewarmConnection).not.toHaveBeenCalled();
  });

  it('answers each account in its own zone from one tick', async () => {
    const harness = createHarness();

    // 20:00 UTC is 17:00 in São Paulo and 08:00 the next day in Auckland: both
    // are past their own 05:00, thirteen hours apart, from the same instant.
    await harness.scheduler.prewarmDue(new Date('2026-09-20T20:00:00.000Z'));

    expect(harness.prewarmed.map((one) => one.connectionId)).toEqual([
      'connection-sp',
      'connection-nz',
    ]);
  });

  it('carries the managed client of each connection', async () => {
    const harness = createHarness({ connections: [AUCKLAND] });

    await harness.scheduler.prewarmDue(new Date('2026-09-20T20:00:00.000Z'));

    // The scope a measurement is stored under comes from the connection row, not
    // from a default: a client's measurement must not land in agency scope.
    expect(harness.prewarmed[0]).toMatchObject({ agencyClientId: 'client-a' });
  });

  it('does not let one connection failure stop the rest', async () => {
    const harness = createHarness({ failFor: 'connection-sp' });

    const prewarmed = await harness.scheduler.prewarmDue(
      new Date('2026-09-20T20:00:00.000Z'),
    );

    // An expired credential on one account must not cost every other account its
    // measurement — and the number this produces is one a dashboard can live
    // without, so it never becomes an unhandled rejection either.
    expect(prewarmed).toBe(1);
    expect(harness.prewarmed.map((one) => one.connectionId)).toEqual([
      'connection-nz',
    ]);
  });

  it('swallows a listing failure rather than taking the process down', async () => {
    const harness = createHarness();

    harness.connectionService.listSchedulable.mockRejectedValueOnce(
      new Error('database is away'),
    );

    await expect(harness.scheduler.tick()).resolves.toBeUndefined();
  });
});
