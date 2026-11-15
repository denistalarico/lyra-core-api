import type { Repository } from 'typeorm';
import { SettingsCryptoService } from '../../../common/crypto/settings-crypto.service';
import {
  GoogleCredentialError,
  type GoogleCredentialErrorCode,
  type SocialGoogleAuthorizationService,
} from '../../social-google/social-google-authorization.service';
import { classifyOrganicSyncFailure } from '../analytics/social-organic-sync-retry';
import {
  SocialOrganicOAuthProviderRegistry,
  SocialOrganicOAuthRefreshError,
  type SocialOrganicOAuthProviderHooks,
} from '../connections/social-organic-oauth.provider';
import type {
  SocialOrganicAssetEntity,
  SocialOrganicConnectionEntity,
} from '../entities';
import { SocialOrganicCredentialError } from './social-organic-credential.error';
import { SocialOrganicCredentialResolver } from './social-organic-credential.resolver';

// `youtube` becomes a Google product only in YT1-BE; the branch is exercised
// here through the same lookup the resolver uses.
jest.mock('./social-organic-google-products', () => ({
  googleProductForOrganicProvider: (provider: string) =>
    provider === 'youtube' ? 'youtube' : null,
}));

const TENANT = '11111111-1111-1111-1111-111111111111';
const WORKSPACE = '33333333-3333-3333-3333-333333333333';
const MANAGED_CLIENT = '44444444-4444-4444-4444-444444444444';
const CONTEXT = '55555555-5555-5555-5555-555555555555';
const PROVIDER = 'network_alpha';

const originalKey = process.env.SETTINGS_ENCRYPTION_KEY;
beforeAll(() => {
  process.env.SETTINGS_ENCRYPTION_KEY = 'organic-refresh-spec-key';
});
afterAll(() => {
  if (originalKey === undefined) delete process.env.SETTINGS_ENCRYPTION_KEY;
  else process.env.SETTINGS_ENCRYPTION_KEY = originalKey;
});

const crypto = new SettingsCryptoService();

type StoredConnection = Pick<
  SocialOrganicConnectionEntity,
  | 'id'
  | 'tenantId'
  | 'workspaceId'
  | 'agencyClientId'
  | 'provider'
  | 'connectionStatus'
  | 'authorizationMethod'
  | 'credentialVersion'
  | 'accessTokenEncrypted'
  | 'refreshTokenEncrypted'
  | 'tokenExpiresAt'
  | 'scopes'
  | 'lastError'
  | 'credentialRemovedAt'
>;

function storedConnection(
  overrides: Partial<StoredConnection> = {},
): StoredConnection {
  return {
    id: 'connection-id',
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    agencyClientId: null,
    provider: PROVIDER,
    connectionStatus: 'connected',
    authorizationMethod: 'oauth_user',
    credentialVersion: 4,
    accessTokenEncrypted: crypto.encrypt('stale-token'),
    refreshTokenEncrypted: crypto.encrypt('refresh-token'),
    // Inside the five-minute refresh window.
    tokenExpiresAt: new Date(Date.now() + 2 * 60_000),
    scopes: ['publish'],
    lastError: null,
    credentialRemovedAt: null,
    ...overrides,
  };
}

function assetFor(
  connection: StoredConnection,
  overrides: Partial<SocialOrganicAssetEntity> = {},
): SocialOrganicAssetEntity {
  return {
    id: 'asset-id',
    tenantId: connection.tenantId,
    workspaceId: connection.workspaceId,
    agencyClientId: connection.agencyClientId,
    companyContextId: null,
    connectionId: connection.id,
    // The asset load carries no token columns, exactly like `findInScope`.
    connection: {
      ...connection,
      accessTokenEncrypted: undefined,
      refreshTokenEncrypted: undefined,
    },
    provider: connection.provider,
    assetType: 'profile',
    externalAssetId: 'external-1',
    status: 'active',
    isPublishEnabled: true,
    lastHealthStatus: null,
    assetTimezone: null,
    ...overrides,
  } as unknown as SocialOrganicAssetEntity;
}

function hooks(
  refresh?: SocialOrganicOAuthProviderHooks['refreshAccessToken'],
): SocialOrganicOAuthProviderHooks {
  return {
    configuration: {
      provider: PROVIDER,
      authorizationMethod: 'oauth_user',
      scopes: ['publish'],
      loginConfig: { clientId: 'client' },
      callbackUrl: new URL('https://api.example.test/callback'),
      frontendRedirectUrl: new URL('https://app.example.test/social'),
    },
    buildAuthorizationUrl: () => 'https://authorize.example.test',
    exchangeCode: async () => ({ accessToken: 'unused' }),
    discoverAssets: async () => [],
    prepareAsset: async () => ({}),
    ...(refresh ? { refreshAccessToken: refresh } : {}),
  };
}

/**
 * The connection row behind a serialized transaction double: the second
 * transaction starts only after the first commits, which is what the
 * `FOR UPDATE` lock gives the real resolver.
 */
function harness(input: {
  stored: StoredConnection;
  asset?: SocialOrganicAssetEntity;
  hooks?: SocialOrganicOAuthProviderHooks;
  google?: Partial<SocialGoogleAuthorizationService>;
  transactionError?: unknown;
}) {
  const stored = input.stored;
  const asset = input.asset ?? assetFor(stored);
  const locks: string[] = [];
  const saves: StoredConnection[] = [];

  const lockedRepository = {
    createQueryBuilder: jest.fn(() => {
      const builder: Record<string, jest.Mock> = {};
      for (const method of ['addSelect', 'where', 'andWhere']) {
        builder[method] = jest.fn(() => builder);
      }
      builder.setLock = jest.fn((mode: string) => {
        locks.push(mode);
        return builder;
      });
      builder.getOne = jest.fn(async () => ({ ...stored }));
      return builder;
    }),
    save: jest.fn(async (entity: StoredConnection) => {
      Object.assign(stored, entity);
      saves.push({ ...entity });
      return entity;
    }),
  };
  let tail: Promise<unknown> = Promise.resolve();
  const manager = {
    query: jest.fn(async () => undefined),
    getRepository: jest.fn(() => lockedRepository),
  };
  const transaction = jest.fn(
    <T>(work: (m: typeof manager) => Promise<T>): Promise<T> => {
      if (input.transactionError) {
        return Promise.reject(input.transactionError as Error);
      }
      const result = tail.then(() => work(manager));
      tail = result.catch(() => undefined);
      return result;
    },
  );

  // The plain (no refresh) path reads the token through this builder.
  const plainBuilder: Record<string, jest.Mock> = {};
  for (const method of ['select', 'where', 'andWhere']) {
    plainBuilder[method] = jest.fn(() => plainBuilder);
  }
  plainBuilder.getOne = jest.fn(async () => ({ ...stored }));

  const assets = { findOne: jest.fn(async () => asset) };
  const connections = {
    createQueryBuilder: jest.fn(() => plainBuilder),
    manager: { transaction },
  };

  return {
    stored,
    locks,
    saves,
    manager,
    transaction,
    resolver: new SocialOrganicCredentialResolver(
      assets as unknown as Repository<SocialOrganicAssetEntity>,
      connections as unknown as Repository<SocialOrganicConnectionEntity>,
      crypto,
      new SocialOrganicOAuthProviderRegistry(input.hooks ? [input.hooks] : []),
      input.google as SocialGoogleAuthorizationService | undefined,
    ),
  };
}

const scope = {
  tenantId: TENANT,
  workspaceId: WORKSPACE,
  agencyClientId: null,
  companyContextId: null,
  assetId: 'asset-id',
};

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(SocialOrganicCredentialError);
  await expect(promise).rejects.toMatchObject({ code, message: code });
}

function grantRefresh() {
  return jest.fn(async () => ({
    accessToken: 'fresh-token',
    refreshToken: 'rotated-refresh-token',
    tokenExpiresAt: new Date(Date.now() + 60 * 60_000),
  }));
}

describe('organic token refresh (D-I5)', () => {
  it('two concurrent resolves spend a single refresh', async () => {
    const refresh = grantRefresh();
    const context = harness({
      stored: storedConnection(),
      hooks: hooks(refresh),
    });

    await Promise.all([
      context.resolver.resolve(scope),
      context.resolver.resolve(scope),
    ]);

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('the concurrent loser reuses the token the winner stored', async () => {
    const context = harness({
      stored: storedConnection(),
      hooks: hooks(grantRefresh()),
    });

    const [first, second] = await Promise.all([
      context.resolver.resolve(scope),
      context.resolver.resolve(scope),
    ]);

    expect([first.accessToken, second.accessToken]).toEqual([
      'fresh-token',
      'fresh-token',
    ]);
  });

  it('both concurrent callers see the one incremented credential version', async () => {
    const context = harness({
      stored: storedConnection(),
      hooks: hooks(grantRefresh()),
    });

    const [first, second] = await Promise.all([
      context.resolver.resolve(scope),
      context.resolver.resolve(scope),
    ]);

    expect([first.credentialVersion, second.credentialVersion]).toEqual([5, 5]);
  });

  it('reads the row under a pessimistic write lock', async () => {
    const context = harness({
      stored: storedConnection(),
      hooks: hooks(grantRefresh()),
    });

    await context.resolver.resolve(scope);

    expect(context.locks).toEqual(['pessimistic_write']);
  });

  it('bounds the lock wait inside the transaction', async () => {
    const context = harness({
      stored: storedConnection(),
      hooks: hooks(grantRefresh()),
    });

    await context.resolver.resolve(scope);

    expect(context.manager.query).toHaveBeenCalledWith(
      'SET LOCAL lock_timeout = 15000',
    );
  });

  it('hands the hook the decrypted refresh token and the provider config', async () => {
    const refresh = grantRefresh();
    const context = harness({
      stored: storedConnection(),
      hooks: hooks(refresh),
    });

    await context.resolver.resolve(scope);

    expect(refresh).toHaveBeenCalledWith({
      loginConfig: { clientId: 'client' },
      refreshToken: 'refresh-token',
    });
  });

  it('stores the new access token encrypted', async () => {
    const context = harness({
      stored: storedConnection(),
      hooks: hooks(grantRefresh()),
    });

    await context.resolver.resolve(scope);

    expect(crypto.decrypt(context.stored.accessTokenEncrypted)).toBe(
      'fresh-token',
    );
  });

  it('stores the rotated refresh token encrypted', async () => {
    const context = harness({
      stored: storedConnection(),
      hooks: hooks(grantRefresh()),
    });

    await context.resolver.resolve(scope);

    expect(crypto.decrypt(context.stored.refreshTokenEncrypted)).toBe(
      'rotated-refresh-token',
    );
  });

  it('keeps the stored refresh token when the provider does not rotate it', async () => {
    const context = harness({
      stored: storedConnection(),
      hooks: hooks(async () => ({
        accessToken: 'fresh-token',
        tokenExpiresAt: new Date(Date.now() + 60 * 60_000),
      })),
    });

    await context.resolver.resolve(scope);

    expect(crypto.decrypt(context.stored.refreshTokenEncrypted)).toBe(
      'refresh-token',
    );
  });

  it('never writes a plaintext token to the row', async () => {
    const context = harness({
      stored: storedConnection(),
      hooks: hooks(grantRefresh()),
    });

    await context.resolver.resolve(scope);

    expect(JSON.stringify(context.saves)).not.toMatch(
      /fresh-token|rotated-refresh-token/,
    );
  });

  it('does not refresh a token that is still outside the window', async () => {
    const refresh = grantRefresh();
    const context = harness({
      stored: storedConnection({
        tokenExpiresAt: new Date(Date.now() + 60 * 60_000),
      }),
      hooks: hooks(refresh),
    });

    await context.resolver.resolve(scope);

    expect(refresh).not.toHaveBeenCalled();
  });

  it('a provider without the hook keeps the plain expiry refusal', async () => {
    const context = harness({
      stored: storedConnection({ tokenExpiresAt: new Date(Date.now() - 1) }),
      hooks: hooks(),
    });

    await expectCode(context.resolver.resolve(scope), 'credential_removed');
  });

  it('a permanent refusal becomes credential_expired', async () => {
    const context = harness({
      stored: storedConnection(),
      hooks: hooks(async () => {
        throw new SocialOrganicOAuthRefreshError('permanent');
      }),
    });

    await expectCode(context.resolver.resolve(scope), 'credential_expired');
  });

  it('a permanent refusal wipes the dead credential and flags the connection', async () => {
    const context = harness({
      stored: storedConnection(),
      hooks: hooks(async () => {
        throw new SocialOrganicOAuthRefreshError('permanent');
      }),
    });

    await context.resolver.resolve(scope).catch(() => undefined);

    expect(context.stored).toMatchObject({
      connectionStatus: 'error',
      lastError: 'credential_expired',
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
    });
  });

  it('a missing refresh token becomes credential_expired', async () => {
    const context = harness({
      stored: storedConnection({ refreshTokenEncrypted: null }),
      hooks: hooks(grantRefresh()),
    });

    await expectCode(context.resolver.resolve(scope), 'credential_expired');
  });

  it('a transient failure is retryable and leaves the row untouched', async () => {
    const context = harness({
      stored: storedConnection(),
      hooks: hooks(async () => {
        throw new Error('provider timeout with secret detail');
      }),
    });

    await expectCode(
      context.resolver.resolve(scope),
      'credential_refresh_failed',
    );
    expect(context.saves).toEqual([]);
  });

  it('a lock wait timeout is a transient refusal without driver detail', async () => {
    const context = harness({
      stored: storedConnection(),
      hooks: hooks(grantRefresh()),
      transactionError: Object.assign(new Error('canceling statement'), {
        code: '55P03',
      }),
    });

    await expectCode(
      context.resolver.resolve(scope),
      'credential_refresh_failed',
    );
  });

  it('a disconnect that won the lock is honored without refreshing', async () => {
    const refresh = grantRefresh();
    const stored = storedConnection();
    const asset = assetFor(stored);
    stored.connectionStatus = 'disconnected';
    const context = harness({ stored, asset, hooks: hooks(refresh) });

    await expectCode(
      context.resolver.resolve(scope),
      'connection_not_connected',
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it('the sync retry policy requeues only the transient refusal', () => {
    expect([
      classifyOrganicSyncFailure(
        new SocialOrganicCredentialError('credential_refresh_failed'),
      ).retry,
      classifyOrganicSyncFailure(
        new SocialOrganicCredentialError('credential_expired'),
      ).retry,
    ]).toEqual([true, false]);
  });
});

describe('google_oauth organic credential (D-I1)', () => {
  function googleHarness(getAccessToken: jest.Mock, provider = 'youtube') {
    const stored = storedConnection({
      provider,
      authorizationMethod: 'google_oauth',
      agencyClientId: MANAGED_CLIENT,
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
      tokenExpiresAt: null,
    });
    return harness({
      stored,
      asset: assetFor(stored, {
        companyContextId: CONTEXT,
        assetType: 'youtube_channel',
      }),
      google: { getAccessToken } as Partial<SocialGoogleAuthorizationService>,
    });
  }

  const managedScope = {
    ...scope,
    agencyClientId: MANAGED_CLIENT,
    companyContextId: CONTEXT,
  };

  it('takes the token from getAccessToken with the persisted scope', async () => {
    const getAccessToken = jest.fn(async () => ({
      accessToken: 'google-token',
      expiresAt: null,
    }));
    const context = googleHarness(getAccessToken);

    await context.resolver.resolve(managedScope);

    expect(getAccessToken).toHaveBeenCalledWith({
      scope: {
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        agencyClientId: MANAGED_CLIENT,
        companyContextId: CONTEXT,
      },
      product: 'youtube',
    });
  });

  it('returns the Google token in the resolved credential', async () => {
    const context = googleHarness(
      jest.fn(async () => ({ accessToken: 'google-token', expiresAt: null })),
    );

    const credential = await context.resolver.resolve(managedScope);

    expect(credential.accessToken).toBe('google-token');
  });

  it('never reads organic token columns for a google_oauth connection', async () => {
    const context = googleHarness(
      jest.fn(async () => ({ accessToken: 'google-token', expiresAt: null })),
    );

    await context.resolver.resolve(managedScope);

    expect(context.transaction).not.toHaveBeenCalled();
  });

  it.each<[GoogleCredentialErrorCode, string]>([
    ['not_connected', 'connection_not_connected'],
    ['product_not_connected', 'connection_not_connected'],
    ['reauth_required', 'credential_expired'],
    ['scope_not_granted', 'credential_expired'],
    ['refresh_failed', 'credential_refresh_failed'],
  ])('maps Google %s to %s', async (googleCode, organicCode) => {
    const context = googleHarness(
      jest.fn(async () => {
        throw new GoogleCredentialError(googleCode);
      }),
    );

    await expectCode(context.resolver.resolve(managedScope), organicCode);
  });

  it('sanitizes an unexpected failure as transient', async () => {
    const context = googleHarness(
      jest.fn(async () => {
        throw new Error('driver detail');
      }),
    );

    await expectCode(
      context.resolver.resolve(managedScope),
      'credential_refresh_failed',
    );
  });

  it('refuses a provider with no Google product without calling Google', async () => {
    const getAccessToken = jest.fn();
    const context = googleHarness(getAccessToken, PROVIDER);

    await expectCode(
      context.resolver.resolve(managedScope),
      'unsupported_authorization_method',
    );
    expect(getAccessToken).not.toHaveBeenCalled();
  });
});
