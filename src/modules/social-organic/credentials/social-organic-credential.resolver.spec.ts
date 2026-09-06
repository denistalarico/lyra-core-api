import { inspect } from 'node:util';
import { ObjectLiteral, Repository } from 'typeorm';
import { SettingsCryptoService } from '../../../common/crypto/settings-crypto.service';
import {
  SocialOrganicAssetEntity,
  SocialOrganicConnectionEntity,
} from '../entities';
import { SocialOrganicCredentialError } from './social-organic-credential.error';
import { SocialOrganicCredentialResolver } from './social-organic-credential.resolver';

const TENANT = '11111111-1111-1111-1111-111111111111';
const OTHER_TENANT = '22222222-2222-2222-2222-222222222222';
const WORKSPACE = '33333333-3333-3333-3333-333333333333';
const MANAGED_CLIENT = '44444444-4444-4444-4444-444444444444';

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
    scopes: ['pages_manage_posts'],
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
    displayName: 'Página',
    username: null,
    avatarUrl: null,
    assetTokenEncrypted: null,
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

type QueryRecord = {
  select: string[];
  parameters: Record<string, unknown>[];
};

type QueryBuilderDouble<T> = {
  select: jest.MockedFunction<(field: string) => QueryBuilderDouble<T>>;
  where: jest.MockedFunction<
    (
      clause: string,
      parameters: Record<string, unknown>,
    ) => QueryBuilderDouble<T>
  >;
  andWhere: jest.MockedFunction<
    (
      clause: string,
      parameters?: Record<string, unknown>,
    ) => QueryBuilderDouble<T>
  >;
  getOne: jest.MockedFunction<() => Promise<T | null>>;
};

type FindOptionsDouble = {
  where?: {
    id?: string;
    tenantId?: string;
    workspaceId?: string;
    agencyClientId?: unknown;
    connection?: {
      tenantId?: string;
      workspaceId?: string;
      agencyClientId?: unknown;
    };
  };
};

function repository<T extends ObjectLiteral>(
  findRow: T | null,
  credentialRow: T | null,
) {
  const query: QueryRecord = { select: [], parameters: [] };
  const queryBuilder = {} as QueryBuilderDouble<T>;
  const findOne = jest.fn((options?: FindOptionsDouble): Promise<T | null> => {
    void options;
    return Promise.resolve(findRow);
  });
  const createQueryBuilder = jest.fn(() => queryBuilder);

  queryBuilder.select = jest.fn((field: string) => {
    query.select.push(field);
    return queryBuilder;
  });
  queryBuilder.where = jest.fn(
    (_clause: string, parameters: Record<string, unknown>) => {
      query.parameters.push(parameters);
      return queryBuilder;
    },
  );
  queryBuilder.andWhere = jest.fn(
    (_clause: string, parameters: Record<string, unknown> = {}) => {
      query.parameters.push(parameters);
      return queryBuilder;
    },
  );
  queryBuilder.getOne = jest.fn(() => Promise.resolve(credentialRow));
  const value = {
    findOne,
    createQueryBuilder,
  } as unknown as Repository<T>;

  return {
    value,
    query,
    findOne,
    createQueryBuilder,
    getOne: queryBuilder.getOne,
  };
}

function createResolver(
  row: SocialOrganicAssetEntity | null,
  options: { connectionToken?: string | null; assetToken?: string | null } = {},
) {
  const connectionRow = row?.connection;
  const assets = repository(
    row,
    row
      ? ({
          ...row,
          assetTokenEncrypted: options.assetToken ?? null,
        } as SocialOrganicAssetEntity)
      : null,
  );
  const connections = repository(
    null,
    connectionRow
      ? ({
          ...connectionRow,
          accessTokenEncrypted: options.connectionToken ?? null,
        } as SocialOrganicConnectionEntity)
      : null,
  );

  return {
    assets,
    connections,
    resolver: new SocialOrganicCredentialResolver(
      assets.value,
      connections.value,
      new SettingsCryptoService(),
    ),
  };
}

const scope = {
  tenantId: TENANT,
  workspaceId: WORKSPACE,
  agencyClientId: null,
  assetId: 'asset-id',
};

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(SocialOrganicCredentialError);
  await expect(promise).rejects.toMatchObject({ code, message: code });
}

describe('SocialOrganicCredentialResolver', () => {
  const crypto = new SettingsCryptoService();

  it('resolves oauth_user from the connection token', async () => {
    const resolved = createResolver(asset(), {
      connectionToken: crypto.encrypt('connection-token'),
    });

    const credential = await resolved.resolver.resolve(scope);

    expect(credential).toMatchObject({
      assetId: 'asset-id',
      connectionId: 'connection-id',
      provider: 'meta',
      assetType: 'facebook_page',
      externalAssetId: 'page-123',
      scopes: ['pages_manage_posts'],
      credentialVersion: 4,
    });
    expect(credential.accessToken).toBe('connection-token');
    expect(resolved.connections.query.select).toEqual([
      'connection.accessTokenEncrypted',
    ]);
    expect(resolved.assets.getOne).not.toHaveBeenCalled();
  });

  it.each(['oauth_business', 'internal_system_user'] as const)(
    'resolves %s from the asset token',
    async (authorizationMethod) => {
      const linkedConnection = connection({ authorizationMethod });
      const resolved = createResolver(asset({ connection: linkedConnection }), {
        assetToken: crypto.encrypt('asset-token'),
      });

      const credential = await resolved.resolver.resolve(scope);

      expect(credential.accessToken).toBe('asset-token');
      expect(resolved.assets.query.select).toEqual([
        'asset.assetTokenEncrypted',
      ]);
      expect(resolved.connections.getOne).not.toHaveBeenCalled();
    },
  );

  it('uses persisted scope for the secret lookup and returned credential', async () => {
    const linkedConnection = connection({
      tenantId: OTHER_TENANT,
      agencyClientId: MANAGED_CLIENT,
    });
    const resolved = createResolver(
      asset({
        tenantId: OTHER_TENANT,
        agencyClientId: MANAGED_CLIENT,
        connection: linkedConnection,
      }),
      { connectionToken: crypto.encrypt('token') },
    );

    const credential = await resolved.resolver.resolve(scope);
    const parameters = resolved.connections.query.parameters.reduce<
      Record<string, unknown>
    >((merged, current) => ({ ...merged, ...current }), {});

    expect(parameters).toMatchObject({
      tenantId: OTHER_TENANT,
      agencyClientId: MANAGED_CLIENT,
    });
    expect(credential).toMatchObject({
      tenantId: OTHER_TENANT,
      agencyClientId: MANAGED_CLIENT,
    });
  });

  it('makes an asset from another tenant indistinguishable from missing', async () => {
    const resolved = createResolver(null);

    await expectCode(
      resolved.resolver.resolve({ ...scope, tenantId: OTHER_TENANT }),
      'asset_not_found',
    );
    await expectCode(
      resolved.resolver.resolve({ ...scope, assetId: 'missing-id' }),
      'asset_not_found',
    );

    const firstWhere = resolved.assets.findOne.mock.calls[0][0]!.where!;
    expect(firstWhere).toMatchObject({
      id: 'asset-id',
      tenantId: OTHER_TENANT,
      workspaceId: WORKSPACE,
      connection: {
        tenantId: OTHER_TENANT,
        workspaceId: WORKSPACE,
      },
    });
  });

  it('uses IsNull for agency-owned asset and connection scope', async () => {
    const resolved = createResolver(null);

    await expectCode(resolved.resolver.resolve(scope), 'asset_not_found');

    const where = resolved.assets.findOne.mock.calls[0][0]!.where!;
    expect(where.agencyClientId).toMatchObject({ _type: 'isNull' });
    expect(where.connection!.agencyClientId).toMatchObject({ _type: 'isNull' });
  });

  it.each([
    [
      'credential_removed',
      asset({ connection: connection({ credentialRemovedAt: new Date() }) }),
    ],
    [
      'connection_not_connected',
      asset({ connection: connection({ connectionStatus: 'disconnected' }) }),
    ],
    ['asset_not_active', asset({ status: 'revoked' })],
    ['publishing_not_enabled', asset({ isPublishEnabled: false })],
    [
      'asset_provider_mismatch',
      asset({
        provider: 'meta',
        connection: connection({ provider: 'youtube' }),
      }),
    ],
    [
      'unsupported_authorization_method',
      asset({
        connection: connection({
          authorizationMethod: 'future_method' as never,
        }),
      }),
    ],
  ] as const)('refuses %s', async (code, row) => {
    await expectCode(createResolver(row).resolver.resolve(scope), code);
  });

  it('collapses a missing token to credential_removed', async () => {
    await expectCode(
      createResolver(asset()).resolver.resolve(scope),
      'credential_removed',
    );
  });

  it('collapses decryption failure to credential_removed', async () => {
    await expectCode(
      createResolver(asset(), {
        connectionToken: 'broken-ciphertext',
      }).resolver.resolve(scope),
      'credential_removed',
    );
  });

  it('refuses within the 60 second expiry skew before loading ciphertext', async () => {
    const resolved = createResolver(
      asset({
        connection: connection({
          tokenExpiresAt: new Date(Date.now() + 30_000),
        }),
      }),
      { connectionToken: crypto.encrypt('token') },
    );

    await expectCode(resolved.resolver.resolve(scope), 'credential_removed');
    expect(resolved.connections.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('does not serialize, spread or inspect the token', async () => {
    const resolved = createResolver(asset(), {
      connectionToken: crypto.encrypt('secret-token'),
    });

    const credential = await resolved.resolver.resolve(scope);

    expect(JSON.stringify(credential)).not.toContain('secret-token');
    expect(JSON.stringify(credential)).toContain('[REDACTED]');
    expect({ ...credential }).not.toHaveProperty('accessToken');
    expect(inspect(credential, { showHidden: true })).not.toContain(
      'secret-token',
    );
  });
});
