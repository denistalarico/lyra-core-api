/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access -- repository/data-source doubles and Jest call inspection intentionally cross TypeORM's dynamic query boundary. */
import type { DataSource, EntityManager, Repository } from 'typeorm';
import type { SocialOrganicCredentialResolver } from '../credentials/social-organic-credential.resolver';
import type { SocialOrganicAssetEntity } from '../entities/social-organic-asset.entity';
import type { SocialOrganicSyncRunEntity } from './entities/social-organic-sync-run.entity';
import { SocialOrganicSyncRunService } from './social-organic-sync-run.service';

const credential = {
  assetId: 'asset-1',
  connectionId: 'connection-1',
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  agencyClientId: null,
  provider: 'meta',
  assetType: 'facebook_page',
  externalAssetId: 'page-1',
  scopes: ['read_insights'],
  credentialVersion: 1,
  accessToken: 'secret-token',
  toJSON: () => ({ accessToken: '[REDACTED]' }),
};

const FIXED_AVAILABLE_AT = new Date('2026-09-08T15:00:00.000Z');

function runRow(overrides: Partial<SocialOrganicSyncRunEntity> = {}) {
  return {
    id: 'run-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    agencyClientId: null,
    assetId: 'asset-1',
    provider: 'meta',
    runKind: 'manual',
    status: 'queued',
    windowStart: '2026-09-08',
    windowEnd: '2026-09-08',
    idempotencyKey: 'key',
    attempts: 0,
    maxAttempts: 5,
    availableAt: FIXED_AVAILABLE_AT,
    lockedAt: null,
    lockedBy: null,
    startedAt: null,
    finishedAt: null,
    lastError: null,
    ...overrides,
  } as SocialOrganicSyncRunEntity;
}

function harness() {
  const runs = {
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => ({ ...runRow(), ...value })),
    findOne: jest.fn(),
    find: jest.fn(async () => [runRow({ status: 'processing' })]),
    count: jest.fn(async () => 0),
  };
  const assets = {
    find: jest.fn(async (): Promise<SocialOrganicAssetEntity[]> => []),
  };
  const manager = { query: jest.fn() };
  const dataSource = {
    transaction: jest.fn(async (work: (value: EntityManager) => unknown) =>
      work(manager as unknown as EntityManager),
    ),
    query: jest.fn(),
  };
  const resolver = {
    resolveForAnalytics: jest.fn(async () => ({
      credential,
      assetTimezone: 'America/Sao_Paulo',
    })),
  };

  return {
    runs,
    assets,
    manager,
    dataSource,
    resolver,
    service: new SocialOrganicSyncRunService(
      runs as unknown as Repository<SocialOrganicSyncRunEntity>,
      assets as unknown as Repository<SocialOrganicAssetEntity>,
      dataSource as unknown as DataSource,
      resolver as unknown as SocialOrganicCredentialResolver,
    ),
  };
}

describe('SocialOrganicSyncRunService', () => {
  it('enqueues an on-demand run from trusted scope and returns only safe fields', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-08T15:00:00.000Z'));
    const { service, resolver, runs } = harness();

    await expect(
      service.request({
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        agencyClientId: null,
        assetId: 'asset-1',
      }),
    ).resolves.toEqual({
      runId: 'run-1',
      status: 'queued',
      startedAt: null,
      completedAt: null,
      safeReason: null,
      deduplicated: false,
    });

    expect(resolver.resolveForAnalytics).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      agencyClientId: null,
      assetId: 'asset-1',
    });
    expect(runs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        agencyClientId: null,
        assetId: 'asset-1',
        windowStart: '2026-09-08',
        windowEnd: '2026-09-08',
      }),
    );
    jest.useRealTimers();
  });

  it('bounds and scopes the internal scheduler candidate query', async () => {
    const { service, assets } = harness();
    assets.find.mockResolvedValueOnce([
      {
        id: 'asset-1',
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        agencyClientId: null,
      } as SocialOrganicAssetEntity,
    ]);

    await expect(service.listSchedulableCandidates(20)).resolves.toEqual([
      {
        assetId: 'asset-1',
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        agencyClientId: null,
      },
    ]);
    expect(assets.find).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 20,
        where: expect.objectContaining({
          provider: 'meta',
          status: 'active',
          connection: expect.objectContaining({
            provider: 'meta',
            connectionStatus: 'connected',
          }),
        }),
      }),
    );
  });

  it('claims with FOR UPDATE SKIP LOCKED and records the worker lease', async () => {
    const { service, manager, runs } = harness();
    manager.query
      .mockResolvedValueOnce([{ id: 'run-1' }])
      .mockResolvedValueOnce([{ id: 'run-1' }]);

    await expect(
      service.claim({
        workerId: 'worker-a',
        limit: 1,
        now: new Date('2026-09-08T15:00:00.000Z'),
      }),
    ).resolves.toEqual([runRow({ status: 'processing' })]);

    expect(manager.query.mock.calls[0][0]).toContain('FOR UPDATE SKIP LOCKED');
    expect(manager.query.mock.calls[1][0]).toContain(
      "WHERE id = ANY($1::uuid[]) AND status = 'queued'",
    );
    expect(manager.query.mock.calls[1][1]).toEqual([
      ['run-1'],
      new Date('2026-09-08T15:00:00.000Z'),
      'worker-a',
    ]);
    expect(runs.find).toHaveBeenCalledWith({ where: [{ id: 'run-1' }] });
  });

  it.each(['markSucceeded', 'markFailed', 'markDeadLetter'] as const)(
    '%s writes back only while the same worker owns the lease',
    async (method) => {
      const { service, dataSource } = harness();
      dataSource.query.mockResolvedValueOnce([{ id: 'run-1' }]);
      const input = {
        runId: 'run-1',
        lockedBy: 'worker-a',
        counters: { rowsWritten: 1, rowsSkipped: 2, apiCalls: 3 },
        lastError: 'safe_code',
      };

      const result =
        method === 'markSucceeded'
          ? await service.markSucceeded(input)
          : await service[method](input);

      expect(result).toBe(true);
      expect(dataSource.query.mock.calls[0][0]).toContain(
        "WHERE id = $1 AND status = 'processing' AND locked_by = $8",
      );
      expect(dataSource.query.mock.calls[0][1]).toContain('worker-a');
      expect(JSON.stringify(dataSource.query.mock.calls[0][1])).not.toContain(
        'provider raw message',
      );
    },
  );

  it('uses a stable idempotency key for the same asset/window intent', () => {
    const { service } = harness();
    const input = {
      assetId: 'asset-1',
      runKind: 'scheduled' as const,
      fromDate: '2026-09-07',
      toDate: '2026-09-08',
    };
    expect(service.idempotencyKey(input)).toBe(service.idempotencyKey(input));
    expect(service.idempotencyKey(input)).toContain('asset-1');
  });
});
