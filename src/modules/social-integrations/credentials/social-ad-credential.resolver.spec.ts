import { inspect } from 'node:util';
import { Repository } from 'typeorm';
import { SettingsCryptoService } from '../../../common/crypto/settings-crypto.service';
import { SocialAdAccountConnectionEntity } from '../entities/social-ad-account-connection.entity';
import { SocialInternalAccessService } from '../internal/social-internal-access.service';
import { SocialAdCredentialError } from './social-ad-credential.error';
import { SocialAdCredentialResolver } from './social-ad-credential.resolver';

const INTERNAL_TENANT = '11111111-1111-1111-1111-111111111111';
const OTHER_TENANT = '22222222-2222-2222-2222-222222222222';
const WORKSPACE = '33333333-3333-3333-3333-333333333333';
const MANAGED_CLIENT = '44444444-4444-4444-4444-444444444444';
const INTERNAL_ACCOUNT = 'act_415877197389621';
const SYSTEM_USER_TOKEN = 'system-user-token-value';

function connection(
  overrides: Partial<SocialAdAccountConnectionEntity> = {},
): SocialAdAccountConnectionEntity {
  return {
    id: 'connection-id',
    tenantId: INTERNAL_TENANT,
    workspaceId: WORKSPACE,
    agencyClientId: null,
    provider: 'meta_ads',
    authorizationMethod: 'business_login',
    externalAccountId: 'act_1234567890',
    externalBusinessId: 'biz_1',
    accountName: 'Conta',
    currency: 'BRL',
    timezone: 'America/Sao_Paulo',
    connectionStatus: 'connected',
    credentialVersion: 3,
    accessTokenEncrypted: null,
    refreshTokenEncrypted: null,
    tokenExpiresAt: null,
    scopes: ['ads_read', 'business_management'],
    lastSyncedAt: null,
    lastSyncError: null,
    oauthStateHash: null,
    oauthExpiresAt: null,
    createdById: null,
    metadata: {},
    credentialRemovedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as SocialAdAccountConnectionEntity;
}

/**
 * Records whether the encrypted column was ever queried.
 *
 * That is the assertion the internal path needs: "never reads
 * access_token_encrypted" is only meaningful if something can observe the read.
 */
function createRepository(row: SocialAdAccountConnectionEntity | null) {
  const selects: string[] = [];
  let credentialQueries = 0;

  const queryBuilder = {
    select: (field: string) => {
      selects.push(field);
      return queryBuilder;
    },
    where: () => queryBuilder,
    getOne: () => Promise.resolve(row),
  };

  const repository = {
    findOne: () => Promise.resolve(row),
    createQueryBuilder: () => {
      credentialQueries += 1;
      return queryBuilder;
    },
  } as unknown as Repository<SocialAdAccountConnectionEntity>;

  return {
    repository,
    selects,
    get credentialQueries() {
      return credentialQueries;
    },
  };
}

function createResolver(row: SocialAdAccountConnectionEntity | null) {
  const repo = createRepository(row);
  const crypto = new SettingsCryptoService();

  return {
    crypto,
    selects: repo.selects,
    // A getter, not a spread: the count has to be read *after* the call under
    // test, and spreading would freeze it at zero.
    get credentialQueries() {
      return repo.credentialQueries;
    },
    resolver: new SocialAdCredentialResolver(
      repo.repository,
      crypto,
      new SocialInternalAccessService(),
    ),
  };
}

const agencyScope = {
  tenantId: INTERNAL_TENANT,
  workspaceId: WORKSPACE,
  agencyClientId: null,
  connectionId: 'connection-id',
};

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(SocialAdCredentialError);
  await expect(promise).rejects.toMatchObject({ code });
}

describe('SocialAdCredentialResolver', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      SOCIAL_META_ADS_INTERNAL_TENANT_ID: INTERNAL_TENANT,
      SOCIAL_META_ADS_INTERNAL_ACCOUNT_ID: INTERNAL_ACCOUNT,
      SOCIAL_META_ADS_SYSTEM_USER_TOKEN: SYSTEM_USER_TOKEN,
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('business_login', () => {
    it('decrypts the stored token and describes the account', async () => {
      const crypto = new SettingsCryptoService();
      const encrypted = crypto.encrypt('login-token-value');
      const { resolver } = createResolver(
        connection({ accessTokenEncrypted: encrypted }),
      );

      const credential = await resolver.resolve(agencyScope);

      expect(credential.accessToken).toBe('login-token-value');
      expect(credential.authorizationMethod).toBe('business_login');
      expect(credential.externalAccountId).toBe('act_1234567890');
      expect(credential.timezone).toBe('America/Sao_Paulo');
      expect(credential.currency).toBe('BRL');
      expect(credential.credentialVersion).toBe(3);
    });

    it('carries the scope the row was stored under', async () => {
      const crypto = new SettingsCryptoService();
      const { resolver } = createResolver(
        connection({
          tenantId: OTHER_TENANT,
          agencyClientId: MANAGED_CLIENT,
          accessTokenEncrypted: crypto.encrypt('client-token'),
        }),
      );

      // Every row a sync writes is written under this scope. It comes from the
      // connection, not from the caller, so a batch cannot be attributed to
      // whoever happened to ask for it.
      const credential = await resolver.resolve({
        ...agencyScope,
        tenantId: OTHER_TENANT,
        agencyClientId: MANAGED_CLIENT,
      });

      expect(credential.tenantId).toBe(OTHER_TENANT);
      expect(credential.agencyClientId).toBe(MANAGED_CLIENT);
    });

    it('refuses when the row holds no token', async () => {
      const { resolver } = createResolver(
        connection({ accessTokenEncrypted: null }),
      );

      await expectCode(resolver.resolve(agencyScope), 'token_missing');
    });

    it('refuses a token that cannot be decrypted', async () => {
      const { resolver } = createResolver(
        connection({ accessTokenEncrypted: 'not-a-valid-ciphertext' }),
      );

      // What a rotated SETTINGS_ENCRYPTION_KEY looks like from here.
      await expectCode(
        resolver.resolve(agencyScope),
        'credential_decryption_failed',
      );
    });

    it('refuses an expired token', async () => {
      const crypto = new SettingsCryptoService();
      const { resolver } = createResolver(
        connection({
          accessTokenEncrypted: crypto.encrypt('login-token-value'),
          tokenExpiresAt: new Date(Date.now() - 1_000),
        }),
      );

      await expectCode(resolver.resolve(agencyScope), 'token_expired');
    });

    it('refuses a token that expires during the read it is about to start', async () => {
      const crypto = new SettingsCryptoService();
      const resolved = createResolver(
        connection({
          accessTokenEncrypted: crypto.encrypt('login-token-value'),
          tokenExpiresAt: new Date(Date.now() + 5_000),
        }),
      );

      await expectCode(resolved.resolver.resolve(agencyScope), 'token_expired');
      // And it refuses before touching the ciphertext at all.
      expect(resolved.credentialQueries).toBe(0);
    });

    it('accepts a token with time left', async () => {
      const crypto = new SettingsCryptoService();
      const { resolver } = createResolver(
        connection({
          accessTokenEncrypted: crypto.encrypt('login-token-value'),
          tokenExpiresAt: new Date(Date.now() + 3_600_000),
        }),
      );

      await expect(resolver.resolve(agencyScope)).resolves.toMatchObject({
        authorizationMethod: 'business_login',
      });
    });

    it('loads the encrypted column explicitly, since the entity hides it', async () => {
      const crypto = new SettingsCryptoService();
      const resolved = createResolver(
        connection({ accessTokenEncrypted: crypto.encrypt('login-token') }),
      );

      await resolved.resolver.resolve(agencyScope);

      expect(resolved.selects).toEqual(['connection.accessTokenEncrypted']);
    });
  });

  describe('internal_system_user', () => {
    const internalRow = () =>
      connection({
        authorizationMethod: 'internal_system_user',
        externalAccountId: INTERNAL_ACCOUNT,
        accessTokenEncrypted: null,
      });

    it('resolves the token from server configuration', async () => {
      const { resolver } = createResolver(internalRow());

      const credential = await resolver.resolve(agencyScope);

      expect(credential.accessToken).toBe(SYSTEM_USER_TOKEN);
      expect(credential.authorizationMethod).toBe('internal_system_user');
      expect(credential.tokenExpiresAt).toBeNull();
    });

    it('never reads the encrypted column for an internal connection', async () => {
      const resolved = createResolver(
        // Even with a ciphertext sitting in the row — which S1 never writes,
        // but a future bug or a manual UPDATE could — the internal path must
        // take its token from configuration and nowhere else.
        connection({
          authorizationMethod: 'internal_system_user',
          externalAccountId: INTERNAL_ACCOUNT,
          accessTokenEncrypted: new SettingsCryptoService().encrypt('stale'),
        }),
      );

      const credential = await resolved.resolver.resolve(agencyScope);

      expect(credential.accessToken).toBe(SYSTEM_USER_TOKEN);
      expect(resolved.credentialQueries).toBe(0);
    });

    it('refuses a managed client, even inside the internal tenant', async () => {
      const { resolver } = createResolver(
        connection({
          authorizationMethod: 'internal_system_user',
          externalAccountId: INTERNAL_ACCOUNT,
          agencyClientId: MANAGED_CLIENT,
        }),
      );

      // Lending the agency's System User to a client context would hand it
      // every ad account in the agency's Business Manager.
      await expectCode(
        resolver.resolve({ ...agencyScope, agencyClientId: MANAGED_CLIENT }),
        'internal_scope_denied',
      );
    });

    it('refuses another tenant', async () => {
      const { resolver } = createResolver(
        connection({
          authorizationMethod: 'internal_system_user',
          externalAccountId: INTERNAL_ACCOUNT,
          tenantId: OTHER_TENANT,
        }),
      );

      await expectCode(
        resolver.resolve({ ...agencyScope, tenantId: OTHER_TENANT }),
        'internal_scope_denied',
      );
    });

    it('refuses when configuration now names a different account', async () => {
      process.env.SOCIAL_META_ADS_INTERNAL_ACCOUNT_ID = 'act_999999999';
      const { resolver } = createResolver(internalRow());

      // Configuration can be re-pointed after a connection was bound. The
      // account is therefore re-checked at resolve time, not only at bind time.
      await expectCode(resolver.resolve(agencyScope), 'internal_account_drift');
    });

    it('refuses when the System User token is not configured', async () => {
      delete process.env.SOCIAL_META_ADS_SYSTEM_USER_TOKEN;
      const { resolver } = createResolver(internalRow());

      await expectCode(
        resolver.resolve(agencyScope),
        'system_user_token_missing',
      );
    });

    it('refuses when the allowed account is not configured', async () => {
      delete process.env.SOCIAL_META_ADS_INTERNAL_ACCOUNT_ID;
      const { resolver } = createResolver(internalRow());

      await expectCode(
        resolver.resolve(agencyScope),
        'internal_account_not_configured',
      );
    });

    it('refuses when no internal tenant is configured at all', async () => {
      delete process.env.SOCIAL_META_ADS_INTERNAL_TENANT_ID;
      const { resolver } = createResolver(internalRow());

      // An unset internal tenant disables the exception rather than matching
      // everyone — the gate's rule, exercised through the resolver.
      await expectCode(resolver.resolve(agencyScope), 'internal_scope_denied');
    });

    it('accepts the account in either spelling', async () => {
      process.env.SOCIAL_META_ADS_INTERNAL_ACCOUNT_ID = '415877197389621';
      const { resolver } = createResolver(internalRow());

      await expect(resolver.resolve(agencyScope)).resolves.toMatchObject({
        externalAccountId: INTERNAL_ACCOUNT,
      });
    });
  });

  describe('connection state', () => {
    it('reports a connection outside the scope as not found', async () => {
      const { resolver } = createResolver(null);

      await expectCode(resolver.resolve(agencyScope), 'connection_not_found');
    });

    it('refuses a disconnected connection', async () => {
      const { resolver } = createResolver(
        connection({ connectionStatus: 'disconnected' }),
      );

      await expectCode(
        resolver.resolve(agencyScope),
        'connection_not_connected',
      );
    });

    it('refuses a connection still awaiting account selection', async () => {
      const { resolver } = createResolver(
        connection({ connectionStatus: 'awaiting_selection' }),
      );

      await expectCode(
        resolver.resolve(agencyScope),
        'connection_not_connected',
      );
    });

    it('refuses a connection whose credential was removed', async () => {
      const { resolver } = createResolver(
        connection({ credentialRemovedAt: new Date() }),
      );

      await expectCode(resolver.resolve(agencyScope), 'credential_removed');
    });

    it('refuses a connection with no account bound', async () => {
      const { resolver } = createResolver(
        connection({ externalAccountId: null }),
      );

      await expectCode(resolver.resolve(agencyScope), 'account_not_bound');
    });

    it('refuses a malformed account id rather than passing it to a provider', async () => {
      const { resolver } = createResolver(
        connection({ externalAccountId: 'act_not_digits' }),
      );

      await expectCode(resolver.resolve(agencyScope), 'account_not_bound');
    });

    it('refuses a provider with no reader', async () => {
      const { resolver } = createResolver(
        connection({ provider: 'google_ads' }),
      );

      await expectCode(resolver.resolve(agencyScope), 'unsupported_provider');
    });

    it('refuses an authorization method it does not know', async () => {
      const { resolver } = createResolver(
        connection({
          authorizationMethod: 'something_new' as never,
        }),
      );

      await expectCode(
        resolver.resolve(agencyScope),
        'unsupported_authorization_method',
      );
    });
  });

  describe('timezone', () => {
    it('refuses a connection with no timezone', async () => {
      const { resolver } = createResolver(connection({ timezone: null }));

      await expectCode(resolver.resolve(agencyScope), 'timezone_missing');
    });

    it('refuses a timezone this runtime does not know', async () => {
      const { resolver } = createResolver(
        connection({ timezone: 'Mars/Phobos' }),
      );

      await expectCode(resolver.resolve(agencyScope), 'timezone_unsupported');
    });

    it('does not fall back to UTC', async () => {
      const { resolver } = createResolver(connection({ timezone: '  ' }));

      // Reading America/Sao_Paulo as UTC moves every evening's spend to the
      // next day. Failing here is cheaper than a metrics table nobody trusts.
      await expect(resolver.resolve(agencyScope)).rejects.toBeInstanceOf(
        SocialAdCredentialError,
      );
    });
  });

  describe('the token never travels as data', () => {
    it('is absent from a serialized credential', async () => {
      const crypto = new SettingsCryptoService();
      const { resolver } = createResolver(
        connection({ accessTokenEncrypted: crypto.encrypt('login-token') }),
      );

      const credential = await resolver.resolve(agencyScope);

      expect(JSON.stringify(credential)).not.toContain('login-token');
      expect(JSON.stringify(credential)).toContain('[REDACTED]');
    });

    it('is absent from the internal credential too', async () => {
      const { resolver } = createResolver(
        connection({
          authorizationMethod: 'internal_system_user',
          externalAccountId: INTERNAL_ACCOUNT,
        }),
      );

      const credential = await resolver.resolve(agencyScope);

      expect(JSON.stringify(credential)).not.toContain(SYSTEM_USER_TOKEN);
    });

    it('survives being logged, including with hidden properties shown', async () => {
      // End-to-end version of the value-object test: a real decrypted token,
      // through the real resolver, into the call a logger actually makes.
      const crypto = new SettingsCryptoService();
      const { resolver } = createResolver(
        connection({ accessTokenEncrypted: crypto.encrypt('login-token') }),
      );

      const credential = await resolver.resolve(agencyScope);
      const printed = inspect(credential, { showHidden: true, depth: null });

      expect(printed).not.toContain('login-token');
      expect(printed).toContain('[REDACTED]');
    });

    it('is dropped by spreading, which is how DTOs get built', async () => {
      const { resolver } = createResolver(
        connection({
          authorizationMethod: 'internal_system_user',
          externalAccountId: INTERNAL_ACCOUNT,
        }),
      );

      const credential = await resolver.resolve(agencyScope);
      const spread = { ...credential } as Record<string, unknown>;

      expect(spread.accessToken).toBeUndefined();
      expect(Object.keys(spread)).not.toContain('accessToken');
    });

    it('never appears in a refusal', async () => {
      process.env.SOCIAL_META_ADS_INTERNAL_ACCOUNT_ID = 'act_999999999';
      const { resolver } = createResolver(
        connection({
          authorizationMethod: 'internal_system_user',
          externalAccountId: INTERNAL_ACCOUNT,
        }),
      );

      const error = await resolver
        .resolve(agencyScope)
        .catch((thrown: SocialAdCredentialError) => thrown);

      expect(error).toBeInstanceOf(SocialAdCredentialError);

      const thrown = error as SocialAdCredentialError;

      expect(`${thrown.name}: ${thrown.message}`).not.toContain(
        SYSTEM_USER_TOKEN,
      );
      expect(thrown.stack ?? '').not.toContain(SYSTEM_USER_TOKEN);
      // The whole message is the code: there is no free-text half to leak into.
      expect((error as SocialAdCredentialError).message).toBe(
        'internal_account_drift',
      );
    });
  });
});
