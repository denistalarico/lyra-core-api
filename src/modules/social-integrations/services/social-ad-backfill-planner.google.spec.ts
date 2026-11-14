import { SocialAdBackfillPlannerService } from './social-ad-backfill-planner.service';
import type { SocialAdSchedulableConnection } from './social-ad-connection.service';
import type { SocialAdSyncConfigService } from './social-ad-sync-config.service';
import type { SocialAdSyncRunService } from './social-ad-sync-run.service';

const CONNECTION: SocialAdSchedulableConnection = {
  connectionId: 'c1',
  tenantId: 't',
  workspaceId: 'w',
  agencyClientId: null,
  provider: 'google_ads',
  timezone: 'America/Sao_Paulo',
};

function build(googleEnabled: boolean) {
  const config = {
    enabled: true,
    googleAdsEnabled: googleEnabled,
    backfillDays: 90,
    backfillChunkDays: 7,
  } as unknown as SocialAdSyncConfigService;
  const enqueue = jest.fn(async () => ({
    deduplicated: false,
    run: { id: 'run-1' },
  }));
  const runService = {
    hasInFlightRun: jest.fn(async () => false),
    listBackfillChunkOutcomes: jest.fn(async () => []),
    hasSettledRun: jest.fn(async () => false),
    enqueue,
  } as unknown as SocialAdSyncRunService;

  return {
    planner: new SocialAdBackfillPlannerService(config, runService),
    enqueue,
  };
}

describe('SocialAdBackfillPlannerService — Google Ads (G2)', () => {
  it('does nothing while the Google switch is off', async () => {
    const { planner, enqueue } = build(false);

    expect(await planner.planNext(CONNECTION)).toEqual({
      action: 'skipped',
      reason: 'sync_disabled',
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('starts the chain with a hierarchy run when enabled', async () => {
    const { planner, enqueue } = build(true);

    await planner.planNext(CONNECTION);

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ runKind: 'entities', provider: 'google_ads' }),
    );
  });

  it('reads at most thirty days in one wide chunk', async () => {
    const { planner, enqueue } = build(true);
    // The hierarchy run is already settled, so the next piece is the chunk.
    (
      planner as unknown as { runService: { hasSettledRun: jest.Mock } }
    ).runService.hasSettledRun.mockResolvedValue(true);

    await planner.planNext(CONNECTION);

    const call = enqueue.mock.calls[0] as unknown as [
      { runKind: string; windowStart: string; windowEnd: string },
    ];
    const days =
      (Date.parse(call[0].windowEnd) - Date.parse(call[0].windowStart)) /
        86_400_000 +
      1;

    expect([call[0].runKind, days]).toEqual(['backfill', 30]);
  });
});
