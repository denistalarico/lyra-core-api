/* eslint-disable @typescript-eslint/require-await -- repository doubles intentionally mirror async TypeORM methods. */
import { IsNull, type DataSource, type Repository } from 'typeorm';
import { SettingsCryptoService } from '../../../common/crypto/settings-crypto.service';
import { SocialOrganicCredentialResolver } from '../credentials';
import {
  SocialOrganicAssetEntity,
  SocialOrganicConnectionEntity,
} from '../entities';
import {
  SocialOrganicConnectionService,
  SocialOrganicPublicationCancellationHook,
} from './social-organic-connection.service';
import {
  SocialOrganicOAuthProviderHooks,
  SocialOrganicOAuthProviderRegistry,
} from './social-organic-oauth.provider';

function builder(one: unknown, many: unknown[] = []) {
  const query: Record<string, jest.Mock> = {};

  for (const method of [
    'addSelect',
    'leftJoinAndSelect',
    'where',
    'andWhere',
    'setLock',
    'orderBy',
    'addOrderBy',
  ]) {
    query[method] = jest.fn(() => query);
  }

  query.getOne = jest.fn(async () => one);
  query.getMany = jest.fn(async () => many);
  return query;
}

describe('SocialOrganicConnectionService', () => {
  const originalKey = process.env.SETTINGS_ENCRYPTION_KEY;

  beforeAll(() => {
    process.env.SETTINGS_ENCRYPTION_KEY = 'organic-disconnect-test-key';
  });

  afterAll(() => {
    if (originalKey === undefined) delete process.env.SETTINGS_ENCRYPTION_KEY;
    else process.env.SETTINGS_ENCRYPTION_KEY = originalKey;
  });

  it('revokes best effort, clears every credential, preserves rows and invokes the P1 hook', async () => {
    const crypto = new SettingsCryptoService();
    const connection = {
      id: 'connection-id',
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: null,
      provider: 'network_alpha',
      connectionStatus: 'connected',
      authorizationMethod: 'oauth_business',
      credentialVersion: 1,
      accessTokenEncrypted: crypto.encrypt('connection-token'),
      refreshTokenEncrypted: crypto.encrypt('refresh-token'),
      tokenExpiresAt: new Date(Date.now() + 60_000),
      scopes: ['publish'],
      oauthStateHash: null,
      oauthExpiresAt: null,
      createdById: 'user-a',
      lastError: 'old_error',
      metadata: {},
      credentialRemovedAt: null,
      assets: [],
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    } as SocialOrganicConnectionEntity;
    const asset = {
      id: 'asset-id',
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: null,
      connectionId: connection.id,
      connection,
      provider: connection.provider,
      assetType: 'profile',
      externalAssetId: 'external-asset',
      displayName: 'Profile',
      username: null,
      avatarUrl: null,
      assetTokenEncrypted: crypto.encrypt('asset-token'),
      assetTokenExpiresAt: new Date(Date.now() + 60_000),
      isPublishEnabled: true,
      capabilitiesSnapshot: {},
      status: 'active',
      lastHealthCheckAt: null,
      lastHealthStatus: null,
      metadata: {},
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    } as SocialOrganicAssetEntity;
    const connectionQuery = builder(connection);
    const assetQuery = builder(null, [asset]);
    const connectionRepository = {
      createQueryBuilder: jest.fn(() => connectionQuery),
      save: jest.fn(async (row: SocialOrganicConnectionEntity) => row),
    };
    const assetRepository = {
      createQueryBuilder: jest.fn(() => assetQuery),
      save: jest.fn(async (rows: SocialOrganicAssetEntity[]) => rows),
    };
    const manager = {
      getRepository: (entity: unknown) =>
        entity === SocialOrganicConnectionEntity
          ? connectionRepository
          : assetRepository,
    };
    const dataSource = {
      transaction: jest.fn(async (callback: (value: unknown) => unknown) =>
        callback(manager),
      ),
    };
    const providerHooks: SocialOrganicOAuthProviderHooks = {
      configuration: {
        provider: connection.provider,
        authorizationMethod: 'oauth_business',
        scopes: [],
        loginConfig: {},
        callbackUrl: new URL('https://api.example.test/callback'),
        frontendRedirectUrl: new URL('https://app.example.test/settings'),
      },
      buildAuthorizationUrl: jest.fn(() => ''),
      exchangeCode: jest.fn(),
      discoverAssets: jest.fn(),
      prepareAsset: jest.fn(),
      revokeAuthorization: jest.fn(async () => {
        throw new Error('provider detail');
      }),
    };
    const cancellation: SocialOrganicPublicationCancellationHook = {
      cancelForAssets: jest.fn(async () => undefined),
    };
    const service = new SocialOrganicConnectionService(
      {} as Repository<SocialOrganicConnectionEntity>,
      {} as Repository<SocialOrganicAssetEntity>,
      dataSource as unknown as DataSource,
      new SocialOrganicCredentialResolver(
        {} as Repository<SocialOrganicAssetEntity>,
        {} as Repository<SocialOrganicConnectionEntity>,
        crypto,
      ),
      new SocialOrganicOAuthProviderRegistry([providerHooks]),
      cancellation,
    );

    const view = await service.disconnect({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: null,
      connectionId: connection.id,
    });

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const revokeAuthorization = providerHooks.revokeAuthorization as jest.Mock;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const cancelForAssets = cancellation.cancelForAssets as jest.Mock;
    expect(revokeAuthorization).toHaveBeenCalledWith({
      connectionAccessToken: 'connection-token',
      refreshToken: 'refresh-token',
      assets: [
        { externalAssetId: 'external-asset', accessToken: 'asset-token' },
      ],
    });
    expect(connection.connectionStatus).toBe('disconnected');
    expect(connection.accessTokenEncrypted).toBeNull();
    expect(connection.refreshTokenEncrypted).toBeNull();
    expect(connection.credentialRemovedAt).toBeInstanceOf(Date);
    expect(asset.status).toBe('revoked');
    expect(asset.assetTokenEncrypted).toBeNull();
    expect(asset.isPublishEnabled).toBe(false);
    expect(connectionRepository.save).toHaveBeenCalledWith(connection);
    expect(assetRepository.save).toHaveBeenCalledWith([asset]);
    expect(cancelForAssets).toHaveBeenCalledWith({
      manager,
      scope: {
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        agencyClientId: null,
      },
      assetIds: ['asset-id'],
      reason: 'connection_disconnected',
    });
    expect(view.state).toBe('disconnected');
  });

  it('returns not found when the scoped lookup cannot see the connection', async () => {
    const connectionQuery = builder(null);
    const connectionRepository = {
      createQueryBuilder: jest.fn(() => connectionQuery),
    };
    const dataSource = {
      transaction: jest.fn(async (callback: (manager: unknown) => unknown) =>
        callback({ getRepository: () => connectionRepository }),
      ),
    };
    const service = new SocialOrganicConnectionService(
      {} as Repository<SocialOrganicConnectionEntity>,
      {} as Repository<SocialOrganicAssetEntity>,
      dataSource as unknown as DataSource,
      new SocialOrganicCredentialResolver(
        {} as Repository<SocialOrganicAssetEntity>,
        {} as Repository<SocialOrganicConnectionEntity>,
        new SettingsCryptoService(),
      ),
      new SocialOrganicOAuthProviderRegistry([]),
    );

    await expect(
      service.disconnect({
        tenantId: 'tenant-b',
        workspaceId: 'workspace-b',
        agencyClientId: 'client-b',
        connectionId: 'connection-id',
      }),
    ).rejects.toThrow('Connection not found.');

    expect(connectionQuery.andWhere).toHaveBeenCalledWith(
      'connection.agencyClientId = :agencyClientId',
      { agencyClientId: 'client-b' },
    );
  });

  describe('updateAssetTimezone', () => {
    function assetFixture(
      overrides: Partial<SocialOrganicAssetEntity> = {},
    ): SocialOrganicAssetEntity {
      return {
        id: 'asset-id',
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        agencyClientId: null,
        connectionId: 'connection-id',
        provider: 'network_alpha',
        assetType: 'profile',
        externalAssetId: 'external-asset',
        displayName: 'Profile',
        username: null,
        avatarUrl: null,
        assetTokenEncrypted: 'encrypted-token',
        assetTokenExpiresAt: null,
        assetTimezone: null,
        isPublishEnabled: true,
        capabilitiesSnapshot: {},
        status: 'active',
        lastHealthCheckAt: null,
        lastHealthStatus: null,
        metadata: {},
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        updatedAt: new Date('2026-09-01T00:00:00.000Z'),
        ...overrides,
      } as SocialOrganicAssetEntity;
    }

    type FindOneOptions = {
      where: {
        id: string;
        tenantId: string;
        workspaceId: string;
        agencyClientId: unknown;
      };
    };

    function harness(asset: SocialOrganicAssetEntity | null) {
      const findOne = jest.fn<
        Promise<SocialOrganicAssetEntity | null>,
        [FindOneOptions]
      >(async () => asset);
      const save = jest.fn(async (row: SocialOrganicAssetEntity) => row);
      const assetRepository = { findOne, save };
      const service = new SocialOrganicConnectionService(
        {} as Repository<SocialOrganicConnectionEntity>,
        assetRepository as unknown as Repository<SocialOrganicAssetEntity>,
        {} as DataSource,
        new SocialOrganicCredentialResolver(
          {} as Repository<SocialOrganicAssetEntity>,
          {} as Repository<SocialOrganicConnectionEntity>,
          new SettingsCryptoService(),
        ),
        new SocialOrganicOAuthProviderRegistry([]),
      );
      return { service, findOne, save };
    }

    it('1. persists a valid IANA timezone', async () => {
      const asset = assetFixture();
      const { service, save } = harness(asset);

      const view = await service.updateAssetTimezone({
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        agencyClientId: null,
        assetId: 'asset-id',
        timezone: 'America/Sao_Paulo',
      });

      expect(asset.assetTimezone).toBe('America/Sao_Paulo');
      expect(save).toHaveBeenCalledWith(asset);
      expect(view.assetTimezone).toBe('America/Sao_Paulo');
    });

    it('2. rejects an invalid timezone string', async () => {
      const { service } = harness(assetFixture());

      await expect(
        service.updateAssetTimezone({
          tenantId: 'tenant-a',
          workspaceId: 'workspace-a',
          agencyClientId: null,
          assetId: 'asset-id',
          timezone: 'not/a-zone',
        }),
      ).rejects.toThrow('invalid_asset_timezone');
    });

    it('3. rejects a fixed UTC offset', async () => {
      const { service } = harness(assetFixture());

      await expect(
        service.updateAssetTimezone({
          tenantId: 'tenant-a',
          workspaceId: 'workspace-a',
          agencyClientId: null,
          assetId: 'asset-id',
          timezone: '-03:00',
        }),
      ).rejects.toThrow('invalid_asset_timezone');
    });

    it('4. clears the timezone on explicit null', async () => {
      const asset = assetFixture({ assetTimezone: 'America/Sao_Paulo' });
      const { service, save } = harness(asset);

      const view = await service.updateAssetTimezone({
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        agencyClientId: null,
        assetId: 'asset-id',
        timezone: null,
      });

      expect(asset.assetTimezone).toBeNull();
      expect(save).toHaveBeenCalledWith(asset);
      expect(view.assetTimezone).toBeNull();
    });

    it('5. cross-tenant lookup is not found', async () => {
      const { service, findOne } = harness(null);

      await expect(
        service.updateAssetTimezone({
          tenantId: 'tenant-hostile',
          workspaceId: 'workspace-a',
          agencyClientId: null,
          assetId: 'asset-id',
          timezone: 'America/Sao_Paulo',
        }),
      ).rejects.toThrow('Social organic asset not found.');
      expect(findOne).toHaveBeenCalledWith({
        where: {
          id: 'asset-id',
          tenantId: 'tenant-hostile',
          workspaceId: 'workspace-a',
          agencyClientId: IsNull(),
        },
      });
    });

    it('6. cross-workspace lookup is not found', async () => {
      const { service } = harness(null);

      await expect(
        service.updateAssetTimezone({
          tenantId: 'tenant-a',
          workspaceId: 'workspace-hostile',
          agencyClientId: null,
          assetId: 'asset-id',
          timezone: 'America/Sao_Paulo',
        }),
      ).rejects.toThrow('Social organic asset not found.');
    });

    it('7. cross-agencyClient lookup is not found', async () => {
      const { service } = harness(null);

      await expect(
        service.updateAssetTimezone({
          tenantId: 'tenant-a',
          workspaceId: 'workspace-a',
          agencyClientId: 'client-hostile',
          assetId: 'asset-id',
          timezone: 'America/Sao_Paulo',
        }),
      ).rejects.toThrow('Social organic asset not found.');
    });

    it('8. agency-own context uses NULL agencyClientId semantics', async () => {
      const asset = assetFixture();
      const { service, findOne } = harness(asset);

      await service.updateAssetTimezone({
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        agencyClientId: null,
        assetId: 'asset-id',
        timezone: 'America/Sao_Paulo',
      });

      const call = findOne.mock.calls[0][0];
      expect(call.where.agencyClientId).not.toBeNull();
      expect(call.where.agencyClientId).toEqual(expect.objectContaining({}));
    });

    it('9. unknown asset id is not found', async () => {
      const { service } = harness(null);

      await expect(
        service.updateAssetTimezone({
          tenantId: 'tenant-a',
          workspaceId: 'workspace-a',
          agencyClientId: null,
          assetId: 'missing-asset',
          timezone: 'America/Sao_Paulo',
        }),
      ).rejects.toThrow('Social organic asset not found.');
    });

    it('10. only assetTimezone and updated_at-managed fields change on the saved row', async () => {
      const asset = assetFixture({ status: 'active', isPublishEnabled: true });
      const snapshot = { ...asset };
      const { service } = harness(asset);

      await service.updateAssetTimezone({
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        agencyClientId: null,
        assetId: 'asset-id',
        timezone: 'America/Sao_Paulo',
      });

      expect(asset.status).toBe(snapshot.status);
      expect(asset.isPublishEnabled).toBe(snapshot.isPublishEnabled);
      expect(asset.externalAssetId).toBe(snapshot.externalAssetId);
      expect(asset.connectionId).toBe(snapshot.connectionId);
      expect(asset.capabilitiesSnapshot).toEqual(snapshot.capabilitiesSnapshot);
    });

    it('11. credential/token field is untouched', async () => {
      const asset = assetFixture({ assetTokenEncrypted: 'still-encrypted' });
      const { service } = harness(asset);

      await service.updateAssetTimezone({
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        agencyClientId: null,
        assetId: 'asset-id',
        timezone: 'America/Sao_Paulo',
      });

      expect(asset.assetTokenEncrypted).toBe('still-encrypted');
    });

    it('12. metadata never receives a timezone key', async () => {
      const asset = assetFixture({ metadata: { some: 'value' } });
      const { service } = harness(asset);

      await service.updateAssetTimezone({
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        agencyClientId: null,
        assetId: 'asset-id',
        timezone: 'America/Sao_Paulo',
      });

      expect(asset.metadata).toEqual({ some: 'value' });
    });

    it('13. safe view exposes assetTimezone', async () => {
      const asset = assetFixture();
      const { service } = harness(asset);

      const view = await service.updateAssetTimezone({
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        agencyClientId: null,
        assetId: 'asset-id',
        timezone: 'America/Sao_Paulo',
      });

      expect(view).toEqual(
        expect.objectContaining({ assetTimezone: 'America/Sao_Paulo' }),
      );
      expect(JSON.stringify(view)).not.toMatch(/token|credential/i);
    });
  });
});
