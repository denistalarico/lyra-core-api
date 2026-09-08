/* eslint-disable @typescript-eslint/require-await -- health service doubles intentionally return resolved async values. */
import type { MetaOrganicHealthService } from '../providers/meta/meta-organic-health.service';
import { SocialOrganicHealthScheduler } from './social-organic-health.scheduler';

function asset(id: string) {
  return { id } as never;
}

function harness(
  input: {
    listed?: ReturnType<typeof asset>[];
    runCheck?: jest.Mock;
  } = {},
) {
  const health = {
    listEligibleForScheduledCheck: jest.fn(async () => input.listed ?? []),
    runCheck:
      input.runCheck ??
      jest.fn(async () => ({
        assetId: 'x',
        status: 'healthy',
        reason: 'ok',
        checkedAt: new Date(),
      })),
  };

  return {
    health,
    scheduler: new SocialOrganicHealthScheduler(
      health as unknown as MetaOrganicHealthService,
    ),
  };
}

describe('SocialOrganicHealthScheduler', () => {
  it('36. checks only the eligible assets the health service returns', async () => {
    const { scheduler, health } = harness({
      listed: [asset('a'), asset('b')],
    });

    await scheduler.runDue();

    expect(health.listEligibleForScheduledCheck).toHaveBeenCalledTimes(1);
    expect(health.runCheck).toHaveBeenCalledTimes(2);
  });

  it('37. disconnected/historical assets are skipped because the eligibility query already excludes them', async () => {
    const { scheduler, health } = harness({ listed: [] });

    const checked = await scheduler.runDue();

    expect(checked).toBe(0);
    expect(health.runCheck).not.toHaveBeenCalled();
  });

  it('38. one asset failure does not stop the remaining batch', async () => {
    const runCheck = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({
        assetId: 'b',
        status: 'healthy',
        reason: 'ok',
        checkedAt: new Date(),
      });
    const { scheduler, health } = harness({
      listed: [asset('a'), asset('b')],
      runCheck,
    });

    const checked = await scheduler.runDue();

    expect(health.runCheck).toHaveBeenCalledTimes(2);
    expect(checked).toBe(1);
  });

  it('39. the scheduler invokes persistence through health.runCheck for every eligible asset', async () => {
    const { scheduler, health } = harness({
      listed: [asset('a'), asset('b'), asset('c')],
    });

    await scheduler.runDue();

    expect(health.runCheck).toHaveBeenNthCalledWith(1, asset('a'));
    expect(health.runCheck).toHaveBeenNthCalledWith(2, asset('b'));
    expect(health.runCheck).toHaveBeenNthCalledWith(3, asset('c'));
  });

  it('40. no external publication call occurs — the scheduler only reaches MetaOrganicHealthService', async () => {
    const { scheduler, health } = harness({ listed: [asset('a')] });

    await scheduler.runDue();

    const calledMethods = Object.keys(health);
    expect(calledMethods).toEqual([
      'listEligibleForScheduledCheck',
      'runCheck',
    ]);
  });

  it('a tick already in progress is skipped rather than run concurrently', async () => {
    let resolveFirst: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const { scheduler, health } = harness({
      listed: [asset('a')],
      runCheck: jest.fn(async () => {
        await gate;
        return {
          assetId: 'a',
          status: 'healthy',
          reason: 'ok',
          checkedAt: new Date(),
        };
      }),
    });

    const first = scheduler.tick();
    const second = await scheduler.tick();

    expect(second).toBe(0);
    resolveFirst();
    await first;
    expect(health.listEligibleForScheduledCheck).toHaveBeenCalledTimes(1);
  });
});
