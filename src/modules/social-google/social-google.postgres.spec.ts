import { ConflictException, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import type { CompanyAwareScope } from '../../common/context/company-aware-scope';
import { SettingsCryptoService } from '../../common/crypto/settings-crypto.service';
import { CreateSocialGoogleOAuth1803700000000 } from '../../database/migrations/1803700000000-create-social-google-oauth';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import {
  GoogleOAuthClient,
  GoogleOAuthError,
  type GoogleTokenSet,
} from './google-oauth.client';
import { GOOGLE_PRODUCT_SCOPES } from './google-oauth.constants';
import {
  SocialGoogleAuditEventEntity,
  SocialGoogleAuthorizationEntity,
  SocialGoogleOAuthSessionEntity,
  SocialGoogleProductLinkEntity,
} from './entities';
import {
  GoogleCredentialError,
  SocialGoogleAuthorizationService,
} from './social-google-authorization.service';
import { SocialGoogleOAuthService } from './social-google-oauth.service';

const run = describePostgresIntegration();

const CLIENT_ID = 'cid.apps.googleusercontent.com';
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Grant = {
  sub: string;
  scopes: string[];
  refreshToken: string | null;
  accessToken: string;
};

/** Google double: nothing here performs network I/O. */
class FakeGoogle extends GoogleOAuthClient {
  lastRequest: { state: string; nonce: string } | null = null;
  nextGrant: Grant | null = null;
  tamperIdToken: Record<string, unknown> = {};
  exchangeCalls = 0;
  refreshImpl: jest.Mock<Promise<GoogleTokenSet>, [string]> = jest.fn();
  revokeImpl: jest.Mock<Promise<boolean>, [string]> = jest.fn(
    (_token: string) => Promise.resolve(true),
  );

  getConfig() {
    return {
      clientId: CLIENT_ID,
      clientSecret: 'secret',
      callbackUrl: 'https://api.example.com/cb',
    };
  }

  buildAuthorizationUrl(input: { state: string; nonce: string }) {
    this.lastRequest = { state: input.state, nonce: input.nonce };
    return `https://accounts.google.com/auth?state=${input.state}`;
  }

  async exchangeCode(): Promise<GoogleTokenSet> {
    this.exchangeCalls += 1;
    await delay(20);
    const grant = this.nextGrant!;
    const claims = {
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      exp: Math.floor(Date.now() / 1000) + 600,
      sub: grant.sub,
      nonce: this.lastRequest!.nonce,
      ...this.tamperIdToken,
    };
    const enc = (v: unknown) =>
      Buffer.from(JSON.stringify(v)).toString('base64url');
    return {
      accessToken: grant.accessToken,
      refreshToken: grant.refreshToken,
      expiresInSeconds: 3600,
      scopes: grant.scopes,
      idToken: `${enc({ alg: 'RS256' })}.${enc(claims)}.sig`,
    };
  }

  refresh(token: string) {
    return this.refreshImpl(token);
  }

  revoke(token: string) {
    return this.revokeImpl(token);
  }
}

run('Google OAuth foundation against PostgreSQL', () => {
  let dataSource: DataSource;
  let google: FakeGoogle;
  let oauth: SocialGoogleOAuthService;
  let auth: SocialGoogleAuthorizationService;
  const crypto = new SettingsCryptoService();
  const logged: string[] = [];

  const GA4 = GOOGLE_PRODUCT_SCOPES.ga4;
  const ADS = GOOGLE_PRODUCT_SCOPES.ads;

  const newScope = (
    overrides: Partial<CompanyAwareScope> = {},
  ): CompanyAwareScope => ({
    tenantId: randomUUID(),
    workspaceId: randomUUID(),
    agencyClientId: null,
    companyContextId: null,
    ...overrides,
  });

  // Unique per test: the database is shared, and live holders of one Google
  // identity are exactly what the remote-revoke guard looks at.
  let testSub = 'sub-1';

  function grant(overrides: Partial<Grant> = {}): Grant {
    return {
      sub: testSub,
      scopes: ['openid', GA4],
      refreshToken: 'rt-1',
      accessToken: 'at-1',
      ...overrides,
    };
  }

  /** start → callback; returns the redirect URL's params. */
  async function startAndCallback(
    scope: CompanyAwareScope,
    userId: string,
    product: 'ga4' | 'ads' | 'business_profile',
    next: Grant,
  ) {
    google.nextGrant = next;
    const started = await oauth.start({ scope, userId, product });
    const redirect = new URL(
      await oauth.handleCallback({
        code: 'code-xyz',
        state: google.lastRequest!.state,
      }),
    );
    return { started, params: redirect.searchParams };
  }

  async function connect(
    scope: CompanyAwareScope,
    userId: string,
    product: 'ga4' | 'ads' | 'business_profile',
    next: Grant,
  ) {
    const { params } = await startAndCallback(scope, userId, product, next);
    return oauth.confirm({
      scope,
      userId,
      sessionId: params.get('session')!,
    });
  }

  const row = async (scope: CompanyAwareScope) =>
    dataSource.getRepository(SocialGoogleAuthorizationEntity).findOneOrFail({
      where: { tenantId: scope.tenantId },
      select: {
        id: true,
        status: true,
        accessTokenEncrypted: true,
        refreshTokenEncrypted: true,
        tokenExpiresAt: true,
        grantedScopes: true,
        lastError: true,
        credentialVersion: true,
      },
    });

  const expireToken = (scope: CompanyAwareScope) =>
    dataSource.query(
      `UPDATE social_google_authorizations SET token_expires_at = now() - interval '1 minute' WHERE tenant_id = $1`,
      [scope.tenantId],
    );

  beforeAll(async () => {
    process.env.SOCIAL_FRONTEND_URL = 'https://app.example.com';
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.AGENCY_DB_HOST,
      port: Number(process.env.AGENCY_DB_PORT),
      username: process.env.AGENCY_DB_USERNAME,
      password: process.env.AGENCY_DB_PASSWORD,
      database: process.env.AGENCY_DB_NAME,
      entities: [
        SocialGoogleAuthorizationEntity,
        SocialGoogleOAuthSessionEntity,
        SocialGoogleProductLinkEntity,
        SocialGoogleAuditEventEntity,
      ],
    });
    await dataSource.initialize();
    const runner = dataSource.createQueryRunner();
    const migration = new CreateSocialGoogleOAuth1803700000000();
    await migration.down(runner);
    await migration.up(runner);
    await runner.release();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(() => {
    testSub = `sub-${randomUUID()}`;
    google = new FakeGoogle();
    oauth = new SocialGoogleOAuthService(dataSource, google, crypto);
    auth = new SocialGoogleAuthorizationService(dataSource, google, crypto);
    logged.length = 0;
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      jest
        .spyOn(Logger.prototype, level)
        .mockImplementation((...args: unknown[]) => {
          logged.push(JSON.stringify(args));
        });
    }
  });

  afterEach(() => jest.restoreAllMocks());

  describe('state', () => {
    it('persists only a hash of the state and a PKCE verifier ciphertext', async () => {
      const scope = newScope();
      const started = await oauth.start({
        scope,
        userId: randomUUID(),
        product: 'ga4',
      });
      const state = google.lastRequest!.state;
      expect(started.authorizationUrl).toContain(state);
      const [stored] = await dataSource.query(
        `SELECT * FROM social_google_oauth_sessions WHERE tenant_id = $1`,
        [scope.tenantId],
      );
      expect(JSON.stringify(stored)).not.toContain(state);
      expect(stored.state_hash).toHaveLength(64);
      expect(stored.code_verifier_encrypted).toBeTruthy();
    });

    it('rejects unknown, tampered and malformed state without calling Google', async () => {
      const scope = newScope();
      await oauth.start({ scope, userId: randomUUID(), product: 'ga4' });
      const state = google.lastRequest!.state;
      const tampered = state.slice(0, -1) + (state.endsWith('A') ? 'B' : 'A');
      for (const candidate of [tampered, 'short', undefined, 'x'.repeat(600)]) {
        const url = new URL(
          await oauth.handleCallback({ code: 'c', state: candidate }),
        );
        expect(url.searchParams.get('reason')).toBe('invalid_state');
      }
      expect(google.exchangeCalls).toBe(0);
    });

    it('rejects an expired state', async () => {
      const scope = newScope();
      google.nextGrant = grant();
      await oauth.start({ scope, userId: randomUUID(), product: 'ga4' });
      await dataSource.query(
        `UPDATE social_google_oauth_sessions SET expires_at = now() - interval '1 second' WHERE tenant_id = $1`,
        [scope.tenantId],
      );
      const url = new URL(
        await oauth.handleCallback({
          code: 'c',
          state: google.lastRequest!.state,
        }),
      );
      expect(url.searchParams.get('reason')).toBe('session_expired');
      expect(google.exchangeCalls).toBe(0);
    });

    it('consumes the state once, including under concurrent replay', async () => {
      const scope = newScope();
      google.nextGrant = grant();
      await oauth.start({ scope, userId: randomUUID(), product: 'ga4' });
      const state = google.lastRequest!.state;
      const results = await Promise.all([
        oauth.handleCallback({ code: 'c', state }),
        oauth.handleCallback({ code: 'c', state }),
      ]);
      const reasons = results.map((r) => new URL(r).searchParams.get('status'));
      expect(reasons.sort()).toEqual(['confirm', 'error']);
      expect(google.exchangeCalls).toBe(1);
      const replay = new URL(await oauth.handleCallback({ code: 'c', state }));
      expect(replay.searchParams.get('reason')).toBe('state_consumed');
    });

    it('treats a provider error as a denial and stores nothing', async () => {
      const scope = newScope();
      await oauth.start({ scope, userId: randomUUID(), product: 'ga4' });
      const url = new URL(
        await oauth.handleCallback({
          error: 'access_denied',
          state: google.lastRequest!.state,
        }),
      );
      expect(url.searchParams.get('reason')).toBe('oauth_denied');
      expect(google.exchangeCalls).toBe(0);
    });
  });

  describe('callback validation', () => {
    it.each([
      ['wrong nonce', { nonce: 'forged' }],
      ['wrong audience', { aud: 'someone-else' }],
    ])('rejects an id_token with %s', async (_l, tamper) => {
      google.tamperIdToken = tamper;
      const { params } = await startAndCallback(
        newScope(),
        randomUUID(),
        'ga4',
        grant(),
      );
      expect(params.get('reason')).toBe('invalid_identity');
    });

    it('rejects a partial grant that lacks the product scope and keeps no tokens', async () => {
      const scope = newScope();
      const { params } = await startAndCallback(
        scope,
        randomUUID(),
        'ga4',
        grant({ scopes: ['openid'] }),
      );
      expect(params.get('reason')).toBe('scope_denied');
      const [session] = await dataSource.query(
        `SELECT access_token_encrypted, refresh_token_encrypted, code_verifier_encrypted, status FROM social_google_oauth_sessions WHERE tenant_id = $1`,
        [scope.tenantId],
      );
      expect(session).toMatchObject({
        access_token_encrypted: null,
        refresh_token_encrypted: null,
        code_verifier_encrypted: null,
        status: 'failed',
      });
      expect((await auth.getStatus(scope)).status).toBe('not_connected');
    });
  });

  describe('confirm', () => {
    it('binds tokens (encrypted) to the context and exposes no credentials', async () => {
      const scope = newScope();
      const view = await connect(scope, randomUUID(), 'ga4', grant());
      expect(view.status).toBe('connected');
      expect(view.products.find((p) => p.product === 'ga4')).toMatchObject({
        status: 'connected',
        scopeGranted: true,
      });
      const text =
        JSON.stringify(view) + JSON.stringify(await auth.getStatus(scope));
      for (const secret of ['at-1', 'rt-1', testSub]) {
        expect(text).not.toContain(secret);
      }
      const stored = await row(scope);
      expect(stored.accessTokenEncrypted).not.toContain('at-1');
      expect(crypto.decrypt(stored.accessTokenEncrypted)).toBe('at-1');
      expect(crypto.decrypt(stored.refreshTokenEncrypted)).toBe('rt-1');
    });

    it('is bound to the initiating user, context and a single use', async () => {
      const scope = newScope();
      const user = randomUUID();
      const { params } = await startAndCallback(scope, user, 'ga4', grant());
      const sessionId = params.get('session')!;

      await expect(
        oauth.confirm({ scope, userId: randomUUID(), sessionId }),
      ).rejects.toThrow('invalid_session');
      await expect(
        oauth.confirm({ scope: newScope(), userId: user, sessionId }),
      ).rejects.toThrow('invalid_session');
      await expect(
        oauth.confirm({
          scope: { ...scope, companyContextId: randomUUID() },
          userId: user,
          sessionId,
        }),
      ).rejects.toThrow('invalid_session');

      await oauth.confirm({ scope, userId: user, sessionId });
      await expect(
        oauth.confirm({ scope, userId: user, sessionId }),
      ).rejects.toThrow('session_consumed');
      const [session] = await dataSource.query(
        `SELECT access_token_encrypted FROM social_google_oauth_sessions WHERE id = $1`,
        [sessionId],
      );
      expect(session.access_token_encrypted).toBeNull();
    });

    it('refuses to confirm an expired session and wipes its tokens', async () => {
      const scope = newScope();
      const user = randomUUID();
      const { params } = await startAndCallback(scope, user, 'ga4', grant());
      await dataSource.query(
        `UPDATE social_google_oauth_sessions SET expires_at = now() - interval '1 second' WHERE tenant_id = $1`,
        [scope.tenantId],
      );
      await expect(
        oauth.confirm({
          scope,
          userId: user,
          sessionId: params.get('session')!,
        }),
      ).rejects.toThrow('session_expired');
      const [session] = await dataSource.query(
        `SELECT access_token_encrypted FROM social_google_oauth_sessions WHERE tenant_id = $1`,
        [scope.tenantId],
      );
      expect(session.access_token_encrypted).toBeNull();
    });

    it('requires a refresh token when none is stored', async () => {
      const scope = newScope();
      await expect(
        connect(scope, randomUUID(), 'ga4', grant({ refreshToken: null })),
      ).rejects.toThrow('missing_refresh_token');
      expect((await auth.getStatus(scope)).status).toBe('not_connected');
    });

    it('rejects a different Google identity and leaves the grant untouched', async () => {
      const scope = newScope();
      const user = randomUUID();
      await connect(scope, user, 'ga4', grant());
      const before = await row(scope);
      await expect(
        connect(
          scope,
          user,
          'ads',
          grant({
            sub: 'sub-OTHER',
            scopes: ['openid', ADS],
            accessToken: 'at-x',
            refreshToken: 'rt-x',
          }),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      const after = await row(scope);
      expect(after.credentialVersion).toBe(before.credentialVersion);
      expect(after.grantedScopes).toEqual(before.grantedScopes);
      expect(crypto.decrypt(after.refreshTokenEncrypted)).toBe('rt-1');
      const status = await auth.getStatus(scope);
      expect(status.products.find((p) => p.product === 'ads')?.status).toBe(
        'disconnected',
      );
    });

    it('adds a product incrementally, unions scopes and keeps the refresh token', async () => {
      const scope = newScope();
      const user = randomUUID();
      await connect(scope, user, 'ga4', grant());
      const view = await connect(
        scope,
        user,
        'ads',
        grant({
          scopes: ['openid', GA4, ADS],
          accessToken: 'at-2',
          refreshToken: null,
        }),
      );
      expect(view.revokeImpact.products.sort()).toEqual(['ads', 'ga4']);
      const stored = await row(scope);
      expect([...stored.grantedScopes].sort()).toEqual(
        ['openid', GA4, ADS].sort(),
      );
      expect(crypto.decrypt(stored.refreshTokenEncrypted)).toBe('rt-1');
      expect(crypto.decrypt(stored.accessTokenEncrypted)).toBe('at-2');
      expect(
        await dataSource.getRepository(SocialGoogleAuthorizationEntity).count({
          where: { tenantId: scope.tenantId },
        }),
      ).toBe(1);
    });
  });

  describe('token lifecycle', () => {
    it('returns the stored token while valid and never calls Google', async () => {
      const scope = newScope();
      await connect(scope, randomUUID(), 'ga4', grant());
      const token = await auth.getAccessToken({ scope, product: 'ga4' });
      expect(token.accessToken).toBe('at-1');
      expect(google.refreshImpl).not.toHaveBeenCalled();
    });

    it('does not use an expired token without a valid renewal', async () => {
      const scope = newScope();
      await connect(scope, randomUUID(), 'ga4', grant());
      await expireToken(scope);
      google.refreshImpl.mockRejectedValue(
        new GoogleOAuthError('network_error'),
      );
      await expect(
        auth.getAccessToken({ scope, product: 'ga4' }),
      ).rejects.toMatchObject({ code: 'refresh_failed' });
      // Transient failure: the connection itself is untouched.
      expect((await row(scope)).status).toBe('connected');
    });

    it('refreshes an expired token and preserves the refresh token when none is returned', async () => {
      const scope = newScope();
      await connect(scope, randomUUID(), 'ga4', grant());
      await expireToken(scope);
      google.refreshImpl.mockResolvedValue({
        accessToken: 'at-new',
        refreshToken: null,
        expiresInSeconds: 3600,
        scopes: ['openid', GA4],
        idToken: null,
      });
      const token = await auth.getAccessToken({ scope, product: 'ga4' });
      expect(token.accessToken).toBe('at-new');
      expect(google.refreshImpl).toHaveBeenCalledWith('rt-1');
      expect(crypto.decrypt((await row(scope)).refreshTokenEncrypted)).toBe(
        'rt-1',
      );
    });

    it('stores a rotated refresh token', async () => {
      const scope = newScope();
      await connect(scope, randomUUID(), 'ga4', grant());
      await expireToken(scope);
      google.refreshImpl.mockResolvedValue({
        accessToken: 'at-new',
        refreshToken: 'rt-rotated',
        expiresInSeconds: 3600,
        scopes: ['openid', GA4],
        idToken: null,
      });
      await auth.getAccessToken({ scope, product: 'ga4' });
      expect(crypto.decrypt((await row(scope)).refreshTokenEncrypted)).toBe(
        'rt-rotated',
      );
    });

    it('serializes concurrent refreshes into a single provider call', async () => {
      const scope = newScope();
      await connect(scope, randomUUID(), 'ga4', grant());
      await expireToken(scope);
      google.refreshImpl.mockImplementation(async () => {
        await delay(80);
        return {
          accessToken: 'at-once',
          refreshToken: null,
          expiresInSeconds: 3600,
          scopes: ['openid', GA4],
          idToken: null,
        };
      });
      const tokens = await Promise.all(
        Array.from({ length: 6 }, () =>
          auth.getAccessToken({ scope, product: 'ga4' }),
        ),
      );
      expect(google.refreshImpl).toHaveBeenCalledTimes(1);
      expect(new Set(tokens.map((t) => t.accessToken))).toEqual(
        new Set(['at-once']),
      );
    });

    it('moves to reauth_required on invalid_grant and stops calling Google', async () => {
      const scope = newScope();
      const user = randomUUID();
      await connect(scope, user, 'ga4', grant());
      await expireToken(scope);
      google.refreshImpl.mockRejectedValue(
        new GoogleOAuthError('invalid_grant'),
      );
      await expect(
        auth.getAccessToken({ scope, product: 'ga4' }),
      ).rejects.toMatchObject({ code: 'reauth_required' });
      const stored = await row(scope);
      expect(stored).toMatchObject({
        status: 'reauth_required',
        lastError: 'invalid_grant',
        accessTokenEncrypted: null,
        refreshTokenEncrypted: null,
      });
      await expect(
        auth.getAccessToken({ scope, product: 'ga4' }),
      ).rejects.toBeInstanceOf(GoogleCredentialError);
      expect(google.refreshImpl).toHaveBeenCalledTimes(1);
      const status = await auth.getStatus(scope);
      expect(status.reauthRequired).toBe(true);
      expect(
        status.products.find((p) => p.product === 'ga4')?.reauthRequired,
      ).toBe(true);

      // Reconnecting with the same identity restores the connection.
      const view = await connect(
        scope,
        user,
        'ga4',
        grant({ accessToken: 'at-r', refreshToken: 'rt-r' }),
      );
      expect(view.status).toBe('connected');
      expect(view.reauthRequired).toBe(false);
    });

    it('refuses a product that is not connected or whose scope is no longer granted', async () => {
      const scope = newScope();
      await connect(scope, randomUUID(), 'ga4', grant());
      await expect(
        auth.getAccessToken({ scope, product: 'ads' }),
      ).rejects.toMatchObject({ code: 'product_not_connected' });
      await expireToken(scope);
      google.refreshImpl.mockResolvedValue({
        accessToken: 'at-n',
        refreshToken: null,
        expiresInSeconds: 3600,
        scopes: ['openid'],
        idToken: null,
      });
      await expect(
        auth.getAccessToken({ scope, product: 'ga4' }),
      ).rejects.toMatchObject({ code: 'scope_not_granted' });
    });

    it('keeps the connection and recovers after a network failure on refresh', async () => {
      const scope = newScope();
      await connect(scope, randomUUID(), 'ga4', grant());
      await expireToken(scope);
      google.refreshImpl.mockRejectedValueOnce(
        new GoogleOAuthError('network_error'),
      );
      await expect(
        auth.getAccessToken({ scope, product: 'ga4' }),
      ).rejects.toMatchObject({ code: 'refresh_failed' });
      const after = await row(scope);
      expect(after.status).toBe('connected');
      expect(crypto.decrypt(after.refreshTokenEncrypted)).toBe('rt-1');
      google.refreshImpl.mockResolvedValue({
        accessToken: 'at-retry',
        refreshToken: null,
        expiresInSeconds: 3600,
        scopes: ['openid', GA4],
        idToken: null,
      });
      expect(
        (await auth.getAccessToken({ scope, product: 'ga4' })).accessToken,
      ).toBe('at-retry');
      // refresh token was preserved, not wiped, by the earlier failure
      expect(crypto.decrypt((await row(scope)).refreshTokenEncrypted)).toBe(
        'rt-1',
      );
    });

    it('fails fast instead of waiting forever when the row lock is held', async () => {
      const scope = newScope();
      await connect(scope, randomUUID(), 'ga4', grant());
      await expireToken(scope);
      (auth as unknown as { lockTimeoutMs: number }).lockTimeoutMs = 200;
      const runner = dataSource.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        await runner.query(
          `SELECT 1 FROM social_google_authorizations WHERE tenant_id = $1 FOR UPDATE`,
          [scope.tenantId],
        );
        await expect(
          auth.getAccessToken({ scope, product: 'ga4' }),
        ).rejects.toMatchObject({ code: 'refresh_failed' });
        await expect(
          auth.disconnectProduct({ scope, userId: null, product: 'ga4' }),
        ).rejects.toThrow('authorization_busy');
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
      }
      // nothing was changed by the timed-out attempts
      expect((await auth.getStatus(scope)).status).toBe('connected');
    });

    it('lets a product disconnect wait for an in-flight refresh and then apply', async () => {
      const scope = newScope();
      await connect(scope, randomUUID(), 'ga4', grant());
      await expireToken(scope);
      google.refreshImpl.mockImplementation(async () => {
        await delay(150);
        return {
          accessToken: 'at-slow',
          refreshToken: null,
          expiresInSeconds: 3600,
          scopes: ['openid', GA4],
          idToken: null,
        };
      });
      const refreshing = auth.getAccessToken({ scope, product: 'ga4' });
      await delay(40);
      const disconnected = await auth.disconnectProduct({
        scope,
        userId: null,
        product: 'ga4',
      });
      await refreshing;
      expect(disconnected.authorizationRevoked).toBe(true);
      expect((await auth.getStatus(scope)).status).toBe('not_connected');
      expect(google.revokeImpl).not.toHaveBeenCalled();
    });

    it('does not let an in-flight refresh resurrect a revoked authorization', async () => {
      const scope = newScope();
      await connect(scope, randomUUID(), 'ga4', grant());
      await expireToken(scope);
      google.refreshImpl.mockImplementation(async () => {
        await delay(150);
        return {
          accessToken: 'at-late',
          refreshToken: 'rt-late',
          expiresInSeconds: 3600,
          scopes: ['openid', GA4],
          idToken: null,
        };
      });
      const refreshing = auth
        .getAccessToken({ scope, product: 'ga4' })
        .catch((e: unknown) => e);
      await delay(40); // refresh now holds the row lock
      const revoked = await auth.revoke({ scope, userId: null, confirm: true });
      await refreshing;
      expect(revoked.status).toBe('revoked');
      const stored = await dataSource
        .getRepository(SocialGoogleAuthorizationEntity)
        .findOneOrFail({
          where: { tenantId: scope.tenantId },
          select: {
            status: true,
            accessTokenEncrypted: true,
            refreshTokenEncrypted: true,
          },
        });
      expect(stored).toMatchObject({
        status: 'revoked',
        accessTokenEncrypted: null,
        refreshTokenEncrypted: null,
      });
      await expect(
        auth.getAccessToken({ scope, product: 'ga4' }),
      ).rejects.toMatchObject({ code: 'not_connected' });
    });
  });

  describe('disconnect and revoke', () => {
    it('disconnects one product without revoking the others', async () => {
      const scope = newScope();
      const user = randomUUID();
      await connect(scope, user, 'ga4', grant());
      await connect(
        scope,
        user,
        'ads',
        grant({ scopes: ['openid', GA4, ADS], refreshToken: null }),
      );

      const result = await auth.disconnectProduct({
        scope,
        userId: user,
        product: 'ga4',
      });
      expect(result).toMatchObject({
        authorizationRevoked: false,
        remainingProducts: ['ads'],
      });
      expect(google.revokeImpl).not.toHaveBeenCalled();
      expect((await row(scope)).status).toBe('connected');
      await expect(
        auth.getAccessToken({ scope, product: 'ga4' }),
      ).rejects.toMatchObject({ code: 'product_not_connected' });
      expect(
        (await auth.getAccessToken({ scope, product: 'ads' })).accessToken,
      ).toBe('at-1');
      await expect(
        auth.disconnectProduct({ scope, userId: user, product: 'ga4' }),
      ).rejects.toThrow('product_not_connected');
    });

    it('discards local credentials but never revokes at Google when the last product is disconnected', async () => {
      const scope = newScope();
      const user = randomUUID();
      await connect(scope, user, 'ga4', grant());
      const result = await auth.disconnectProduct({
        scope,
        userId: user,
        product: 'ga4',
      });
      expect(result).toMatchObject({
        authorizationRevoked: true,
        providerRevoked: null,
        remoteGrantRetained: true,
      });
      expect(google.revokeImpl).not.toHaveBeenCalled();
      expect((await auth.getStatus(scope)).status).toBe('not_connected');
      const stored = await dataSource
        .getRepository(SocialGoogleAuthorizationEntity)
        .findOneOrFail({
          where: { tenantId: scope.tenantId },
          select: {
            status: true,
            accessTokenEncrypted: true,
            refreshTokenEncrypted: true,
          },
        });
      expect(stored).toMatchObject({
        status: 'revoked',
        accessTokenEncrypted: null,
        refreshTokenEncrypted: null,
      });
    });

    it('does not revoke at Google by default on full disconnect', async () => {
      const scope = newScope();
      await connect(scope, randomUUID(), 'ga4', grant());
      const result = await auth.revoke({ scope, userId: null, confirm: true });
      expect(result).toMatchObject({
        status: 'revoked',
        providerRevoked: null,
        remoteRevocation: 'not_requested',
      });
      expect(google.revokeImpl).not.toHaveBeenCalled();
      expect((await auth.getStatus(scope)).status).toBe('not_connected');
    });

    it('refuses the remote revoke while another context holds the same Google identity', async () => {
      const a = newScope();
      const b = newScope();
      await connect(a, randomUUID(), 'ga4', grant({ refreshToken: 'rt-A' }));
      await connect(b, randomUUID(), 'ga4', grant({ refreshToken: 'rt-B' }));
      expect((await auth.getStatus(a)).revokeImpact).toMatchObject({
        sharedIdentity: true,
        remoteRevocationAvailable: false,
      });

      const result = await auth.revoke({
        scope: a,
        userId: null,
        confirm: true,
        revokeAtGoogle: true,
      });
      expect(result.remoteRevocation).toBe('skipped_shared_identity');
      expect(google.revokeImpl).not.toHaveBeenCalled();
      // Local state of A is gone; B is untouched and still usable.
      expect((await auth.getStatus(a)).status).toBe('not_connected');
      expect((await auth.getStatus(b)).status).toBe('connected');
      expect(
        (await auth.getAccessToken({ scope: b, product: 'ga4' })).accessToken,
      ).toBeTruthy();

      // B is now the only holder, so the remote revoke is allowed for it.
      expect((await auth.getStatus(b)).revokeImpact.sharedIdentity).toBe(false);
      const last = await auth.revoke({
        scope: b,
        userId: null,
        confirm: true,
        revokeAtGoogle: true,
      });
      expect(last.remoteRevocation).toBe('revoked');
      expect(google.revokeImpl).toHaveBeenCalledWith('rt-B');
    });

    it('never touches another tenant when one disconnects a product', async () => {
      const a = newScope();
      const b = newScope();
      await connect(a, randomUUID(), 'ga4', grant());
      await connect(b, randomUUID(), 'ga4', grant());
      await auth.disconnectProduct({
        scope: a,
        userId: null,
        product: 'ga4',
      });
      expect(google.revokeImpl).not.toHaveBeenCalled();
      expect((await auth.getStatus(b)).status).toBe('connected');
    });

    it('requires explicit confirmation to revoke everything', async () => {
      const scope = newScope();
      await connect(scope, randomUUID(), 'ga4', grant());
      await expect(
        auth.revoke({ scope, userId: null, confirm: false }),
      ).rejects.toThrow('confirmation_required');
      expect((await row(scope)).status).toBe('connected');
    });

    it('revokes the shared authorization, wipes credentials and reports the impact', async () => {
      const scope = newScope();
      const user = randomUUID();
      await connect(scope, user, 'ga4', grant());
      await connect(
        scope,
        user,
        'ads',
        grant({ scopes: ['openid', GA4, ADS], refreshToken: null }),
      );
      const result = await auth.revoke({
        scope,
        userId: user,
        confirm: true,
        revokeAtGoogle: true,
      });
      expect([...result.disconnectedProducts].sort()).toEqual(['ads', 'ga4']);
      expect(result.remoteRevocation).toBe('revoked');
      expect(google.revokeImpl).toHaveBeenCalledTimes(1);
      const stored = await dataSource
        .getRepository(SocialGoogleAuthorizationEntity)
        .findOneOrFail({
          where: { tenantId: scope.tenantId },
          select: {
            status: true,
            accessTokenEncrypted: true,
            refreshTokenEncrypted: true,
            grantedScopes: true,
          },
        });
      expect(stored).toMatchObject({
        status: 'revoked',
        accessTokenEncrypted: null,
        refreshTokenEncrypted: null,
        grantedScopes: [],
      });
      await expect(
        auth.revoke({ scope, userId: user, confirm: true }),
      ).rejects.toThrow('not_connected');
    });

    it('stays revoked locally when Google revocation fails', async () => {
      const scope = newScope();
      await connect(scope, randomUUID(), 'ga4', grant());
      google.revokeImpl.mockResolvedValue(false);
      const result = await auth.revoke({
        scope,
        userId: null,
        confirm: true,
        revokeAtGoogle: true,
      });
      expect(result.providerRevoked).toBe(false);
      expect(result.remoteRevocation).toBe('failed');
      expect((await auth.getStatus(scope)).status).toBe('not_connected');
    });

    it('allows a new identity once the previous authorization is revoked', async () => {
      const scope = newScope();
      const user = randomUUID();
      await connect(scope, user, 'ga4', grant());
      await auth.revoke({ scope, userId: user, confirm: true });
      const view = await connect(scope, user, 'ga4', grant({ sub: 'sub-2' }));
      expect(view.status).toBe('connected');
    });
  });

  describe('isolation', () => {
    it('never shares credentials across tenants for the same Google subject', async () => {
      const a = newScope();
      const b = newScope();
      await connect(
        a,
        randomUUID(),
        'ga4',
        grant({ accessToken: 'at-A', refreshToken: 'rt-A' }),
      );
      await connect(
        b,
        randomUUID(),
        'ga4',
        grant({ accessToken: 'at-B', refreshToken: 'rt-B' }),
      );
      expect(crypto.decrypt((await row(a)).accessTokenEncrypted)).toBe('at-A');
      expect(crypto.decrypt((await row(b)).accessTokenEncrypted)).toBe('at-B');

      await auth.revoke({ scope: a, userId: null, confirm: true });
      expect((await auth.getStatus(a)).status).toBe('not_connected');
      expect((await auth.getStatus(b)).status).toBe('connected');
      expect(
        (await auth.getAccessToken({ scope: b, product: 'ga4' })).accessToken,
      ).toBe('at-B');
    });

    it('keeps agency and company contexts of one tenant independent', async () => {
      const agency = newScope();
      const company = {
        ...agency,
        agencyClientId: randomUUID(),
        companyContextId: randomUUID(),
      };
      const user = randomUUID();
      await connect(agency, user, 'ga4', grant());
      await connect(company, user, 'ga4', grant({ sub: 'sub-company' }));
      await auth.revoke({ scope: company, userId: user, confirm: true });
      expect((await auth.getStatus(agency)).status).toBe('connected');
      expect((await auth.getStatus(company)).status).toBe('not_connected');
      expect(
        (
          await auth.getStatus({
            ...agency,
            companyContextId: randomUUID(),
            agencyClientId: randomUUID(),
          })
        ).status,
      ).toBe('not_connected');
    });

    it('enforces one live authorization per context at the database level', async () => {
      const scope = newScope();
      await connect(scope, randomUUID(), 'ga4', grant());
      await expect(
        dataSource.query(
          `INSERT INTO social_google_authorizations (tenant_id, workspace_id, google_sub) VALUES ($1, $2, 'dup')`,
          [scope.tenantId, scope.workspaceId],
        ),
      ).rejects.toThrow(/UQ_social_google_authorizations_live_context/);
    });
  });

  describe('secrets hygiene', () => {
    it('keeps tokens, codes and state out of logs, redirects and audit rows', async () => {
      const scope = newScope();
      const user = randomUUID();
      const outputs: string[] = [];

      google.nextGrant = grant({
        accessToken: 'at-LEAK',
        refreshToken: 'rt-LEAK',
      });
      await oauth.start({ scope, userId: user, product: 'ga4' });
      const state = google.lastRequest!.state;
      outputs.push(await oauth.handleCallback({ code: 'code-LEAK', state }));
      // Failure paths log too.
      jest
        .spyOn(google, 'exchangeCode')
        .mockRejectedValue(new Error('code-LEAK at-LEAK'));
      await oauth.start({ scope: newScope(), userId: user, product: 'ga4' });
      outputs.push(
        await oauth.handleCallback({
          code: 'code-LEAK',
          state: google.lastRequest!.state,
        }),
      );
      await oauth.handleCallback({ code: 'code-LEAK', state: 'x'.repeat(40) });

      await connect(
        scope,
        user,
        'ga4',
        grant({ accessToken: 'at-LEAK', refreshToken: 'rt-LEAK' }),
      ).catch(() => null);
      await expireToken(scope);
      google.refreshImpl.mockRejectedValue(
        new GoogleOAuthError('invalid_grant'),
      );
      await auth.getAccessToken({ scope, product: 'ga4' }).catch(() => null);
      outputs.push(JSON.stringify(await auth.getStatus(scope)));

      const audit = await dataSource.query(
        `SELECT * FROM social_google_audit_events`,
      );
      outputs.push(JSON.stringify(audit), ...logged);
      const all = outputs.join('\n');
      for (const secret of ['at-LEAK', 'rt-LEAK', 'code-LEAK', state]) {
        expect(all).not.toContain(secret);
      }
    });
  });
});
