import { randomUUID } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { ClientAreaSettingsRegistry } from '../../common/client-area-bridge/client-area-settings.registry';
import { clientAreaOAuthRedirect } from '../../common/client-area-bridge/client-area-oauth-redirect';
import { MetaAdsOAuthService } from '../social-integrations/services/meta-ads-oauth.service';
import { hashOAuthState } from '../../common/meta/meta-oauth.support';

describe('CA14 OAuth session binding (canonical Ads service, provider mocked)', () => {
  const scope = {
    tenantId: randomUUID(),
    workspaceId: randomUUID(),
    agencyClientId: randomUUID(),
    companyContextId: randomUUID(),
  };
  const binding = {
    ...scope,
    userId: randomUUID(),
    sessionId: randomUUID(),
    module: 'social_campaigns' as const,
  };
  const savedFrontend = process.env.SOCIAL_FRONTEND_URL;
  beforeAll(() => {
    process.env.SOCIAL_FRONTEND_URL = 'https://agency.example.test';
  });
  afterAll(() => {
    if (savedFrontend === undefined) delete process.env.SOCIAL_FRONTEND_URL;
    else process.env.SOCIAL_FRONTEND_URL = savedFrontend;
  });
  function harness(company = scope.companyContextId) {
    const row = {
      ...scope,
      createdById: binding.userId,
      metadata: {
        clientAreaBinding: { ...binding, companyContextId: company },
      },
      connectionStatus: 'pending',
      oauthExpiresAt: new Date(Date.now() + 60000),
    };
    const q = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      setLock: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(row),
    };
    const repo = {
      createQueryBuilder: () => q,
      findOne: jest.fn().mockResolvedValue(row),
      save: jest.fn().mockResolvedValue(row),
    };
    const db = {
      transaction: (
        operation: (manager: {
          getRepository: () => typeof repo;
        }) => Promise<unknown>,
      ) => operation({ getRepository: () => repo }),
    };
    const graph = { exchangeOAuthCode: jest.fn() };
    const registry = new ClientAreaSettingsRegistry();
    const liveOwner = jest.fn().mockResolvedValue(undefined);
    registry.registerOAuthValidator(liveOwner);
    const service = new MetaAdsOAuthService(
      repo as never,
      db as never,
      graph as never,
      {} as never,
      {} as never,
      registry,
    );
    return { service, registry, row, graph, liveOwner, q };
  }
  it('refuses a different company before contacting Meta and hashes state lookup', async () => {
    const { service, graph, liveOwner, q } = harness(randomUUID());
    const redirect = await service.handleCallback({
      state: 'opaque-state',
      code: 'provider-code',
    });
    expect(redirect).toContain('status=error');
    expect(q.where).toHaveBeenCalledWith(
      'connection.oauthStateHash = :stateHash',
      { stateHash: hashOAuthState('opaque-state') },
    );
    expect(graph.exchangeOAuthCode).not.toHaveBeenCalled();
    expect(liveOwner).not.toHaveBeenCalled();
  });
  it('rechecks the live session/current Owner before any token exchange', async () => {
    const { service, graph, liveOwner } = harness();
    liveOwner.mockRejectedValueOnce(
      new UnauthorizedException('revoked or no longer Owner'),
    );
    const redirect = await service.handleCallback({
      state: 'opaque-state',
      code: 'provider-code',
    });
    expect(redirect).toContain(
      `/client-area/c/${scope.companyContextId}/settings/integrations`,
    );
    expect(redirect).toContain('status=error');
    expect(graph.exchangeOAuthCode).not.toHaveBeenCalled();
    expect(redirect).not.toContain('provider-code');
  });
  it('refuses selection from another session, even for the same identity', async () => {
    const { service, graph, liveOwner, row } = harness();
    row.connectionStatus = 'awaiting_selection';
    await expect(
      service.select({
        ...scope,
        userId: binding.userId,
        clientAreaSessionId: randomUUID(),
        connectionId: randomUUID(),
        externalAccountId: 'account',
      }),
    ).rejects.toThrow('invalid_connection');
    expect(graph.exchangeOAuthCode).not.toHaveBeenCalled();
    expect(liveOwner).not.toHaveBeenCalled();
  });
  it('the canonical callback rejects replay and expired states before token exchange', async () => {
    const { service, graph, row } = harness();
    row.connectionStatus = 'awaiting_selection';
    expect(
      await service.handleCallback({
        state: 'opaque-state',
        code: 'provider-code',
      }),
    ).toContain('connection_consumed');
    row.connectionStatus = 'pending';
    row.oauthExpiresAt = new Date(Date.now() - 1000);
    expect(
      await service.handleCallback({
        state: 'opaque-state',
        code: 'provider-code',
      }),
    ).toContain('session_expired');
    expect(graph.exchangeOAuthCode).not.toHaveBeenCalled();
  });
  it('Agency redirects remain identical and client redirects cannot select another origin', () => {
    const target =
      'https://agency.example.test/social/channels/metaads?status=select_account';
    expect(clientAreaOAuthRedirect(target, {})).toBe(target);
    expect(
      new URL(clientAreaOAuthRedirect(target, { clientAreaBinding: binding }))
        .origin,
    ).toBe('https://agency.example.test');
    expect(
      clientAreaOAuthRedirect(target, {
        clientAreaBinding: {
          companyContextId: 'https://attacker.example.test',
        },
      }),
    ).toBe(target);
  });
});
