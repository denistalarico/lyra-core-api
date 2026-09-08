/* eslint-disable @typescript-eslint/require-await -- repository doubles intentionally mirror async TypeORM methods. */
import { createHash } from 'crypto';
import type { DataSource, Repository } from 'typeorm';
import { SettingsCryptoService } from '../../../common/crypto/settings-crypto.service';
import { SocialOrganicCredentialResolver } from '../credentials';
import {
  SocialOrganicAssetEntity,
  SocialOrganicConnectionEntity,
} from '../entities';
import {
  SocialOrganicOAuthProviderHooks,
  SocialOrganicOAuthProviderRegistry,
} from './social-organic-oauth.provider';
import { SocialOrganicOAuthService } from './social-organic-oauth.service';

const PROVIDER = 'network_alpha';
const CALLBACK_URL = 'https://api.example.test/organic/callback';
const FRONTEND_URL = 'https://app.example.test/social/settings';

function stateHash(state: string) {
  return createHash('sha256').update(state).digest('hex');
}

function connectionRow(
  overrides: Partial<SocialOrganicConnectionEntity> = {},
): SocialOrganicConnectionEntity {
  return {
    id: 'connection-id',
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    agencyClientId: 'client-a',
    provider: PROVIDER,
    connectionStatus: 'pending',
    authorizationMethod: 'oauth_user',
    credentialVersion: 1,
    accessTokenEncrypted: null,
    refreshTokenEncrypted: null,
    tokenExpiresAt: null,
    scopes: ['publish'],
    oauthStateHash: stateHash('valid-state'),
    oauthExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
    createdById: 'user-a',
    lastError: null,
    metadata: {},
    credentialRemovedAt: null,
    assets: [],
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  };
}

function queryBuilder(
  getOneResults: unknown[] = [],
  getManyResults: unknown[] = [],
) {
  const ones = [...getOneResults];
  const many = [...getManyResults];
  const builder: Record<string, jest.Mock> = {};

  for (const method of ['addSelect', 'where', 'andWhere', 'setLock']) {
    builder[method] = jest.fn(() => builder);
  }

  builder.getOne = jest.fn(async () => ones.shift() ?? null);
  builder.getMany = jest.fn(async () => many.shift() ?? []);

  return builder;
}

function providerHooks(
  overrides: Partial<SocialOrganicOAuthProviderHooks> = {},
): SocialOrganicOAuthProviderHooks {
  return {
    configuration: {
      provider: PROVIDER,
      authorizationMethod: 'oauth_user',
      scopes: ['publish'],
      loginConfig: { clientId: 'client-id' },
      callbackUrl: new URL(CALLBACK_URL),
      frontendRedirectUrl: new URL(FRONTEND_URL),
    },
    buildAuthorizationUrl: jest.fn(({ callbackUrl, state }) => {
      const url = new URL('https://authorize.example.test/oauth');
      url.searchParams.set('redirect_uri', callbackUrl.toString());
      url.searchParams.set('state', state);
      return url;
    }),
    exchangeCode: jest.fn(async () => ({
      accessToken: 'connection-token',
      refreshToken: 'refresh-token',
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })),
    discoverAssets: jest.fn(async () => [
      {
        externalAssetId: 'asset-external-1',
        assetType: 'profile',
        displayName: 'Primary profile',
        capabilities: { publish: true },
        selectionData: { providerReference: 'safe-reference' },
      },
    ]),
    prepareAsset: jest.fn(async () => ({
      accessToken: null,
      metadata: { selected: true },
    })),
    ...overrides,
  };
}

function createHarness(
  options: {
    connectionResults?: unknown[];
    assetResults?: unknown[];
    hooks?: SocialOrganicOAuthProviderHooks;
    crypto?: SettingsCryptoService;
  } = {},
) {
  const connectionBuilder = queryBuilder(options.connectionResults);
  const assetBuilder = queryBuilder([], options.assetResults);
  const savedConnections: SocialOrganicConnectionEntity[] = [];
  const savedAssets: SocialOrganicAssetEntity[] = [];
  const transactionConnections = {
    createQueryBuilder: jest.fn(() => connectionBuilder),
    save: jest.fn(async (row: SocialOrganicConnectionEntity) => {
      savedConnections.push(row);
      return row;
    }),
  };
  const transactionAssets = {
    createQueryBuilder: jest.fn(() => assetBuilder),
    create: jest.fn((row: Partial<SocialOrganicAssetEntity>) => ({
      id: 'asset-id',
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: new Date('2026-09-01T00:00:00.000Z'),
      ...row,
    })),
    save: jest.fn(async (rows: SocialOrganicAssetEntity[]) => {
      savedAssets.push(...rows);
      return rows;
    }),
  };
  const startRepository = {
    create: jest.fn((row: Partial<SocialOrganicConnectionEntity>) => ({
      id: 'new-connection-id',
      assets: [],
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: new Date('2026-09-01T00:00:00.000Z'),
      ...row,
    })),
    save: jest.fn(async (row: SocialOrganicConnectionEntity) => row),
    delete: jest.fn(async (criteria: unknown) => {
      void criteria;
      return { affected: 1 };
    }),
  };
  const dataSource = {
    transaction: jest.fn(async (callback: (manager: unknown) => unknown) =>
      callback({
        getRepository: (entity: unknown) =>
          entity === SocialOrganicConnectionEntity
            ? transactionConnections
            : transactionAssets,
      }),
    ),
  };
  const hooks = options.hooks ?? providerHooks();
  const registry = new SocialOrganicOAuthProviderRegistry([hooks]);
  const crypto = options.crypto ?? new SettingsCryptoService();
  const credentialResolver = new SocialOrganicCredentialResolver(
    {} as Repository<SocialOrganicAssetEntity>,
    {} as Repository<SocialOrganicConnectionEntity>,
    crypto,
  );
  const service = new SocialOrganicOAuthService(
    startRepository as unknown as Repository<SocialOrganicConnectionEntity>,
    dataSource as unknown as DataSource,
    crypto,
    credentialResolver,
    registry,
  );

  return {
    service,
    hooks,
    crypto,
    connectionBuilder,
    assetBuilder,
    startRepository,
    transactionConnections,
    savedAssets,
  };
}

describe('SocialOrganicOAuthService', () => {
  const originalKey = process.env.SETTINGS_ENCRYPTION_KEY;

  beforeAll(() => {
    process.env.SETTINGS_ENCRYPTION_KEY = 'organic-oauth-test-key';
  });

  afterAll(() => {
    if (originalKey === undefined) delete process.env.SETTINGS_ENCRYPTION_KEY;
    else process.env.SETTINGS_ENCRYPTION_KEY = originalKey;
  });

  it('starts with 32 random bytes, persisted only as a hash, after discarding in-flight state', async () => {
    const harness = createHarness();

    const result = await harness.service.start({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: null,
      userId: 'user-a',
      provider: PROVIDER,
    });

    const state = new URL(result.authorizationUrl).searchParams.get('state')!;
    const persisted = harness.startRepository.create.mock.calls[0][0];

    expect(Buffer.from(state, 'base64url')).toHaveLength(32);
    expect(persisted.oauthStateHash).toBe(stateHash(state));
    expect(JSON.stringify(persisted)).not.toContain(state);
    const discarded = harness.startRepository.delete.mock.calls[0][0] as {
      tenantId: string;
      workspaceId: string;
      agencyClientId: unknown;
      provider: string;
    };
    expect(discarded).toMatchObject({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      provider: PROVIDER,
    });
    expect(discarded.agencyClientId).toBeDefined();
    const authorizationCall = (
      harness.hooks.buildAuthorizationUrl as jest.MockedFunction<
        SocialOrganicOAuthProviderHooks['buildAuthorizationUrl']
      >
    ).mock.calls[0][0];
    expect(authorizationCall.loginConfig).toEqual({ clientId: 'client-id' });
    expect(authorizationCall.callbackUrl).toEqual(new URL(CALLBACK_URL));
  });

  it('requires an authenticated creator before starting authorization', async () => {
    const harness = createHarness();

    await expect(
      harness.service.start({
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        agencyClientId: null,
        userId: null,
        provider: PROVIDER,
      }),
    ).rejects.toThrow('creator_required');

    expect(harness.startRepository.save).not.toHaveBeenCalled();
  });

  it('completes the callback with encrypted credentials and explicit asset selection', async () => {
    const row = connectionRow();
    const harness = createHarness({ connectionResults: [row] });

    const redirect = await harness.service.handleCallback({
      provider: PROVIDER,
      state: 'valid-state',
      code: 'authorization-code',
    });

    expect(row.connectionStatus).toBe('awaiting_selection');
    expect(row.oauthStateHash).toBeNull();
    expect(harness.crypto.decrypt(row.accessTokenEncrypted)).toBe(
      'connection-token',
    );
    expect(JSON.stringify(row.metadata)).not.toContain('connection-token');
    expect(new URL(redirect).searchParams.get('status')).toBe('select_assets');
  });

  describe.each([
    {
      name: 'unknown state',
      row: null,
      input: { state: 'unknown-state', code: 'code' },
      reason: 'invalid_state',
    },
    {
      name: 'consumed connection',
      row: connectionRow({ connectionStatus: 'connected' }),
      input: { state: 'valid-state', code: 'code' },
      reason: 'connection_consumed',
    },
    {
      name: 'expired session',
      row: connectionRow({ oauthExpiresAt: new Date(Date.now() - 1) }),
      input: { state: 'valid-state', code: 'code' },
      reason: 'session_expired',
    },
    {
      name: 'denied grant',
      row: connectionRow(),
      input: { state: 'valid-state', error: 'raw-provider-error' },
      reason: 'oauth_denied',
    },
    {
      name: 'missing code',
      row: connectionRow(),
      input: { state: 'valid-state' },
      reason: 'missing_code',
    },
  ])('callback failure: $name', ({ row, input, reason }) => {
    it(`redirects with ${reason}`, async () => {
      const harness = createHarness({ connectionResults: [row] });
      const redirect = await harness.service.handleCallback({
        provider: PROVIDER,
        ...input,
      });

      expect(new URL(redirect).searchParams.get('reason')).toBe(reason);
      expect(redirect).not.toContain('raw-provider-error');
    });
  });

  it('rejects an unacceptable state before opening a transaction', async () => {
    const harness = createHarness();
    const redirect = await harness.service.handleCallback({
      provider: PROVIDER,
      state: 'x'.repeat(513),
      code: 'code',
    });

    expect(new URL(redirect).searchParams.get('reason')).toBe('invalid_state');
    expect(
      harness.transactionConnections.createQueryBuilder,
    ).not.toHaveBeenCalled();
  });

  it.each([
    [
      'token_exchange_failed',
      {
        exchangeCode: jest.fn(async () => {
          throw new Error('secret');
        }),
      },
    ],
    [
      'asset_discovery_failed',
      {
        discoverAssets: jest.fn(async () => {
          throw new Error('secret');
        }),
      },
    ],
    ['no_assets_available', { discoverAssets: jest.fn(async () => []) }],
  ] as const)(
    'uses the safe %s callback reason',
    async (reason, hookOverrides) => {
      const row = connectionRow();
      const harness = createHarness({
        connectionResults: [row],
        hooks: providerHooks(hookOverrides),
      });
      const redirect = await harness.service.handleCallback({
        provider: PROVIDER,
        state: 'valid-state',
        code: 'code',
      });

      expect(new URL(redirect).searchParams.get('reason')).toBe(reason);
      expect(redirect).not.toContain('secret');
      expect(row.accessTokenEncrypted).toBeNull();
    },
  );

  it('uses a safe code when credential encryption fails', async () => {
    const row = connectionRow();
    const crypto = new SettingsCryptoService();
    jest.spyOn(crypto, 'encrypt').mockImplementation(() => null as never);
    const harness = createHarness({ connectionResults: [row], crypto });

    const redirect = await harness.service.handleCallback({
      provider: PROVIDER,
      state: 'valid-state',
      code: 'code',
    });

    expect(new URL(redirect).searchParams.get('reason')).toBe(
      'credential_encryption_failed',
    );
  });

  it('never throws when the callback infrastructure fails unexpectedly', async () => {
    const harness = createHarness();
    jest
      .spyOn(harness.service['dataSource'], 'transaction')
      .mockRejectedValueOnce(new Error('database details'));

    const redirect = await harness.service.handleCallback({
      provider: PROVIDER,
      state: 'valid-state',
      code: 'code',
    });

    expect(new URL(redirect).searchParams.get('reason')).toBe(
      'callback_failed',
    );
    expect(redirect).not.toContain('database details');
  });

  it('never throws for an unregistered callback provider', async () => {
    const harness = createHarness();
    const redirect = await harness.service.handleCallback({
      provider: 'unregistered',
      state: 'valid-state',
      code: 'code',
    });

    expect(redirect).toContain('reason=provider_not_configured');
  });

  it('binds only explicitly selected assets and returns a credential-free view', async () => {
    const crypto = new SettingsCryptoService();
    const row = connectionRow({
      connectionStatus: 'awaiting_selection',
      oauthStateHash: null,
      accessTokenEncrypted: crypto.encrypt('connection-token'),
      metadata: {
        selectableAssets: [
          {
            externalAssetId: 'asset-external-1',
            assetType: 'profile',
            displayName: 'Primary profile',
            capabilities: { publish: true },
            selectionData: { providerReference: 'safe-reference' },
          },
        ],
      },
    });
    const harness = createHarness({
      connectionResults: [row],
      assetResults: [[]],
      crypto,
    });

    const view = await harness.service.select({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: 'client-a',
      userId: 'user-a',
      provider: PROVIDER,
      connectionId: row.id,
      externalAssetIds: ['asset-external-1'],
    });

    expect(row.connectionStatus).toBe('connected');
    expect(harness.savedAssets).toHaveLength(1);
    expect(harness.savedAssets[0].isPublishEnabled).toBe(true);
    expect(harness.savedAssets[0].assetTimezone).toBeNull();
    const preparationCall = (
      harness.hooks.prepareAsset as jest.MockedFunction<
        SocialOrganicOAuthProviderHooks['prepareAsset']
      >
    ).mock.calls[0][0];
    expect(preparationCall.accessToken).toBe('connection-token');
    expect(preparationCall.asset.externalAssetId).toBe('asset-external-1');
    expect(preparationCall.asset.selectionData).toEqual({
      providerReference: 'safe-reference',
    });
    expect(JSON.stringify(view)).not.toContain('connection-token');
    expect(view.assets[0].maskedExternalAssetId).not.toBe('asset-external-1');
  });

  it('persists a canonical provider-confirmed timezone without leaking provider metadata', async () => {
    const crypto = new SettingsCryptoService();
    const row = connectionRow({
      connectionStatus: 'awaiting_selection',
      oauthStateHash: null,
      accessTokenEncrypted: crypto.encrypt('connection-token'),
      metadata: {
        selectableAssets: [
          {
            externalAssetId: 'asset-external-1',
            assetType: 'profile',
            selectionData: { providerReference: 'safe-reference' },
          },
        ],
      },
    });
    const hooks = providerHooks({
      prepareAsset: jest.fn(async () => ({
        assetTimezone: ' America/Sao_Paulo ',
        metadata: { timezone: 'provider-raw-must-not-be-used' },
      })),
    });
    const harness = createHarness({
      connectionResults: [row],
      assetResults: [[]],
      hooks,
      crypto,
    });

    const view = await harness.service.select({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: 'client-a',
      userId: 'user-a',
      provider: PROVIDER,
      connectionId: row.id,
      externalAssetIds: ['asset-external-1'],
    });

    expect(harness.savedAssets[0].assetTimezone).toBe('America/Sao_Paulo');
    expect(JSON.stringify(view)).not.toContain('provider-raw-must-not-be-used');
    // A1.2: assetTimezone is not a secret and the safe view exposes it.
    expect(view.assets[0].assetTimezone).toBe('America/Sao_Paulo');
  });

  it('rejects an invalid provider timezone before persisting any asset', async () => {
    const crypto = new SettingsCryptoService();
    const row = connectionRow({
      connectionStatus: 'awaiting_selection',
      oauthStateHash: null,
      accessTokenEncrypted: crypto.encrypt('connection-token'),
      metadata: {
        selectableAssets: [
          {
            externalAssetId: 'asset-external-1',
            assetType: 'profile',
          },
        ],
      },
    });
    const harness = createHarness({
      connectionResults: [row],
      assetResults: [[]],
      hooks: providerHooks({
        prepareAsset: jest.fn(async () => ({ assetTimezone: '-03:00' })),
      }),
      crypto,
    });

    await expect(
      harness.service.select({
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        agencyClientId: 'client-a',
        userId: 'user-a',
        provider: PROVIDER,
        connectionId: row.id,
        externalAssetIds: ['asset-external-1'],
      }),
    ).rejects.toThrow('asset_preparation_failed');

    expect(harness.savedAssets).toHaveLength(0);
  });

  it('never treats provider metadata as a timezone source', async () => {
    const crypto = new SettingsCryptoService();
    const row = connectionRow({
      connectionStatus: 'awaiting_selection',
      oauthStateHash: null,
      accessTokenEncrypted: crypto.encrypt('connection-token'),
      metadata: {
        selectableAssets: [
          {
            externalAssetId: 'asset-external-1',
            assetType: 'profile',
          },
        ],
      },
    });
    const harness = createHarness({
      connectionResults: [row],
      assetResults: [[]],
      hooks: providerHooks({
        prepareAsset: jest.fn(async () => ({
          metadata: { timezone: 'America/New_York' },
        })),
      }),
      crypto,
    });

    await harness.service.select({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: 'client-a',
      userId: 'user-a',
      provider: PROVIDER,
      connectionId: row.id,
      externalAssetIds: ['asset-external-1'],
    });

    expect(harness.savedAssets[0].assetTimezone).toBeNull();
  });

  it('refuses cross-tenant asset selection as an invalid connection', async () => {
    const harness = createHarness({ connectionResults: [null] });

    await expect(
      harness.service.select({
        tenantId: 'tenant-b',
        workspaceId: 'workspace-b',
        agencyClientId: null,
        userId: 'user-b',
        provider: PROVIDER,
        connectionId: 'connection-id',
        externalAssetIds: ['asset-external-1'],
      }),
    ).rejects.toThrow('invalid_connection');

    expect(harness.connectionBuilder.setLock).toHaveBeenCalledWith(
      'pessimistic_write',
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const prepareAsset = harness.hooks.prepareAsset as jest.Mock;
    expect(prepareAsset).not.toHaveBeenCalled();
  });

  it('refuses selection by a different creator', async () => {
    const harness = createHarness({
      connectionResults: [
        connectionRow({ connectionStatus: 'awaiting_selection' }),
      ],
    });

    await expect(
      harness.service.select({
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        agencyClientId: 'client-a',
        userId: 'user-b',
        provider: PROVIDER,
        connectionId: 'connection-id',
        externalAssetIds: ['asset-external-1'],
      }),
    ).rejects.toThrow('invalid_connection');
  });
});
