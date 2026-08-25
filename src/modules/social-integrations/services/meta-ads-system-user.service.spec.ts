/* eslint-disable @typescript-eslint/require-await -- TypeORM test doubles expose partial dynamic repository shapes. */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { DataSource, Repository } from 'typeorm';
import { SocialAdAccountConnectionEntity } from '../entities/social-ad-account-connection.entity';
import { SocialInternalAccessService } from '../internal/social-internal-access.service';
import { findForbiddenSocialIntegrationFields } from '../views/social-ad-connection.view';
import type { MetaAdsGraphService } from './meta-ads-graph.service';
import { MetaAdsSystemUserService } from './meta-ads-system-user.service';

const INTERNAL_TENANT = '3fcf6e35-9881-4713-b704-795956eec0c8';
const OTHER_TENANT = '8a2c1d44-0000-4000-8000-0000000000ff';
const SYSTEM_USER_TOKEN = 'SYSTEM-USER-TOKEN-VALUE';

/** The one account the exception covers. */
const INTERNAL_ACCOUNT = 'act_1111111111';

/**
 * A client's account, sitting in the same Business Manager and perfectly
 * readable by the same System User. Present in most fixtures on purpose: the
 * guardrail is only worth anything if it holds while the token *can* read the
 * account it is refusing.
 */
const CLIENT_ACCOUNT = 'act_2222222222';

const AD_ACCOUNTS = [
  {
    externalAccountId: INTERNAL_ACCOUNT,
    accountName: 'Talarico Labs — Institucional',
    currency: 'BRL',
    timezone: 'America/Sao_Paulo',
    accountStatus: '1',
    businessId: 'biz_internal',
    businessName: 'Talarico Labs',
  },
  {
    externalAccountId: CLIENT_ACCOUNT,
    accountName: 'Cliente — Performance',
    currency: 'BRL',
    timezone: 'America/Sao_Paulo',
    accountStatus: '1',
    businessId: 'biz_internal',
    businessName: 'Talarico Labs',
  },
];

function scope(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: INTERNAL_TENANT,
    workspaceId: 'workspace-a',
    agencyClientId: null,
    userId: 'user-a',
    ...overrides,
  } as never;
}

function buildRow(
  overrides: Partial<SocialAdAccountConnectionEntity> = {},
): SocialAdAccountConnectionEntity {
  return {
    id: 'connection-a',
    tenantId: INTERNAL_TENANT,
    workspaceId: 'workspace-a',
    agencyClientId: null,
    provider: 'meta_ads',
    authorizationMethod: 'internal_system_user',
    externalAccountId: 'act_1111111111',
    externalBusinessId: 'biz_internal',
    accountName: 'Talarico Labs — Institucional',
    currency: 'BRL',
    timezone: 'America/Sao_Paulo',
    connectionStatus: 'connected',
    credentialVersion: 1,
    accessTokenEncrypted: null,
    refreshTokenEncrypted: null,
    tokenExpiresAt: null,
    scopes: ['ads_read', 'business_management'],
    lastSyncedAt: null,
    lastSyncError: null,
    oauthStateHash: null,
    oauthExpiresAt: null,
    createdById: 'user-a',
    metadata: {},
    credentialRemovedAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  } as SocialAdAccountConnectionEntity;
}

function createHarness(
  options: {
    existing?: SocialAdAccountConnectionEntity | null;
    accounts?: typeof AD_ACCOUNTS;
    listThrows?: boolean;
  } = {},
) {
  const saved: SocialAdAccountConnectionEntity[] = [];

  const builder: Record<string, unknown> = {};
  for (const method of ['where', 'andWhere', 'setLock']) {
    builder[method] = jest.fn(() => builder);
  }
  builder.getOne = jest.fn(async () => options.existing ?? null);

  const repository = {
    createQueryBuilder: jest.fn(() => builder),
    create: jest.fn((row: Partial<SocialAdAccountConnectionEntity>) => ({
      id: 'new-connection-id',
      ...row,
    })),
    // TypeORM fills @CreateDateColumn / @UpdateDateColumn on insert, so a
    // double that returns the row untouched would be describing a row shape
    // that never reaches the view in production.
    save: jest.fn(async (row: SocialAdAccountConnectionEntity) => {
      row.createdAt ??= new Date('2026-08-25T12:00:00.000Z');
      row.updatedAt = new Date('2026-08-25T12:00:00.000Z');
      saved.push(row);
      return row;
    }),
  };

  const dataSource = {
    transaction: jest.fn(async (callback: (manager: unknown) => unknown) =>
      callback({ getRepository: () => repository }),
    ),
  };

  const listAdAccounts = jest.fn(async (token: string) => {
    if (options.listThrows) throw new Error('graph down');
    graphTokens.push(token);
    return options.accounts ?? AD_ACCOUNTS;
  });
  const graphTokens: string[] = [];

  const graph = { listAdAccounts };

  const service = new MetaAdsSystemUserService(
    repository as unknown as Repository<SocialAdAccountConnectionEntity>,
    dataSource as unknown as DataSource,
    graph as unknown as MetaAdsGraphService,
    new SocialInternalAccessService(),
  );

  return { service, repository, saved, graph, graphTokens };
}

describe('MetaAdsSystemUserService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      SOCIAL_META_ADS_INTERNAL_TENANT_ID: INTERNAL_TENANT,
      SOCIAL_META_ADS_INTERNAL_ACCOUNT_ID: INTERNAL_ACCOUNT,
      SOCIAL_META_ADS_SYSTEM_USER_TOKEN: SYSTEM_USER_TOKEN,
      // Present throughout: the internal path must never reach for them.
      SOCIAL_META_ADS_APP_ID: 'social-ads-app-id',
      SOCIAL_META_ADS_APP_SECRET: 'social-ads-app-secret',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('listAdAccounts', () => {
    it('exposes only the configured account, not everything the token reads', async () => {
      const harness = createHarness();

      const accounts = await harness.service.listAdAccounts(scope());

      // Meta answered with two accounts; one of them belongs to a client.
      expect(accounts).toEqual([
        {
          externalAccountId: INTERNAL_ACCOUNT,
          accountName: 'Talarico Labs — Institucional',
          currency: 'BRL',
          timezone: 'America/Sao_Paulo',
          businessName: 'Talarico Labs',
          accountStatus: '1',
        },
      ]);
      expect(JSON.stringify(accounts)).not.toContain(CLIENT_ACCOUNT);
      expect(harness.graphTokens).toEqual([SYSTEM_USER_TOKEN]);
    });

    it('matches the configured account across both Meta spellings', async () => {
      process.env.SOCIAL_META_ADS_INTERNAL_ACCOUNT_ID = '1111111111';
      const harness = createHarness();

      const accounts = await harness.service.listAdAccounts(scope());

      expect(accounts).toHaveLength(1);
      expect(accounts[0].externalAccountId).toBe(INTERNAL_ACCOUNT);
    });

    it('reports the configured account as inaccessible when Meta does not return it', async () => {
      // Configuration alone is not permission: the account has to be one the
      // System User can actually read.
      const harness = createHarness({
        accounts: [
          {
            ...AD_ACCOUNTS[1],
          },
        ],
      });

      await expect(harness.service.listAdAccounts(scope())).rejects.toThrow(
        'account_not_accessible',
      );
    });

    it('is unavailable when no account is configured', async () => {
      delete process.env.SOCIAL_META_ADS_INTERNAL_ACCOUNT_ID;
      const harness = createHarness();

      expect(harness.service.isAvailable(scope())).toBe(false);
      await expect(harness.service.listAdAccounts(scope())).rejects.toThrow(
        'SOCIAL_META_ADS_INTERNAL_ACCOUNT_ID is not configured.',
      );
    });

    it('refuses another tenant before calling Meta', async () => {
      const harness = createHarness();

      await expect(
        harness.service.listAdAccounts(scope({ tenantId: OTHER_TENANT })),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(harness.graph.listAdAccounts).not.toHaveBeenCalled();
    });

    it('refuses a managed client of the internal tenant', async () => {
      const harness = createHarness();

      await expect(
        harness.service.listAdAccounts(scope({ agencyClientId: 'client-a' })),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('fails explicitly when the token is not configured', async () => {
      delete process.env.SOCIAL_META_ADS_SYSTEM_USER_TOKEN;
      const harness = createHarness();

      await expect(harness.service.listAdAccounts(scope())).rejects.toThrow(
        'SOCIAL_META_ADS_SYSTEM_USER_TOKEN is not configured.',
      );
    });

    it('returns nothing that could identify the credential', async () => {
      const harness = createHarness();

      const serialized = JSON.stringify(
        await harness.service.listAdAccounts(scope()),
      );

      expect(serialized).not.toContain(SYSTEM_USER_TOKEN);
      expect(
        findForbiddenSocialIntegrationFields(JSON.parse(serialized) as unknown),
      ).toEqual([]);
    });
  });

  describe('select', () => {
    it('persists the connection without persisting the token', async () => {
      const harness = createHarness();

      await harness.service.select(
        scope({ externalAccountId: 'act_1111111111' }),
      );

      const row = harness.saved[0];

      expect(row.authorizationMethod).toBe('internal_system_user');
      expect(row.externalAccountId).toBe('act_1111111111');
      expect(row.externalBusinessId).toBe('biz_internal');
      expect(row.connectionStatus).toBe('connected');
      // The whole point: no credential column is written at all.
      expect(row.accessTokenEncrypted).toBeNull();
      expect(row.refreshTokenEncrypted).toBeNull();
      expect(row.tokenExpiresAt).toBeNull();
      expect(JSON.stringify(row)).not.toContain(SYSTEM_USER_TOKEN);
    });

    it('refuses an account the guardrail does not name', async () => {
      const harness = createHarness();

      await expect(
        harness.service.select(scope({ externalAccountId: 'act_9999999999' })),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(harness.repository.save).not.toHaveBeenCalled();
    });

    it("refuses a client's account even though the token can read it", async () => {
      // The failure this prevents: the agency's administrative credential used
      // to bind an account the client never authorized. The fixture makes the
      // account genuinely readable, so only the guardrail is standing here.
      const harness = createHarness();

      await expect(
        harness.service.select(scope({ externalAccountId: CLIENT_ACCOUNT })),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(harness.repository.save).not.toHaveBeenCalled();
      // Refused before the provider call, so the route cannot be used to probe
      // which accounts the System User can see either.
      expect(harness.graph.listAdAccounts).not.toHaveBeenCalled();
    });

    it('accepts the configured account in either spelling and stores the canonical one', async () => {
      const harness = createHarness();

      await harness.service.select(scope({ externalAccountId: '1111111111' }));

      expect(harness.saved[0].externalAccountId).toBe(INTERNAL_ACCOUNT);
    });

    it('re-reads the account from Meta instead of trusting the request', async () => {
      // Named in configuration, but the System User cannot read it.
      const harness = createHarness({ accounts: [AD_ACCOUNTS[1]] });

      await expect(
        harness.service.select(scope({ externalAccountId: INTERNAL_ACCOUNT })),
      ).rejects.toThrow('account_not_available');

      expect(harness.repository.save).not.toHaveBeenCalled();
    });

    it('cannot be talked past with a doubled or recased prefix', async () => {
      const harness = createHarness();

      for (const spelling of [
        'act_act_1111111111',
        'ACT_1111111111',
        'act_01111111111',
      ]) {
        await expect(
          harness.service.select(scope({ externalAccountId: spelling })),
        ).rejects.toBeInstanceOf(NotFoundException);
      }

      expect(harness.repository.save).not.toHaveBeenCalled();
    });

    it('refuses to re-bind an account that is already live', async () => {
      const harness = createHarness({ existing: buildRow() });

      await expect(
        harness.service.select(scope({ externalAccountId: 'act_1111111111' })),
      ).rejects.toThrow('account_already_connected');
    });

    it('never writes a connection for another tenant', async () => {
      const harness = createHarness();

      await expect(
        harness.service.select(
          scope({
            tenantId: OTHER_TENANT,
            externalAccountId: 'act_1111111111',
          }),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(harness.repository.save).not.toHaveBeenCalled();
    });

    it('binds to the agency context, never to a client', async () => {
      const harness = createHarness();

      await harness.service.select(
        scope({ externalAccountId: 'act_1111111111' }),
      );

      expect(harness.saved[0].agencyClientId).toBeNull();
    });

    it('returns a view carrying no credential', async () => {
      const harness = createHarness();

      const view = await harness.service.select(
        scope({ externalAccountId: 'act_1111111111' }),
      );

      expect(view.authorizationMethod).toBe('internal_system_user');
      expect(JSON.stringify(view)).not.toContain(SYSTEM_USER_TOKEN);
      expect(findForbiddenSocialIntegrationFields(view)).toEqual([]);
    });
  });

  describe('health', () => {
    it('reports a healthy connection', async () => {
      const harness = createHarness({ existing: buildRow() });

      const health = await harness.service.health(
        scope({ connectionId: 'connection-a' }),
      );

      expect(health).toMatchObject({
        tokenConfigured: true,
        graphReachable: true,
        accountAccessible: true,
        error: null,
      });
    });

    it('reports an unreachable Graph instead of throwing', async () => {
      const harness = createHarness({
        existing: buildRow(),
        listThrows: true,
      });

      const health = await harness.service.health(
        scope({ connectionId: 'connection-a' }),
      );

      expect(health).toMatchObject({
        tokenConfigured: true,
        graphReachable: false,
        error: 'graph_unreachable',
      });
    });

    it('reports an account the token can no longer read', async () => {
      const harness = createHarness({
        existing: buildRow(),
        accounts: [AD_ACCOUNTS[1]],
      });

      const health = await harness.service.health(
        scope({ connectionId: 'connection-a' }),
      );

      expect(health).toMatchObject({
        graphReachable: true,
        accountAccessible: false,
        error: 'account_not_accessible',
      });
    });

    it('reports a connection that drifted off the configured account', async () => {
      // Configuration can be re-pointed after a connection was made. Saying so
      // is a different repair from "Meta lost the account", so it is a
      // different code — and the check happens without asking Meta about an
      // account this connection may no longer use.
      const harness = createHarness({
        existing: buildRow({ externalAccountId: CLIENT_ACCOUNT }),
      });

      const health = await harness.service.health(
        scope({ connectionId: 'connection-a' }),
      );

      expect(health).toMatchObject({
        tokenConfigured: true,
        accountAccessible: false,
        error: 'account_not_allowed',
      });
      expect(harness.graph.listAdAccounts).not.toHaveBeenCalled();
    });

    it('tells a missing account apart from a missing token', async () => {
      delete process.env.SOCIAL_META_ADS_INTERNAL_ACCOUNT_ID;
      const harness = createHarness({ existing: buildRow() });

      const health = await harness.service.health(
        scope({ connectionId: 'connection-a' }),
      );

      expect(health).toMatchObject({
        tokenConfigured: true,
        error: 'internal_account_not_configured',
      });
    });

    it('reports a missing token without reaching Meta', async () => {
      delete process.env.SOCIAL_META_ADS_SYSTEM_USER_TOKEN;
      const harness = createHarness({ existing: buildRow() });

      const health = await harness.service.health(
        scope({ connectionId: 'connection-a' }),
      );

      expect(health).toMatchObject({
        tokenConfigured: false,
        error: 'system_user_token_missing',
      });
      expect(harness.graph.listAdAccounts).not.toHaveBeenCalled();
    });

    it('refuses to report on a connection of another tenant', async () => {
      const harness = createHarness({ existing: buildRow() });

      await expect(
        harness.service.health(
          scope({ tenantId: OTHER_TENANT, connectionId: 'connection-a' }),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses to report on a connection made through OAuth', async () => {
      const harness = createHarness({
        existing: buildRow({ authorizationMethod: 'business_login' }),
      });

      await expect(
        harness.service.health(scope({ connectionId: 'connection-a' })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('never leaks the token into the health payload', async () => {
      const harness = createHarness({ existing: buildRow() });

      const health = await harness.service.health(
        scope({ connectionId: 'connection-a' }),
      );

      expect(JSON.stringify(health)).not.toContain(SYSTEM_USER_TOKEN);
    });
  });
});
