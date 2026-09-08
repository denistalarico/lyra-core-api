/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-assignment -- scheduler doubles use Jest asymmetric matchers. */
import type { SocialOrganicCredentialResolver } from '../credentials/social-organic-credential.resolver';
import type { ResolvedOrganicAnalyticsCredential } from '../credentials/social-organic-credential.resolver';
import type { SocialOrganicSyncRunService } from './social-organic-sync-run.service';
import {
  SOCIAL_ORGANIC_SYNC_ASSET_BATCH,
  SocialOrganicSyncScheduler,
} from './social-organic-sync.scheduler';

function resolved(
  assetId: string,
  assetTimezone: string,
): ResolvedOrganicAnalyticsCredential {
  return {
    assetTimezone,
    credential: {
      assetId,
      connectionId: `connection-${assetId}`,
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      agencyClientId: 'client-1',
      provider: 'meta',
      assetType: 'facebook_page',
      externalAssetId: `external-${assetId}`,
      scopes: ['read_insights'],
      credentialVersion: 1,
      accessToken: 'secret-token',
      toJSON: () => ({ accessToken: '[REDACTED]' }),
    },
  };
}

function harness() {
  const candidates = [
    {
      assetId: 'asset-due',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      agencyClientId: 'client-1',
    },
    {
      assetId: 'asset-early',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      agencyClientId: 'client-1',
    },
  ];
  const runs = {
    listSchedulableCandidates: jest.fn(async () => candidates),
    idempotencyKey: jest.fn(
      (input: { assetId: string; fromDate: string; toDate: string }) =>
        `${input.assetId}:${input.fromDate}:${input.toDate}`,
    ),
    hasSettledRun: jest.fn(async () => false),
    enqueue: jest.fn(async () => ({ run: {}, deduplicated: false })),
  };
  const credentials = {
    resolveForAnalytics: jest.fn(async ({ assetId }: { assetId: string }) =>
      resolved(
        assetId,
        assetId === 'asset-early' ? 'Pacific/Honolulu' : 'America/Sao_Paulo',
      ),
    ),
  };

  return {
    runs,
    credentials,
    scheduler: new SocialOrganicSyncScheduler(
      runs as unknown as SocialOrganicSyncRunService,
      credentials as unknown as SocialOrganicCredentialResolver,
    ),
  };
}

describe('SocialOrganicSyncScheduler', () => {
  it('enqueues one bounded two-day intent only after the asset local start hour', async () => {
    const { scheduler, runs, credentials } = harness();

    await expect(
      scheduler.enqueueDue(new Date('2026-09-08T12:00:00.000Z')),
    ).resolves.toBe(1);

    expect(runs.listSchedulableCandidates).toHaveBeenCalledWith(
      SOCIAL_ORGANIC_SYNC_ASSET_BATCH,
    );
    expect(credentials.resolveForAnalytics).toHaveBeenCalledTimes(2);
    expect(runs.enqueue).toHaveBeenCalledTimes(1);
    expect(runs.enqueue).toHaveBeenCalledWith({
      resolved: expect.objectContaining({
        assetTimezone: 'America/Sao_Paulo',
        credential: expect.objectContaining({ assetId: 'asset-due' }),
      }),
      runKind: 'scheduled',
      fromDate: '2026-09-07',
      toDate: '2026-09-08',
    });
  });

  it('does not enqueue a settled daily intent', async () => {
    const { scheduler, runs } = harness();
    runs.hasSettledRun.mockResolvedValue(true);

    await expect(
      scheduler.enqueueDue(new Date('2026-09-08T12:00:00.000Z')),
    ).resolves.toBe(0);
    expect(runs.enqueue).not.toHaveBeenCalled();
  });
});
