/* eslint-disable @typescript-eslint/require-await -- controller test doubles expose partial service shapes. */
import 'reflect-metadata';
import { BadRequestException, HttpException } from '@nestjs/common';
import type { RequestContext } from '../../common/context/request-context.interface';
import {
  PERMISSION_KEY_METADATA,
  PRODUCT_ENTITLEMENT_METADATA,
} from '../permissions/decorators/permissions.decorators';
import { SocialAdCredentialError } from './credentials/social-ad-credential.error';
import { MetaGraphError } from './services/meta-graph-error';
import {
  SocialAdInsightsTruncatedError,
  SocialAdInsightsWindowNotClosedError,
} from './sync/social-ad-insights.error';
import type { SocialAdBackfillResumeService } from './services/social-ad-backfill-resume.service';
import type { MetaAdsOAuthService } from './services/meta-ads-oauth.service';
import type { MetaAdsSystemUserService } from './services/meta-ads-system-user.service';
import type { SocialAdConnectionService } from './services/social-ad-connection.service';
import type { SocialAdHierarchySyncService } from './services/social-ad-hierarchy-sync.service';
import type { SocialAdInsightsSyncService } from './services/social-ad-insights-sync.service';
import type { SocialAdSyncRunService } from './services/social-ad-sync-run.service';
import {
  SocialAdBackfillResumeError,
  SocialAdSyncDisabledError,
} from './sync/social-ad-sync-run.error';
import { SocialIntegrationsController } from './social-integrations.controller';

const GUARDED_HANDLERS = [
  'connectMetaAds',
  'selectMetaAdsAccount',
  'listConnections',
  'disconnect',
  // The internal routes are not a side door: they carry the same entitlement
  // and the same admin permission as everything else on this controller.
  'internalAvailability',
  'listInternalAdAccounts',
  'selectInternalAdAccount',
  'internalHealth',
  // The manual sync reads an ad account with a stored credential: same
  // entitlement, same admin permission as the routes that bind one.
  'syncConnectionEntities',
  'syncConnectionInsights',
  // Queueing a sync and reading the run history are the same act as running
  // one: both name a connection whose credential reads somebody's ad spend.
  'enqueueConnectionSync',
  'listConnectionSyncRuns',
  // Resuming a stalled backfill queues a read of the same ad account, so it
  // carries the same entitlement and permission as queueing any other sync.
  'resumeConnectionBackfill',
] as const;

function createHarness(
  options: {
    internalAvailable?: boolean;
    syncFailure?: Error;
    insightsFailure?: Error;
    enqueueFailure?: Error;
  } = {},
) {
  const selectInputs: Record<string, unknown>[] = [];
  const internalInputs: Record<string, unknown>[] = [];
  const syncInputs: Record<string, unknown>[] = [];
  const insightsInputs: Record<string, unknown>[] = [];
  const runInputs: Record<string, unknown>[] = [];

  const oauth = {
    start: jest.fn(async () => ({
      connectionId: 'connection-id',
      authorizationUrl: 'https://www.facebook.com/v25.0/dialog/oauth?x=1',
      expiresAt: new Date().toISOString(),
    })),
    select: jest.fn((input: Record<string, unknown>) => {
      selectInputs.push(input);
      return Promise.resolve({ id: 'connection-id' });
    }),
    handleCallback: jest.fn(
      async () => 'https://agency.example.com/social/settings',
    ),
  };

  const connections = {
    list: jest.fn(async () => [{ id: 'connection-id' }]),
    disconnect: jest.fn(async () => ({ id: 'connection-id' })),
  };

  const systemUser = {
    isAvailable: jest.fn(() => options.internalAvailable ?? false),
    listAdAccounts: jest.fn((input: Record<string, unknown>) => {
      internalInputs.push(input);
      return Promise.resolve([{ externalAccountId: 'act_1' }]);
    }),
    select: jest.fn((input: Record<string, unknown>) => {
      internalInputs.push(input);
      return Promise.resolve({ id: 'connection-id' });
    }),
    health: jest.fn((input: Record<string, unknown>) => {
      internalInputs.push(input);
      return Promise.resolve({ connectionId: 'connection-id' });
    }),
  };

  const hierarchySync = {
    syncHierarchy: jest.fn((input: Record<string, unknown>) => {
      syncInputs.push(input);

      if (options.syncFailure) return Promise.reject(options.syncFailure);

      return Promise.resolve({
        connectionId: input.connectionId,
        entitiesWritten: 3,
      });
    }),
  };

  const insightsSync = {
    syncInsights: jest.fn((input: Record<string, unknown>) => {
      insightsInputs.push(input);

      if (options.insightsFailure) {
        return Promise.reject(options.insightsFailure);
      }

      return Promise.resolve({
        connectionId: input.connectionId,
        rowsWritten: 17,
      });
    }),
  };

  const syncRuns = {
    request: jest.fn((input: Record<string, unknown>) => {
      runInputs.push(input);

      if (options.enqueueFailure) {
        return Promise.reject(options.enqueueFailure);
      }

      return Promise.resolve({
        run: { id: 'run-a', status: 'queued' },
        deduplicated: false,
      });
    }),
    listRecent: jest.fn((input: Record<string, unknown>) => {
      runInputs.push(input);

      return Promise.resolve([{ id: 'run-a', status: 'succeeded' }]);
    }),
  };

  const backfillResume = {
    resume: jest.fn((input: Record<string, unknown>) => {
      runInputs.push(input);

      return Promise.resolve({
        run: { id: 'run-resume', status: 'queued' },
        deduplicated: false,
      });
    }),
  };

  const controller = new SocialIntegrationsController(
    oauth as unknown as MetaAdsOAuthService,
    connections as unknown as SocialAdConnectionService,
    systemUser as unknown as MetaAdsSystemUserService,
    hierarchySync as unknown as SocialAdHierarchySyncService,
    insightsSync as unknown as SocialAdInsightsSyncService,
    syncRuns as unknown as SocialAdSyncRunService,
    backfillResume as unknown as SocialAdBackfillResumeService,
  );

  return {
    controller,
    oauth,
    connections,
    systemUser,
    hierarchySync,
    insightsSync,
    syncRuns,
    backfillResume,
    selectInputs,
    internalInputs,
    syncInputs,
    insightsInputs,
    runInputs,
  };
}

function context(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    userId: 'user-a',
    ...overrides,
  };
}

describe('SocialIntegrationsController metadata', () => {
  it.each(GUARDED_HANDLERS)(
    '%s requires the social entitlement and the integrations permission',
    (handler) => {
      const target = (
        SocialIntegrationsController.prototype as unknown as Record<
          string,
          () => unknown
        >
      )[handler];

      expect(Reflect.getMetadata(PRODUCT_ENTITLEMENT_METADATA, target)).toBe(
        'social',
      );
      expect(Reflect.getMetadata(PERMISSION_KEY_METADATA, target)).toBe(
        'social.settings.integrations.manage.admin',
      );
    },
  );

  it('leaves the provider callback unguarded, since it carries no session', () => {
    const target = (
      SocialIntegrationsController.prototype as unknown as Record<
        string,
        () => unknown
      >
    ).metaAdsCallback;

    expect(
      Reflect.getMetadata(PRODUCT_ENTITLEMENT_METADATA, target),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(PERMISSION_KEY_METADATA, target),
    ).toBeUndefined();
  });
});

describe('SocialIntegrationsController scope resolution', () => {
  it('binds a connection to the client of the resolved managed context', async () => {
    const harness = createHarness();

    await harness.controller.connectMetaAds(
      context({
        managedContext: {
          productKey: 'social',
          operatingMode: 'client',
          clientId: 'client-a',
          managedTenantId: 'managed-a',
        },
      }),
    );

    expect(harness.oauth.start).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        agencyClientId: 'client-a',
      }),
    );
  });

  it('binds to no client in agency mode', async () => {
    const harness = createHarness();

    await harness.controller.connectMetaAds(
      context({
        managedContext: {
          productKey: 'social',
          operatingMode: 'agency',
          clientId: null,
          managedTenantId: null,
        },
      }),
    );

    expect(harness.oauth.start).toHaveBeenCalledWith(
      expect.objectContaining({ agencyClientId: null }),
    );
  });

  it('ignores a client id supplied in the request body', async () => {
    const harness = createHarness();

    await harness.controller.selectMetaAdsAccount(
      context({
        managedContext: {
          productKey: 'social',
          operatingMode: 'client',
          clientId: 'client-a',
          managedTenantId: 'managed-a',
        },
      }),
      {
        connectionId: '11111111-1111-4111-8111-111111111111',
        externalAccountId: 'act_1234567890',
        // A body field the DTO does not declare; the global ValidationPipe
        // rejects it in production, and nothing reads it here either.
        agencyClientId: 'client-b',
      } as never,
    );

    const call = harness.selectInputs[0];

    expect(call).not.toHaveProperty('agencyClientId');
    expect(call.tenantId).toBe('tenant-a');
  });

  it('refuses a request without tenant or workspace context', async () => {
    const harness = createHarness();

    await expect(
      harness.controller.listConnections(context({ workspaceId: undefined })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses client mode without a resolved client', async () => {
    const harness = createHarness();

    await expect(
      harness.controller.listConnections(
        context({
          managedContext: {
            productKey: 'social',
            operatingMode: 'client',
            clientId: null,
            managedTenantId: null,
          },
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('never offers the internal method in client mode', () => {
    const harness = createHarness({ internalAvailable: true });

    harness.controller.internalAvailability(
      context({
        managedContext: {
          productKey: 'social',
          operatingMode: 'client',
          clientId: 'client-a',
          managedTenantId: 'managed-a',
        },
      }),
    );

    // The gate is asked with the resolved client, so a managed client inside
    // the internal tenant is still a third party to the System User.
    expect(harness.systemUser.isAvailable).toHaveBeenCalledWith(
      expect.objectContaining({ agencyClientId: 'client-a' }),
    );
  });

  it('reports the internal method as unavailable rather than failing', () => {
    const harness = createHarness({ internalAvailable: false });

    expect(harness.controller.internalAvailability(context())).toEqual({
      available: false,
    });
  });

  it('passes the server-resolved scope to every internal route', async () => {
    const harness = createHarness({ internalAvailable: true });

    await harness.controller.selectInternalAdAccount(context(), {
      externalAccountId: 'act_1234567890',
      // Not declared by the DTO; the ValidationPipe strips it in production
      // and nothing reads it here either.
      tenantId: 'tenant-b',
    } as never);

    const call = harness.internalInputs[0];

    expect(call.tenantId).toBe('tenant-a');
    expect(call.workspaceId).toBe('workspace-a');
    expect(call.agencyClientId).toBeNull();
    expect(call.externalAccountId).toBe('act_1234567890');
  });

  it('syncs under the resolved scope, taking only the id from the path', async () => {
    const harness = createHarness();
    const connectionId = '11111111-1111-4111-8111-111111111111';

    await harness.controller.syncConnectionEntities(
      context({
        managedContext: {
          productKey: 'social',
          operatingMode: 'client',
          clientId: 'client-a',
          managedTenantId: 'managed-a',
        },
      }),
      connectionId,
    );

    // The whole isolation story of this endpoint: everything but the id comes
    // from the authenticated context, so there is no request field that could
    // name another tenant, workspace or client.
    expect(harness.syncInputs[0]).toEqual({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: 'client-a',
      connectionId,
    });
  });

  it('answers 404 for a connection outside the caller scope', async () => {
    const harness = createHarness({
      syncFailure: new SocialAdCredentialError('connection_not_found'),
    });

    // Another tenant's connection, another workspace's, another client's and an
    // id that never existed are all this same refusal — the resolver's lookup
    // is scoped, so it cannot tell them apart and neither can a caller.
    await expect(
      harness.controller.syncConnectionEntities(
        context(),
        '11111111-1111-4111-8111-111111111111',
      ),
    ).rejects.toMatchObject({
      status: 404,
      response: { code: 'connection_not_found' },
    });
  });

  it('answers 429 rather than 400 when Meta throttles the read', async () => {
    const harness = createHarness({
      syncFailure: new MetaGraphError({
        kind: 'rate_limited',
        safeMessage: 'Meta Ads campaigns read failed.',
      }),
    });

    // `MetaGraphError` extends `BadRequestException` for S1 reasons; letting it
    // through unmapped would tell the caller their request was malformed.
    const failure = await harness.controller
      .syncConnectionEntities(context(), '11111111-1111-4111-8111-111111111111')
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(HttpException);
    expect((failure as HttpException).getStatus()).toBe(429);
  });

  it('ingests under the resolved scope, taking only the window from the body', async () => {
    const harness = createHarness();
    const connectionId = '11111111-1111-4111-8111-111111111111';

    await harness.controller.syncConnectionInsights(
      context({
        managedContext: {
          productKey: 'social',
          operatingMode: 'client',
          clientId: 'client-a',
          managedTenantId: 'managed-a',
        },
      }),
      connectionId,
      {
        since: '2026-06-01',
        until: '2026-08-25',
        // Not declared by the DTO. The global ValidationPipe rejects it in
        // production with `forbidNonWhitelisted`, and nothing reads it here.
        tenantId: 'tenant-b',
        workspaceId: 'workspace-b',
        agencyClientId: 'client-b',
      } as never,
    );

    // The isolation story of this endpoint: the only things the request
    // contributes are the connection id and two dates.
    expect(harness.insightsInputs[0]).toEqual({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: 'client-a',
      connectionId,
      since: '2026-06-01',
      until: '2026-08-25',
    });
  });

  it('answers 404 for an insights ingest outside the caller scope', async () => {
    const harness = createHarness({
      insightsFailure: new SocialAdCredentialError('connection_not_found'),
    });

    // Another tenant's connection, another workspace's and another client's are
    // all this same refusal, identical to an id that never existed.
    await expect(
      harness.controller.syncConnectionInsights(
        context(),
        '11111111-1111-4111-8111-111111111111',
        { since: '2026-06-01', until: '2026-08-25' },
      ),
    ).rejects.toMatchObject({
      status: 404,
      response: { code: 'connection_not_found' },
    });
  });

  it('answers 409 when the requested window returns more rows than one read allows', async () => {
    const harness = createHarness({
      insightsFailure: new SocialAdInsightsTruncatedError('campaign'),
    });

    const failure = await harness.controller
      .syncConnectionInsights(
        context(),
        '11111111-1111-4111-8111-111111111111',
        {
          since: '2026-06-01',
          until: '2026-08-25',
        },
      )
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(HttpException);
    expect((failure as HttpException).getStatus()).toBe(409);
    expect((failure as HttpException).getResponse()).toMatchObject({
      code: 'insights_window_truncated',
    });
  });

  it('answers 409 with the boundary when the window is not closed yet', async () => {
    const harness = createHarness({
      insightsFailure: new SocialAdInsightsWindowNotClosedError(
        '2026-08-25',
        'America/Sao_Paulo',
      ),
    });

    const failure = await harness.controller
      .syncConnectionInsights(
        context(),
        '11111111-1111-4111-8111-111111111111',
        { since: '2026-08-20', until: '2026-08-26' },
      )
      .catch((error: unknown) => error);

    expect((failure as HttpException).getStatus()).toBe(409);
    expect((failure as HttpException).getResponse()).toMatchObject({
      code: 'insights_window_not_closed',
      // Actionable: the caller cannot derive the account's own day from
      // anything it sent.
      maxUntil: '2026-08-25',
      timezone: 'America/Sao_Paulo',
    });
  });

  it('enqueues under the resolved scope, taking only the window from the body', async () => {
    const harness = createHarness();
    const connectionId = '11111111-1111-4111-8111-111111111111';

    await harness.controller.enqueueConnectionSync(
      context({
        managedContext: {
          productKey: 'social',
          operatingMode: 'client',
          clientId: 'client-a',
          managedTenantId: 'managed-a',
        },
      }),
      connectionId,
      {
        since: '2026-08-01',
        until: '2026-08-25',
        // Not declared by the DTO; the ValidationPipe rejects it in production
        // and nothing reads it here either. It matters more on this endpoint
        // than on a synchronous one: a run is a stored instruction a worker
        // executes later, with no request context left to check it against.
        tenantId: 'tenant-b',
        workspaceId: 'workspace-b',
        agencyClientId: 'client-b',
      } as never,
    );

    expect(harness.runInputs[0]).toEqual({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: 'client-a',
      connectionId,
      since: '2026-08-01',
      until: '2026-08-25',
      requestedById: 'user-a',
    });
  });

  it('enqueues a hierarchy refresh when no window is given', async () => {
    const harness = createHarness();

    await harness.controller.enqueueConnectionSync(
      context(),
      '11111111-1111-4111-8111-111111111111',
      {},
    );

    expect(harness.runInputs[0]).toMatchObject({
      since: undefined,
      until: undefined,
    });
  });

  it('answers 503 rather than queueing when the runtime is off', async () => {
    const harness = createHarness({
      enqueueFailure: new SocialAdSyncDisabledError(),
    });

    // The alternative is a 202 for work nothing will do: the list fills with
    // runs that never start, which looks exactly like a wedged worker.
    const failure = await harness.controller
      .enqueueConnectionSync(
        context(),
        '11111111-1111-4111-8111-111111111111',
        {
          since: '2026-08-01',
          until: '2026-08-25',
        },
      )
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(HttpException);
    expect((failure as HttpException).getStatus()).toBe(503);
    expect((failure as HttpException).getResponse()).toMatchObject({
      code: 'sync_disabled',
    });
  });

  it('answers 404 for an enqueue against a connection outside the scope', async () => {
    const harness = createHarness({
      enqueueFailure: new SocialAdCredentialError('connection_not_found'),
    });

    await expect(
      harness.controller.enqueueConnectionSync(
        context(),
        '11111111-1111-4111-8111-111111111111',
        { since: '2026-08-01', until: '2026-08-25' },
      ),
    ).rejects.toMatchObject({
      status: 404,
      response: { code: 'connection_not_found' },
    });
  });

  it('resumes a backfill under the resolved scope, with no window from the caller', async () => {
    const harness = createHarness();
    const connectionId = '11111111-1111-4111-8111-111111111111';

    const result = await harness.controller.resumeConnectionBackfill(
      context({
        managedContext: {
          productKey: 'social',
          operatingMode: 'client',
          clientId: 'client-a',
          managedTenantId: 'managed-a',
        },
      }),
      connectionId,
    );

    // No dates cross this boundary: the window is a chunk of the connection's
    // existing plan, and a caller-named one would belong to no chunk.
    expect(harness.runInputs[0]).toEqual({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: 'client-a',
      connectionId,
      requestedById: 'user-a',
    });
    expect(result).toMatchObject({ run: { id: 'run-resume' } });
  });

  it('maps a refusal to resume onto a 409 with its own code', async () => {
    const harness = createHarness();

    harness.backfillResume.resume.mockRejectedValueOnce(
      new SocialAdBackfillResumeError('backfill_chain_complete'),
    );

    const failure = await harness.controller
      .resumeConnectionBackfill(
        context(),
        '11111111-1111-4111-8111-111111111111',
      )
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(HttpException);
    expect((failure as HttpException).getStatus()).toBe(409);
    expect((failure as HttpException).getResponse()).toMatchObject({
      code: 'backfill_chain_complete',
    });
  });

  it('answers 404 for a resume against a connection outside the scope', async () => {
    const harness = createHarness();

    harness.backfillResume.resume.mockRejectedValueOnce(
      new SocialAdCredentialError('connection_not_found'),
    );

    await expect(
      harness.controller.resumeConnectionBackfill(
        context(),
        '11111111-1111-4111-8111-111111111111',
      ),
    ).rejects.toMatchObject({
      status: 404,
      response: { code: 'connection_not_found' },
    });
  });

  it('lists runs under the resolved scope', async () => {
    const harness = createHarness();
    const connectionId = '11111111-1111-4111-8111-111111111111';

    const result = await harness.controller.listConnectionSyncRuns(
      context({
        managedContext: {
          productKey: 'social',
          operatingMode: 'client',
          clientId: 'client-a',
          managedTenantId: 'managed-a',
        },
      }),
      connectionId,
    );

    expect(harness.runInputs[0]).toEqual({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: 'client-a',
      connectionId,
    });
    expect(result).toEqual({
      items: [{ id: 'run-a', status: 'succeeded' }],
      total: 1,
    });
  });

  it('passes the caller scope to the disconnect lookup', async () => {
    const harness = createHarness();

    await harness.controller.disconnect(
      context({
        managedContext: {
          productKey: 'social',
          operatingMode: 'client',
          clientId: 'client-a',
          managedTenantId: 'managed-a',
        },
      }),
      '11111111-1111-4111-8111-111111111111',
    );

    expect(harness.connections.disconnect).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: 'client-a',
      connectionId: '11111111-1111-4111-8111-111111111111',
    });
  });
});
