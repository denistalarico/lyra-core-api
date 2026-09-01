/* eslint-disable @typescript-eslint/require-await -- Jest/TypeORM test doubles intentionally expose partial dynamic repository shapes. */
import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import type { DataSource, Repository } from 'typeorm';
import { SettingsCryptoService } from '../../../common/crypto/settings-crypto.service';
import { SocialAdAccountConnectionEntity } from '../entities/social-ad-account-connection.entity';
import { requireSocialFrontendUrl } from '../oauth/meta-ads-oauth.support';
import type { MetaAdsGraphService } from './meta-ads-graph.service';
import { MetaAdsOAuthService } from './meta-ads-oauth.service';
import type { SocialAdBackfillPlannerService } from './social-ad-backfill-planner.service';

const CALLBACK_URL =
  'https://api.example.com/api/social/integrations/meta-ads/callback';

function hash(state: string) {
  return createHash('sha256').update(state).digest('hex');
}

function buildRow(
  overrides: Partial<SocialAdAccountConnectionEntity> = {},
): SocialAdAccountConnectionEntity {
  return {
    id: 'connection-id',
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    agencyClientId: null,
    provider: 'meta_ads',
    externalAccountId: null,
    externalBusinessId: null,
    accountName: null,
    currency: null,
    timezone: null,
    connectionStatus: 'pending',
    credentialVersion: 1,
    accessTokenEncrypted: null,
    refreshTokenEncrypted: null,
    tokenExpiresAt: null,
    scopes: [],
    lastSyncedAt: null,
    lastSyncError: null,
    oauthStateHash: hash('valid-state'),
    oauthExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
    createdById: 'user-a',
    metadata: {},
    credentialRemovedAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  } as SocialAdAccountConnectionEntity;
}

const AD_ACCOUNTS = [
  {
    externalAccountId: 'act_1111111111',
    accountName: 'Alfa — Institucional',
    currency: 'BRL',
    timezone: 'America/Sao_Paulo',
    accountStatus: '1',
    businessId: 'biz_1',
    businessName: 'Alfa Holding',
  },
  {
    externalAccountId: 'act_2222222222',
    accountName: 'Alfa — Performance',
    currency: 'BRL',
    timezone: 'America/Sao_Paulo',
    accountStatus: '1',
    businessId: 'biz_1',
    businessName: 'Alfa Holding',
  },
];

/**
 * Chainable stub for TypeORM's query builder. `getOne` drains a queue so a
 * test can describe "the pending row, then the row already holding this
 * account" in the order the service looks them up.
 */
function createQueryBuilderFactory(results: unknown[]) {
  const queue = [...results];
  const builder: Record<string, unknown> = {};

  for (const method of [
    'addSelect',
    'where',
    'andWhere',
    'orderBy',
    'setLock',
  ]) {
    builder[method] = jest.fn(() => builder);
  }

  builder.getOne = jest.fn(async () => queue.shift() ?? null);
  builder.getMany = jest.fn(async () => queue.shift() ?? []);

  return { builder, factory: jest.fn(() => builder) };
}

function createHarness(
  options: {
    queryResults?: unknown[];
    graph?: Partial<jest.Mocked<MetaAdsGraphService>>;
  } = {},
) {
  const { builder, factory } = createQueryBuilderFactory(
    options.queryResults ?? [],
  );

  const saved: SocialAdAccountConnectionEntity[] = [];
  const deleted: unknown[] = [];

  const transactionRepository = {
    createQueryBuilder: factory,
    save: jest.fn(async (row: SocialAdAccountConnectionEntity) => {
      saved.push(row);
      return row;
    }),
    delete: jest.fn(async (criteria: unknown) => {
      deleted.push(criteria);
      return { affected: 1 };
    }),
  };

  const connectionsRepository = {
    create: jest.fn((row: Partial<SocialAdAccountConnectionEntity>) => ({
      id: 'new-connection-id',
      ...row,
    })),
    save: jest.fn(async (row: SocialAdAccountConnectionEntity) => {
      saved.push(row);
      return row;
    }),
    delete: jest.fn(async (criteria: unknown) => {
      deleted.push(criteria);
      return { affected: 0 };
    }),
  };

  const dataSource = {
    transaction: jest.fn(async (callback: (manager: unknown) => unknown) =>
      callback({ getRepository: () => transactionRepository }),
    ),
  };

  const graph = {
    getLoginConfig: jest.fn(() => ({
      appId: 'social-ads-app-id',
      configId: 'social-ads-config-id',
      authorizationEndpoint: 'https://www.facebook.com/v25.0/dialog/oauth',
    })),
    exchangeOAuthCode: jest.fn(async () => ({
      accessToken: 'short-lived-token',
      expiresIn: 3600,
    })),
    exchangeLongLivedToken: jest.fn(async () => ({
      accessToken: 'long-lived-token',
      expiresIn: 5184000,
    })),
    listAdAccounts: jest.fn(async () => AD_ACCOUNTS),
    ...(options.graph ?? {}),
  };

  const crypto = new SettingsCryptoService();

  // Records what a completed selection hands to the backfill chain. The
  // planner's own decisions are covered by its own spec; what matters here is
  // that binding an account reaches it at all, and with the bound row.
  const backfillPlanner = {
    planForConnectedAccount: jest.fn(async () => undefined),
  };

  const service = new MetaAdsOAuthService(
    connectionsRepository as unknown as Repository<SocialAdAccountConnectionEntity>,
    dataSource as unknown as DataSource,
    graph as unknown as MetaAdsGraphService,
    crypto,
    backfillPlanner as unknown as SocialAdBackfillPlannerService,
  );

  return {
    service,
    crypto,
    graph,
    backfillPlanner,
    builder,
    saved,
    deleted,
    connectionsRepository,
    transactionRepository,
  };
}

describe('MetaAdsOAuthService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      SOCIAL_META_ADS_OAUTH_CALLBACK_URL: CALLBACK_URL,
      SOCIAL_META_ADS_LOGIN_CONFIG_ID: 'social-ads-config-id',
      SOCIAL_FRONTEND_URL: 'https://agency.example.com',
      SETTINGS_ENCRYPTION_KEY: 'social-ads-oauth-test-key',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('start', () => {
    it('builds a config-driven authorization URL without secrets', async () => {
      const harness = createHarness();

      const result = await harness.service.start({
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        userId: 'user-a',
        agencyClientId: 'client-a',
      });

      const url = new URL(result.authorizationUrl);

      expect(`${url.origin}${url.pathname}`).toBe(
        'https://www.facebook.com/v25.0/dialog/oauth',
      );
      // The client id is whatever the graph service resolved from the Social
      // app variables — the authorization URL never picks an app of its own.
      expect(url.searchParams.get('client_id')).toBe('social-ads-app-id');
      expect(url.searchParams.get('config_id')).toBe('social-ads-config-id');
      expect(url.searchParams.get('redirect_uri')).toBe(CALLBACK_URL);
      expect(url.searchParams.has('client_secret')).toBe(false);
    });

    it('stores the state hashed, never the state itself', async () => {
      const harness = createHarness();

      const result = await harness.service.start({
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        userId: 'user-a',
        agencyClientId: null,
      });

      const state = new URL(result.authorizationUrl).searchParams.get(
        'state',
      ) as string;
      const persisted = harness.saved[0];

      expect(persisted.oauthStateHash).toBe(hash(state));
      expect(persisted.oauthStateHash).not.toBe(state);
      expect(persisted.connectionStatus).toBe('pending');
      expect(persisted.externalAccountId).toBeNull();
      expect(persisted.accessTokenEncrypted).toBeNull();
    });

    it('requests read-only scopes', async () => {
      const harness = createHarness();

      await harness.service.start({
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        userId: 'user-a',
        agencyClientId: null,
      });

      expect(harness.saved[0].scopes).toEqual([
        'ads_read',
        'business_management',
      ]);
      expect(harness.saved[0].scopes).not.toContain('ads_management');
    });

    it('issues a distinct state per attempt', async () => {
      const harness = createHarness();
      const input = {
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        userId: 'user-a',
        agencyClientId: null,
      };

      const first = await harness.service.start(input);
      const second = await harness.service.start(input);

      expect(
        new URL(first.authorizationUrl).searchParams.get('state'),
      ).not.toBe(new URL(second.authorizationUrl).searchParams.get('state'));
    });

    it('discards abandoned attempts before starting a new one', async () => {
      const harness = createHarness();

      await harness.service.start({
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        userId: 'user-a',
        agencyClientId: 'client-a',
      });

      expect(harness.connectionsRepository.delete).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-a',
          workspaceId: 'workspace-a',
          provider: 'meta_ads',
          agencyClientId: 'client-a',
        }),
      );
    });

    it('writes nothing when the callback URL is not configured', async () => {
      delete process.env.SOCIAL_META_ADS_OAUTH_CALLBACK_URL;
      const harness = createHarness();

      await expect(
        harness.service.start({
          tenantId: 'tenant-a',
          workspaceId: 'workspace-a',
          userId: 'user-a',
          agencyClientId: null,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(harness.connectionsRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('callback', () => {
    it('encrypts the token and offers the discovered accounts', async () => {
      const row = buildRow();
      const harness = createHarness({ queryResults: [row] });

      const redirect = await harness.service.handleCallback({
        state: 'valid-state',
        code: 'authorization-code',
      });

      expect(harness.graph.exchangeOAuthCode).toHaveBeenCalledWith({
        code: 'authorization-code',
        redirectUri: CALLBACK_URL,
      });
      expect(row.connectionStatus).toBe('awaiting_selection');
      expect(row.accessTokenEncrypted).not.toBeNull();
      expect(row.accessTokenEncrypted).not.toContain('long-lived-token');
      expect(harness.crypto.decrypt(row.accessTokenEncrypted)).toBe(
        'long-lived-token',
      );
      expect((row.metadata.selectableAccounts as unknown[]).length).toBe(2);

      const url = new URL(redirect);
      expect(url.pathname).toBe('/social/channels/metaads');
      expect(url.searchParams.get('status')).toBe('select_account');
      expect(url.searchParams.get('connection')).toBe('connection-id');
    });

    it('consumes the state so a replayed callback matches nothing', async () => {
      const row = buildRow();
      const harness = createHarness({ queryResults: [row] });

      await harness.service.handleCallback({
        state: 'valid-state',
        code: 'authorization-code',
      });

      expect(row.oauthStateHash).toBeNull();
    });

    it('prefers the long-lived token and dates the expiry from it', async () => {
      const row = buildRow();
      const harness = createHarness({ queryResults: [row] });

      await harness.service.handleCallback({
        state: 'valid-state',
        code: 'authorization-code',
      });

      expect(harness.crypto.decrypt(row.accessTokenEncrypted)).toBe(
        'long-lived-token',
      );
      expect(row.tokenExpiresAt).not.toBeNull();
      expect((row.tokenExpiresAt as Date).getTime()).toBeGreaterThan(
        Date.now() + 30 * 24 * 60 * 60 * 1000,
      );
    });

    it('keeps the short-lived token when the exchange is refused', async () => {
      const row = buildRow();
      const harness = createHarness({
        queryResults: [row],
        graph: { exchangeLongLivedToken: jest.fn(async () => null) as never },
      });

      await harness.service.handleCallback({
        state: 'valid-state',
        code: 'authorization-code',
      });

      expect(harness.crypto.decrypt(row.accessTokenEncrypted)).toBe(
        'short-lived-token',
      );
    });

    it('rejects an unknown state without touching the provider', async () => {
      const harness = createHarness({ queryResults: [null] });

      const redirect = await harness.service.handleCallback({
        state: 'unknown-state',
        code: 'authorization-code',
      });

      expect(new URL(redirect).searchParams.get('reason')).toBe(
        'invalid_state',
      );
      expect(harness.graph.exchangeOAuthCode).not.toHaveBeenCalled();
    });

    it('rejects an oversized state before hashing it', async () => {
      const harness = createHarness({ queryResults: [] });

      const redirect = await harness.service.handleCallback({
        state: 'x'.repeat(513),
        code: 'authorization-code',
      });

      expect(new URL(redirect).searchParams.get('reason')).toBe(
        'invalid_state',
      );
      expect(
        harness.transactionRepository.createQueryBuilder,
      ).not.toHaveBeenCalled();
    });

    it('marks an expired attempt as failed', async () => {
      const row = buildRow({
        oauthExpiresAt: new Date(Date.now() - 1000),
      });
      const harness = createHarness({ queryResults: [row] });

      const redirect = await harness.service.handleCallback({
        state: 'valid-state',
        code: 'authorization-code',
      });

      expect(new URL(redirect).searchParams.get('reason')).toBe(
        'session_expired',
      );
      expect(row.connectionStatus).toBe('error');
      expect(row.oauthStateHash).toBeNull();
    });

    it('records a denied authorization without a code exchange', async () => {
      const row = buildRow();
      const harness = createHarness({ queryResults: [row] });

      const redirect = await harness.service.handleCallback({
        state: 'valid-state',
        error: 'access_denied',
        errorReason: 'user_denied',
      });

      expect(new URL(redirect).searchParams.get('reason')).toBe('oauth_denied');
      expect(row.connectionStatus).toBe('error');
      expect(row.lastSyncError).toBe('oauth_denied');
      expect(harness.graph.exchangeOAuthCode).not.toHaveBeenCalled();
    });

    it('surfaces a provider failure as a safe reason code', async () => {
      const row = buildRow();
      const harness = createHarness({
        queryResults: [row],
        graph: {
          exchangeOAuthCode: jest.fn(async () => {
            throw new BadRequestException(
              'Meta rejected access_token=EAAG-secret',
            );
          }) as never,
        },
      });

      const redirect = await harness.service.handleCallback({
        state: 'valid-state',
        code: 'authorization-code',
      });

      expect(redirect).not.toContain('EAAG-secret');
      expect(new URL(redirect).searchParams.get('reason')).toBe(
        'token_exchange_failed',
      );
      expect(row.connectionStatus).toBe('error');
      expect(row.accessTokenEncrypted).toBeNull();
    });

    it('reports an authorization that granted no ad account', async () => {
      const row = buildRow();
      const harness = createHarness({
        queryResults: [row],
        graph: { listAdAccounts: jest.fn(async () => []) as never },
      });

      const redirect = await harness.service.handleCallback({
        state: 'valid-state',
        code: 'authorization-code',
      });

      expect(new URL(redirect).searchParams.get('reason')).toBe(
        'no_accounts_available',
      );
      expect(row.accessTokenEncrypted).toBeNull();
    });

    it('refuses a callback for an already consumed attempt', async () => {
      const row = buildRow({ connectionStatus: 'connected' });
      const harness = createHarness({ queryResults: [row] });

      const redirect = await harness.service.handleCallback({
        state: 'valid-state',
        code: 'authorization-code',
      });

      expect(new URL(redirect).searchParams.get('reason')).toBe(
        'connection_consumed',
      );
    });
  });

  describe('select', () => {
    function awaitingRow(crypto: SettingsCryptoService) {
      return buildRow({
        connectionStatus: 'awaiting_selection',
        oauthStateHash: null,
        accessTokenEncrypted: crypto.encrypt('long-lived-token'),
        tokenExpiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
        metadata: {
          selectableAccounts: AD_ACCOUNTS.map((account) => ({ ...account })),
        },
      });
    }

    it('binds the chosen account and returns a view without the token', async () => {
      const crypto = new SettingsCryptoService();
      const row = awaitingRow(crypto);
      const harness = createHarness({ queryResults: [row, null] });

      const view = await harness.service.select({
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        userId: 'user-a',
        connectionId: 'connection-id',
        externalAccountId: 'act_2222222222',
      });

      expect(row.connectionStatus).toBe('connected');
      expect(row.externalAccountId).toBe('act_2222222222');
      expect(row.externalBusinessId).toBe('biz_1');
      expect(row.currency).toBe('BRL');
      expect(row.timezone).toBe('America/Sao_Paulo');
      expect(row.credentialRemovedAt).toBeNull();

      const serialized = JSON.stringify(view);
      expect(serialized).not.toContain('long-lived-token');
      expect(serialized).not.toContain(row.accessTokenEncrypted as string);
      expect(view.maskedAccountId).toBe('act_••••••2222');
      expect(view.state).toBe('connected');
    });

    it('ignores the internal account guardrail entirely', async () => {
      // The guardrail bounds the System User exception. If it ever reached
      // this path, every tenant's OAuth would be pinned to one agency's ad
      // account — so the configuration is set here, to a different account,
      // and the selection must go through untouched.
      process.env.SOCIAL_META_ADS_INTERNAL_TENANT_ID = 'tenant-a';
      process.env.SOCIAL_META_ADS_INTERNAL_ACCOUNT_ID = 'act_1111111111';
      process.env.SOCIAL_META_ADS_SYSTEM_USER_TOKEN = 'system-user-token';

      const crypto = new SettingsCryptoService();
      const row = awaitingRow(crypto);
      const harness = createHarness({ queryResults: [row, null] });

      const view = await harness.service.select({
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        userId: 'user-a',
        connectionId: 'connection-id',
        externalAccountId: 'act_2222222222',
      });

      expect(row.externalAccountId).toBe('act_2222222222');
      expect(row.authorizationMethod).toBe('business_login');
      expect(view.authorizationMethod).toBe('business_login');
    });

    it('clears the selectable accounts from the persisted metadata', async () => {
      const crypto = new SettingsCryptoService();
      const row = awaitingRow(crypto);
      const harness = createHarness({ queryResults: [row, null] });

      await harness.service.select({
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        userId: 'user-a',
        connectionId: 'connection-id',
        externalAccountId: 'act_1111111111',
      });

      expect(row.metadata.selectableAccounts).toBeUndefined();
    });

    it('refuses a selection after the authorization window closed', async () => {
      // The deadline set at start() covers the selection step too, so an
      // authorization left open overnight cannot be finished the next morning
      // against a token nobody re-consented to.
      const crypto = new SettingsCryptoService();
      const expired = awaitingRow(crypto);
      expired.oauthExpiresAt = new Date(Date.now() - 1000);
      const harness = createHarness({ queryResults: [expired, null] });

      await expect(
        harness.service.select({
          tenantId: 'tenant-a',
          workspaceId: 'workspace-a',
          userId: 'user-a',
          connectionId: 'connection-id',
          externalAccountId: 'act_1111111111',
        }),
      ).rejects.toThrow('connection_expired');

      expect(expired.connectionStatus).toBe('awaiting_selection');
      expect(expired.externalAccountId).toBeNull();
    });

    it('refuses an account the authorization did not grant', async () => {
      const crypto = new SettingsCryptoService();
      const harness = createHarness({
        queryResults: [awaitingRow(crypto), null],
      });

      await expect(
        harness.service.select({
          tenantId: 'tenant-a',
          workspaceId: 'workspace-a',
          userId: 'user-a',
          connectionId: 'connection-id',
          externalAccountId: 'act_9999999999',
        }),
      ).rejects.toThrow('account_not_available');
    });

    it('refuses an account already connected in this workspace', async () => {
      const crypto = new SettingsCryptoService();
      const existing = buildRow({
        id: 'existing-connection',
        connectionStatus: 'connected',
        externalAccountId: 'act_1111111111',
        credentialRemovedAt: null,
      });
      const harness = createHarness({
        queryResults: [awaitingRow(crypto), existing],
      });

      await expect(
        harness.service.select({
          tenantId: 'tenant-a',
          workspaceId: 'workspace-a',
          userId: 'user-a',
          connectionId: 'connection-id',
          externalAccountId: 'act_1111111111',
        }),
      ).rejects.toThrow('account_already_connected');
    });

    it('reuses a previously disconnected row instead of duplicating it', async () => {
      const crypto = new SettingsCryptoService();
      const disconnected = buildRow({
        id: 'existing-connection',
        connectionStatus: 'disconnected',
        externalAccountId: 'act_1111111111',
        credentialRemovedAt: new Date('2026-07-01T00:00:00.000Z'),
        credentialVersion: 4,
      });
      const pending = awaitingRow(crypto);
      const harness = createHarness({ queryResults: [pending, disconnected] });

      const view = await harness.service.select({
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        userId: 'user-a',
        connectionId: 'connection-id',
        externalAccountId: 'act_1111111111',
      });

      expect(view.id).toBe('existing-connection');
      expect(disconnected.connectionStatus).toBe('connected');
      expect(disconnected.credentialRemovedAt).toBeNull();
      expect(disconnected.credentialVersion).toBe(5);
      expect(harness.transactionRepository.delete).toHaveBeenCalledWith({
        id: 'connection-id',
      });
    });

    it('refuses a connection that is not awaiting selection', async () => {
      const harness = createHarness({
        queryResults: [buildRow({ connectionStatus: 'pending' }), null],
      });

      await expect(
        harness.service.select({
          tenantId: 'tenant-a',
          workspaceId: 'workspace-a',
          userId: 'user-a',
          connectionId: 'connection-id',
          externalAccountId: 'act_1111111111',
        }),
      ).rejects.toThrow('connection_consumed');
    });

    it('refuses a selection by someone other than the authorizing user', async () => {
      const crypto = new SettingsCryptoService();
      const harness = createHarness({
        queryResults: [awaitingRow(crypto), null],
      });

      await expect(
        harness.service.select({
          tenantId: 'tenant-a',
          workspaceId: 'workspace-a',
          userId: 'another-user',
          connectionId: 'connection-id',
          externalAccountId: 'act_1111111111',
        }),
      ).rejects.toThrow('invalid_connection');
    });

    it('refuses a connection outside the caller tenant', async () => {
      // The scope predicates are part of the lookup, so an out-of-scope id
      // simply finds nothing.
      const harness = createHarness({ queryResults: [null, null] });

      await expect(
        harness.service.select({
          tenantId: 'tenant-b',
          workspaceId: 'workspace-a',
          userId: 'user-a',
          connectionId: 'connection-id',
          externalAccountId: 'act_1111111111',
        }),
      ).rejects.toThrow('invalid_connection');
    });

    it('refuses when the stored credential cannot be decrypted', async () => {
      const row = buildRow({
        connectionStatus: 'awaiting_selection',
        accessTokenEncrypted: 'not-a-valid-ciphertext',
        metadata: {
          selectableAccounts: AD_ACCOUNTS.map((account) => ({ ...account })),
        },
      });
      const harness = createHarness({ queryResults: [row, null] });

      await expect(
        harness.service.select({
          tenantId: 'tenant-a',
          workspaceId: 'workspace-a',
          userId: 'user-a',
          connectionId: 'connection-id',
          externalAccountId: 'act_1111111111',
        }),
      ).rejects.toThrow('credential_decryption_failed');
    });
  });

  describe('frontend redirect target', () => {
    it('falls back to the platform frontend when SOCIAL_FRONTEND_URL is blank', () => {
      // .env.example ships this key empty; copying it forward must not read as
      // "configured to nothing" and break the callback redirect.
      process.env.SOCIAL_FRONTEND_URL = '';
      process.env.APP_FRONTEND_URL = 'https://agency.example.com';

      expect(requireSocialFrontendUrl().origin).toBe(
        'https://agency.example.com',
      );
    });

    it('prefers SOCIAL_FRONTEND_URL when it is set', () => {
      process.env.SOCIAL_FRONTEND_URL = 'https://social.example.com';
      process.env.APP_FRONTEND_URL = 'https://agency.example.com';

      expect(requireSocialFrontendUrl().origin).toBe(
        'https://social.example.com',
      );
    });

    it('fails when neither is configured', () => {
      delete process.env.SOCIAL_FRONTEND_URL;
      delete process.env.APP_FRONTEND_URL;

      expect(() => requireSocialFrontendUrl()).toThrow(BadRequestException);
    });
  });
});
