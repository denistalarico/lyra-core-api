import type { SocialPublicationRunService } from './social-publication-run.service';
import { SocialPublicationScheduler } from './social-publication.scheduler';

describe('SocialPublicationScheduler', () => {
  it('releases due Lyra-owned schedules', async () => {
    const runService = {
      releaseScheduled: jest.fn(() => Promise.resolve(3)),
    };
    const scheduler = new SocialPublicationScheduler(
      runService as unknown as SocialPublicationRunService,
    );

    await expect(scheduler.tick()).resolves.toBe(3);
    expect(runService.releaseScheduled).toHaveBeenCalledTimes(1);
  });

  it('does not overlap scheduler ticks in one process', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runService = {
      releaseScheduled: jest.fn(() => pending.then(() => 1)),
    };
    const scheduler = new SocialPublicationScheduler(
      runService as unknown as SocialPublicationRunService,
    );

    const first = scheduler.tick();
    await expect(scheduler.tick()).resolves.toBe(0);
    release();
    await expect(first).resolves.toBe(1);
  });
});
