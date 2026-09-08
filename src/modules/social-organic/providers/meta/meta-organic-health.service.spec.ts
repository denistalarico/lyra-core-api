/* eslint-disable @typescript-eslint/require-await -- provider/repository doubles intentionally return resolved async values. */
import { NotFoundException } from '@nestjs/common';
import { FindOperator, type Repository } from 'typeorm';
import { SocialOrganicCredentialResolver } from '../../credentials/social-organic-credential.resolver';
import { SocialOrganicCredentialError } from '../../credentials/social-organic-credential.error';
import type {
  SocialOrganicAssetEntity,
  SocialOrganicConnectionEntity,
} from '../../entities';
import { MetaOrganicGraphError } from './meta-organic-graph.error';
import { MetaOrganicGraphService } from './meta-organic-graph.service';
import { MetaOrganicHealthService } from './meta-organic-health.service';
import { HEALTH_NEAR_EXPIRY_MS } from './meta-organic-health.support';

const TENANT = '11111111-1111-1111-1111-111111111111';
const OTHER_TENANT = '22222222-2222-2222-2222-222222222222';
const WORKSPACE = '33333333-3333-3333-3333-333333333333';
const OTHER_WORKSPACE = '55555555-5555-5555-5555-555555555555';
const OTHER_CLIENT = '66666666-6666-6666-6666-666666666666';

function connection(
  overrides: Partial<SocialOrganicConnectionEntity> = {},
): SocialOrganicConnectionEntity {
  return {
    id: 'connection-id',
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    agencyClientId: null,
    provider: 'meta',
    connectionStatus: 'connected',
    authorizationMethod: 'oauth_user',
    credentialVersion: 4,
    accessTokenEncrypted: null,
    refreshTokenEncrypted: null,
    tokenExpiresAt: null,
    scopes: [
      'business_management',
      'pages_show_list',
      'pages_read_engagement',
      'instagram_basic',
      'pages_manage_posts',
      'instagram_content_publish',
    ],
    oauthStateHash: null,
    oauthExpiresAt: null,
    createdById: null,
    lastError: null,
    metadata: {},
    credentialRemovedAt: null,
    assets: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as SocialOrganicConnectionEntity;
}

function asset(
  overrides: Partial<SocialOrganicAssetEntity> = {},
): SocialOrganicAssetEntity {
  const linkedConnection =
    overrides.connection ??
    connection(overrides.connectionId ? { id: overrides.connectionId } : {});

  return {
    id: 'asset-id',
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    agencyClientId: null,
    connectionId: linkedConnection.id,
    connection: linkedConnection,
    provider: 'meta',
    assetType: 'facebook_page',
    externalAssetId: 'page-123',
    displayName: 'Test Page',
    username: null,
    avatarUrl: null,
    assetTokenEncrypted: 'ciphertext',
    assetTokenExpiresAt: null,
    isPublishEnabled: true,
    capabilitiesSnapshot: {},
    status: 'active',
    lastHealthCheckAt: null,
    lastHealthStatus: null,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as SocialOrganicAssetEntity;
}

function harness(
  input: {
    found?: SocialOrganicAssetEntity | null;
    listed?: SocialOrganicAssetEntity[];
    resolve?: () => Promise<unknown>;
    getObjectId?: () => Promise<string>;
  } = {},
) {
  const assetsRepository = {
    findOne: jest.fn<
      Promise<SocialOrganicAssetEntity | null>,
      [Record<string, unknown>]
    >(async () => input.found ?? null),
    find: jest.fn<
      Promise<SocialOrganicAssetEntity[]>,
      [Record<string, unknown>]
    >(async () => input.listed ?? []),
    update: jest.fn<
      Promise<{ affected: number }>,
      [Record<string, unknown>, Record<string, unknown>]
    >(async () => ({ affected: 1 })),
  };
  const credentialResolver = {
    resolve:
      input.resolve ??
      jest.fn(async () => ({
        assetId: 'asset-id',
        connectionId: 'connection-id',
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        agencyClientId: null,
        provider: 'meta',
        assetType: 'facebook_page',
        externalAssetId: 'page-123',
        scopes: [],
        credentialVersion: 1,
        accessToken: 'decrypted-token',
      })),
  };
  const graph = {
    getObjectId: input.getObjectId ?? jest.fn(async () => 'page-123'),
  };

  const service = new MetaOrganicHealthService(
    assetsRepository as unknown as Repository<SocialOrganicAssetEntity>,
    credentialResolver as unknown as SocialOrganicCredentialResolver,
    graph as unknown as MetaOrganicGraphService,
  );

  return { service, assetsRepository, credentialResolver, graph };
}

describe('MetaOrganicHealthService', () => {
  const NOW = new Date('2026-09-08T12:00:00.000Z');

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('1. reports healthy for a Facebook Page with valid scopes, no expiry issue and a reachable asset', async () => {
    const { service } = harness({ found: asset() });

    await expect(
      service.checkAsset({
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        agencyClientId: null,
        assetId: 'asset-id',
      }),
    ).resolves.toMatchObject({ status: 'healthy', reason: 'ok' });
  });

  it('2. reports healthy for an Instagram Professional asset with valid scopes', async () => {
    const { service } = harness({
      found: asset({
        assetType: 'instagram_professional',
        externalAssetId: 'ig-456',
      }),
      getObjectId: jest.fn(async () => 'ig-456'),
    });

    await expect(
      service.checkAsset({
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        agencyClientId: null,
        assetId: 'asset-id',
      }),
    ).resolves.toMatchObject({ status: 'healthy', reason: 'ok' });
  });

  it('3. token/credential expired (connection user token) -> unhealthy', async () => {
    const { service } = harness({
      found: asset({
        connection: connection({
          tokenExpiresAt: new Date(NOW.getTime() - 1000),
        }),
      }),
    });

    await expect(
      service.checkAsset({
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        agencyClientId: null,
        assetId: 'asset-id',
      }),
    ).resolves.toMatchObject({
      status: 'unhealthy',
      reason: 'credential_expired',
    });
  });

  it('3b. asset-level token expired (oauth_business) -> unhealthy', async () => {
    const { service } = harness({
      found: asset({
        assetTokenExpiresAt: new Date(NOW.getTime() - 1000),
        connection: connection({ authorizationMethod: 'oauth_business' }),
      }),
    });

    await expect(
      service.checkAsset({
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        agencyClientId: null,
        assetId: 'asset-id',
      }),
    ).resolves.toMatchObject({
      status: 'unhealthy',
      reason: 'credential_expired',
    });
  });

  it('4. credential removed -> unhealthy', async () => {
    const { service } = harness({
      found: asset({
        connection: connection({ credentialRemovedAt: NOW }),
      }),
    });

    await expect(
      service.checkAsset({
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        agencyClientId: null,
        assetId: 'asset-id',
      }),
    ).resolves.toMatchObject({
      status: 'unhealthy',
      reason: 'credential_removed',
    });
  });

  it('5. required publishing scope lost (Facebook Page missing pages_manage_posts) -> unhealthy', async () => {
    const { service } = harness({
      found: asset({
        connection: connection({
          scopes: ['pages_show_list', 'pages_read_engagement'],
        }),
      }),
    });

    await expect(
      service.checkAsset({
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        agencyClientId: null,
        assetId: 'asset-id',
      }),
    ).resolves.toMatchObject({
      status: 'unhealthy',
      reason: 'permission_lost',
    });
  });

  it('5b. required publishing scope lost (Instagram missing instagram_content_publish) -> unhealthy', async () => {
    const { service } = harness({
      found: asset({
        assetType: 'instagram_professional',
        connection: connection({
          scopes: ['instagram_basic', 'pages_read_engagement'],
        }),
      }),
    });

    await expect(
      service.checkAsset({
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        agencyClientId: null,
        assetId: 'asset-id',
      }),
    ).resolves.toMatchObject({
      status: 'unhealthy',
      reason: 'permission_lost',
    });
  });

  it('6. asset gone/unreachable (provider says permanent failure) -> unhealthy', async () => {
    const { service } = harness({
      found: asset(),
      getObjectId: jest.fn(async () => {
        throw new MetaOrganicGraphError({
          kind: 'permanent',
          code: 'meta_request_rejected',
        });
      }),
    });

    await expect(
      service.checkAsset({
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        agencyClientId: null,
        assetId: 'asset-id',
      }),
    ).resolves.toMatchObject({
      status: 'unhealthy',
      reason: 'asset_unreachable',
    });
  });

  it("6b. provider returns a different id than the asset's external id -> unhealthy asset_unreachable", async () => {
    const { service } = harness({
      found: asset(),
      getObjectId: jest.fn(async () => 'some-other-id'),
    });

    await expect(
      service.checkAsset({
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        agencyClientId: null,
        assetId: 'asset-id',
      }),
    ).resolves.toMatchObject({
      status: 'unhealthy',
      reason: 'asset_unreachable',
    });
  });

  it('7. expiry near threshold -> degraded', async () => {
    const { service } = harness({
      found: asset({
        connection: connection({
          tokenExpiresAt: new Date(NOW.getTime() + HEALTH_NEAR_EXPIRY_MS - 1),
        }),
      }),
    });

    await expect(
      service.checkAsset({
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        agencyClientId: null,
        assetId: 'asset-id',
      }),
    ).resolves.toMatchObject({ status: 'degraded', reason: 'expires_soon' });
  });

  it('7b. expiry exactly at threshold boundary -> degraded', async () => {
    const { service } = harness({
      found: asset({
        connection: connection({
          tokenExpiresAt: new Date(NOW.getTime() + HEALTH_NEAR_EXPIRY_MS),
        }),
      }),
    });

    await expect(
      service.checkAsset({
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        agencyClientId: null,
        assetId: 'asset-id',
      }),
    ).resolves.toMatchObject({ status: 'degraded', reason: 'expires_soon' });
  });

  it('8. expiry comfortably distant -> healthy', async () => {
    const { service } = harness({
      found: asset({
        connection: connection({
          tokenExpiresAt: new Date(NOW.getTime() + HEALTH_NEAR_EXPIRY_MS + 1),
        }),
      }),
    });

    await expect(
      service.checkAsset({
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        agencyClientId: null,
        assetId: 'asset-id',
      }),
    ).resolves.toMatchObject({ status: 'healthy', reason: 'ok' });
  });

  it('9. no known expiry does not invent degraded', async () => {
    const { service } = harness({
      found: asset({ connection: connection({ tokenExpiresAt: null }) }),
    });

    await expect(
      service.checkAsset({
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        agencyClientId: null,
        assetId: 'asset-id',
      }),
    ).resolves.toMatchObject({ status: 'healthy', reason: 'ok' });
  });

  it('10. provider transient failure handled safely (degraded, not unhealthy)', async () => {
    const { service } = harness({
      found: asset(),
      getObjectId: jest.fn(async () => {
        throw new MetaOrganicGraphError({
          kind: 'transient',
          code: 'meta_service_unavailable',
        });
      }),
    });

    await expect(
      service.checkAsset({
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        agencyClientId: null,
        assetId: 'asset-id',
      }),
    ).resolves.toMatchObject({
      status: 'degraded',
      reason: 'provider_unavailable',
    });
  });

  it('10b. provider rate limited handled safely (degraded, not unhealthy)', async () => {
    const { service } = harness({
      found: asset(),
      getObjectId: jest.fn(async () => {
        throw new MetaOrganicGraphError({
          kind: 'rate_limited',
          code: 'meta_rate_limited',
        });
      }),
    });

    await expect(
      service.checkAsset({
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        agencyClientId: null,
        assetId: 'asset-id',
      }),
    ).resolves.toMatchObject({
      status: 'degraded',
      reason: 'provider_unavailable',
    });
  });

  it('11. raw provider message never returned or persisted', async () => {
    const { service, assetsRepository } = harness({
      found: asset(),
      getObjectId: jest.fn(async () => {
        throw new MetaOrganicGraphError({
          kind: 'permanent',
          code: 'meta_request_rejected',
          httpStatus: 400,
          metaCode: 100,
        });
      }),
    });

    const result = await service.checkAsset({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      agencyClientId: null,
      assetId: 'asset-id',
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/meta_request_rejected/);
    expect(serialized).not.toMatch(/httpStatus|metaCode/);

    const persistedCall = assetsRepository.update.mock.calls[0];
    expect(JSON.stringify(persistedCall)).not.toMatch(/meta_request_rejected/);
  });

  it('12. cross-tenant asset -> NotFound', async () => {
    const { service } = harness({ found: null });

    await expect(
      service.checkAsset({
        tenantId: OTHER_TENANT,
        workspaceId: WORKSPACE,
        agencyClientId: null,
        assetId: 'asset-id',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('13. cross-workspace -> NotFound', async () => {
    const { service } = harness({ found: null });

    await expect(
      service.checkAsset({
        tenantId: TENANT,
        workspaceId: OTHER_WORKSPACE,
        agencyClientId: null,
        assetId: 'asset-id',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('14. cross-agencyClient -> NotFound', async () => {
    const { service } = harness({ found: null });

    await expect(
      service.checkAsset({
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        agencyClientId: OTHER_CLIENT,
        assetId: 'asset-id',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('15. agency own NULL semantics does not match a managed-client asset', async () => {
    const { service, assetsRepository } = harness({ found: null });

    await expect(
      service.checkAsset({
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        agencyClientId: null,
        assetId: 'asset-id',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    const [options] = assetsRepository.findOne.mock.calls[0];
    const where = options.where as { agencyClientId: unknown };
    // `agencyClientId: null` compiles to an `IsNull()` FindOperator, never a
    // literal `null` — the agency's own scope is a real SQL predicate, not an
    // accidentally-satisfied "anything" match.
    expect(where.agencyClientId).toBeInstanceOf(FindOperator);
  });

  it('16. disconnected connection -> unhealthy', async () => {
    const { service } = harness({
      found: asset({
        connection: connection({ connectionStatus: 'disconnected' }),
      }),
    });

    await expect(
      service.checkAsset({
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        agencyClientId: null,
        assetId: 'asset-id',
      }),
    ).resolves.toMatchObject({
      status: 'unhealthy',
      reason: 'connection_disconnected',
    });
  });

  it('17. disabled asset (isPublishEnabled=false) -> unhealthy', async () => {
    const { service } = harness({
      found: asset({ isPublishEnabled: false }),
    });

    await expect(
      service.checkAsset({
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        agencyClientId: null,
        assetId: 'asset-id',
      }),
    ).resolves.toMatchObject({ status: 'unhealthy', reason: 'unknown' });
  });

  it('18. recovery unhealthy -> healthy across two checks', async () => {
    const failingGraph = jest.fn(async () => {
      throw new MetaOrganicGraphError({
        kind: 'permanent',
        code: 'meta_request_rejected',
      });
    });
    const { service, assetsRepository } = harness({
      found: asset(),
      getObjectId: failingGraph,
    });

    const first = await service.checkAsset({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      agencyClientId: null,
      assetId: 'asset-id',
    });
    expect(first.status).toBe('unhealthy');

    const { service: recoveredService } = harness({
      found: asset(),
      getObjectId: jest.fn(async () => 'page-123'),
    });
    const second = await recoveredService.checkAsset({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      agencyClientId: null,
      assetId: 'asset-id',
    });
    expect(second.status).toBe('healthy');
    expect(assetsRepository.update).toHaveBeenCalled();
  });

  it('19. persistence writes last_health_check_at', async () => {
    const { service, assetsRepository } = harness({ found: asset() });

    await service.checkAsset({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      agencyClientId: null,
      assetId: 'asset-id',
    });

    expect(assetsRepository.update).toHaveBeenCalledWith(
      { id: 'asset-id' },
      expect.objectContaining({ lastHealthCheckAt: NOW }),
    );
  });

  it('20. persistence writes last_health_status', async () => {
    const { service, assetsRepository } = harness({ found: asset() });

    await service.checkAsset({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      agencyClientId: null,
      assetId: 'asset-id',
    });

    expect(assetsRepository.update).toHaveBeenCalledWith(
      { id: 'asset-id' },
      expect.objectContaining({ lastHealthStatus: 'healthy' }),
    );
  });

  it('21. does not alter credential/token fields', async () => {
    const { service, assetsRepository } = harness({ found: asset() });

    await service.checkAsset({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      agencyClientId: null,
      assetId: 'asset-id',
    });

    const [, patch] = assetsRepository.update.mock.calls[0];
    expect(patch).not.toHaveProperty('assetTokenEncrypted');
    expect(patch).not.toHaveProperty('assetTokenExpiresAt');
    expect(patch).not.toHaveProperty('externalAssetId');
    expect(patch).not.toHaveProperty('capabilitiesSnapshot');
  });

  it('22. only the target asset row is updated', async () => {
    const { service, assetsRepository } = harness({ found: asset() });

    await service.checkAsset({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      agencyClientId: null,
      assetId: 'asset-id',
    });

    expect(assetsRepository.update).toHaveBeenCalledTimes(1);
    expect(assetsRepository.update).toHaveBeenCalledWith(
      { id: 'asset-id' },
      expect.anything(),
    );
  });

  it('lists only active, publish-enabled assets on connected connections for the scheduler', async () => {
    const { service, assetsRepository } = harness({ listed: [asset()] });

    const result = await service.listEligibleForScheduledCheck();

    expect(result).toHaveLength(1);
    const [options] = assetsRepository.find.mock.calls[0];
    const where = options.where as {
      status: unknown;
      isPublishEnabled: unknown;
    };
    expect(where.status).toBe('active');
    expect(where.isPublishEnabled).toBe(true);
  });

  it('fails closed for an asset type with no researched required-scope evidence', async () => {
    const { service } = harness({
      found: asset({ assetType: 'unknown_asset_type' }),
    });

    await expect(
      service.checkAsset({
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        agencyClientId: null,
        assetId: 'asset-id',
      }),
    ).resolves.toMatchObject({ status: 'unhealthy', reason: 'unknown' });
  });

  it('maps a resolver credential_removed error to unhealthy credential_removed', async () => {
    const { service } = harness({
      found: asset(),
      resolve: jest.fn(async () => {
        throw new SocialOrganicCredentialError('credential_removed');
      }),
    });

    await expect(
      service.checkAsset({
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        agencyClientId: null,
        assetId: 'asset-id',
      }),
    ).resolves.toMatchObject({
      status: 'unhealthy',
      reason: 'credential_removed',
    });
  });
});
