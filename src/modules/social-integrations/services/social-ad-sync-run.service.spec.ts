/* eslint-disable @typescript-eslint/require-await -- run service test doubles expose partial repository shapes. */
import { BadRequestException } from '@nestjs/common';
import type { DataSource, Repository } from 'typeorm';
import { QueryFailedError } from 'typeorm';
import type { ResolvedAdCredential } from '../credentials/resolved-ad-credential';
import { SocialAdCredentialError } from '../credentials/social-ad-credential.error';
import type { SocialAdCredentialResolver } from '../credentials/social-ad-credential.resolver';
import type { SocialAdSyncRunEntity } from '../entities/social-ad-sync-run.entity';
import { SocialAdInsightsWindowNotClosedError } from '../sync/social-ad-insights.error';
import { SocialAdSyncDisabledError } from '../sync/social-ad-sync-run.error';
import type { SocialAdSyncConfigService } from './social-ad-sync-config.service';
import { SocialAdSyncRunService } from './social-ad-sync-run.service';

const CREDENTIAL = {
  connectionId: 'connection-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  agencyClientId: null,
  provider: 'meta_ads',
  externalAccountId: 'act_415877197389621',
  currency: 'BRL',
  timezone: 'America/Sao_Paulo',
} as unknown as ResolvedAdCredential;

/** 2026-08-26 22:00 in São Paulo; the account's last settled day is the 25th. */
const NOW = new Date('2026-08-27T01:00:00.000Z');

function uniqueViolation() {
  return new QueryFailedError('insert', [], {
    code: '23505',
    constraint: 'UQ_social_ad_sync_runs_inflight',
  } as unknown as Error);
}

function createHarness(
  options: {
    enabled?: boolean;
    resolveError?: Error;
    saveError?: Error;
    inFlight?: Partial<SocialAdSyncRunEntity> | null;
    found?: Partial<SocialAdSyncRunEntity>[];
  } = {},
) {
  const saved: Partial<SocialAdSyncRunEntity>[] = [];
  const findOneArgs: unknown[] = [];
  const findArgs: unknown[] = [];

  const repository = {
    create: jest.fn((row: Partial<SocialAdSyncRunEntity>) => row),
    save: jest.fn(async (row: Partial<SocialAdSyncRunEntity>) => {
      saved.push(row);

      if (options.saveError) throw options.saveError;

      return {
        ...row,
        id: 'run-a',
        availableAt: new Date(),
        createdAt: new Date(),
        startedAt: null,
        finishedAt: null,
        attempts: 0,
        maxAttempts: 5,
        rowsWritten: 0,
        rowsSkipped: 0,
        entitiesWritten: 0,
        apiCalls: 0,
        lastError: null,
        failedSegments: [],
      };
    }),
    findOne: jest.fn(async (args: unknown) => {
      findOneArgs.push(args);

      return options.inFlight
        ? {
            id: 'run-existing',
            status: 'processing',
            runKind: 'manual',
            connectionId: 'connection-a',
            windowStart: '2026-08-01',
            windowEnd: '2026-08-25',
            availableAt: new Date(),
            createdAt: new Date(),
            startedAt: null,
            finishedAt: null,
            attempts: 1,
            maxAttempts: 5,
            rowsWritten: 0,
            rowsSkipped: 0,
            entitiesWritten: 0,
            apiCalls: 0,
            lastError: null,
            failedSegments: [],
            ...options.inFlight,
          }
        : null;
    }),
    find: jest.fn(async (args: unknown) => {
      findArgs.push(args);

      return options.found ?? [];
    }),
    count: jest.fn(async () => 0),
  };

  const dataSource = { query: jest.fn(async () => []) };

  const credentialResolver = {
    resolve: jest.fn(async () => {
      if (options.resolveError) throw options.resolveError;

      return CREDENTIAL;
    }),
  };

  const config = {
    get enabled() {
      return options.enabled ?? true;
    },
  } as SocialAdSyncConfigService;

  const service = new SocialAdSyncRunService(
    repository as unknown as Repository<SocialAdSyncRunEntity>,
    dataSource as unknown as DataSource,
    credentialResolver as unknown as SocialAdCredentialResolver,
    config,
  );

  return {
    service,
    repository,
    dataSource,
    credentialResolver,
    saved,
    findOneArgs,
    findArgs,
  };
}

const REQUEST = {
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  agencyClientId: null,
  connectionId: 'connection-a',
  since: '2026-08-01',
  until: '2026-08-25',
  requestedById: 'user-a',
  now: NOW,
};

describe('SocialAdSyncRunService.request', () => {
  it('queues a full run for a closed window', async () => {
    const harness = createHarness();

    const result = await harness.service.request(REQUEST);

    expect(result.deduplicated).toBe(false);
    expect(harness.saved[0]).toMatchObject({
      runKind: 'manual',
      status: 'queued',
      windowStart: '2026-08-01',
      windowEnd: '2026-08-25',
      requestedById: 'user-a',
    });
  });

  it('queues a hierarchy refresh when no window is given', async () => {
    const harness = createHarness();

    await harness.service.request({
      ...REQUEST,
      since: undefined,
      until: undefined,
    });

    expect(harness.saved[0]).toMatchObject({
      runKind: 'entities',
      windowStart: null,
      windowEnd: null,
    });
  });

  it('refuses half a window instead of answering a different question', async () => {
    const harness = createHarness();

    // Reading one date as "no window" would run a hierarchy refresh and look
    // like it accepted the request that was actually made.
    await expect(
      harness.service.request({ ...REQUEST, until: undefined }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(harness.repository.save).not.toHaveBeenCalled();
  });

  it('refuses a window that reaches into an unfinished day', async () => {
    const harness = createHarness();

    // 22:00 in São Paulo on the 26th: the account has not finished that day,
    // and a row written now with `is_partial = false` would never correct
    // itself.
    await expect(
      harness.service.request({ ...REQUEST, until: '2026-08-26' }),
    ).rejects.toBeInstanceOf(SocialAdInsightsWindowNotClosedError);
    expect(harness.repository.save).not.toHaveBeenCalled();
  });

  it('checks the window after the scoped lookup, never before', async () => {
    const harness = createHarness({
      resolveError: new SocialAdCredentialError('connection_not_found'),
    });

    // Answering the window first would turn the endpoint into an oracle: a
    // caller could learn a connection's timezone — and that it exists — by
    // watching which refusal comes back for somebody else's connection.
    await expect(
      harness.service.request({ ...REQUEST, until: '2026-08-26' }),
    ).rejects.toBeInstanceOf(SocialAdCredentialError);
  });

  it('takes scope and provider from the resolved row, not from the request', async () => {
    const harness = createHarness();

    await harness.service.request({
      ...REQUEST,
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
    });

    // A queued run is a stored instruction executed later with no request
    // context left to check it against, so it carries the stored truth.
    expect(harness.saved[0]).toMatchObject({
      tenantId: CREDENTIAL.tenantId,
      workspaceId: CREDENTIAL.workspaceId,
      agencyClientId: CREDENTIAL.agencyClientId,
      connectionId: CREDENTIAL.connectionId,
      provider: 'meta_ads',
    });
  });

  it('refuses to queue anything while the runtime is off', async () => {
    const harness = createHarness({ enabled: false });

    await expect(harness.service.request(REQUEST)).rejects.toBeInstanceOf(
      SocialAdSyncDisabledError,
    );

    // Not even a lookup: a disabled queue that fills with runs nothing drains
    // is indistinguishable from a wedged worker.
    expect(harness.credentialResolver.resolve).not.toHaveBeenCalled();
    expect(harness.repository.save).not.toHaveBeenCalled();
  });

  it('does not let the token reach the stored run', async () => {
    const harness = createHarness();

    await harness.service.request(REQUEST);

    expect(JSON.stringify(harness.saved[0])).not.toContain('accessToken');
  });
});

describe('SocialAdSyncRunService.enqueue idempotency', () => {
  it('hands back the run already in flight instead of creating a second', async () => {
    const harness = createHarness({
      saveError: uniqueViolation(),
      inFlight: { id: 'run-existing' },
    });

    const result = await harness.service.request(REQUEST);

    expect(result).toMatchObject({
      deduplicated: true,
      run: { id: 'run-existing' },
    });
  });

  it('lets the database decide, rather than reading before writing', async () => {
    const harness = createHarness({
      saveError: uniqueViolation(),
      inFlight: { id: 'run-existing' },
    });

    await harness.service.request(REQUEST);

    // A check-then-insert is two statements with a gap, and two callers inside
    // that gap both find nothing and both insert — which is exactly the "sync
    // now" double-click this absorbs. The insert goes first; the partial index
    // is the arbiter.
    const saveOrder = harness.repository.save.mock.invocationCallOrder[0];
    const findOrder = harness.repository.findOne.mock.invocationCallOrder[0];

    expect(saveOrder).toBeLessThan(findOrder);
  });

  it('looks for the duplicate only among runs that are still live', async () => {
    const harness = createHarness({
      saveError: uniqueViolation(),
      inFlight: { id: 'run-existing' },
    });

    await harness.service.request(REQUEST);

    expect(harness.findOneArgs[0]).toMatchObject({
      where: [
        expect.objectContaining({ status: 'queued' }),
        expect.objectContaining({ status: 'processing' }),
      ] as unknown,
    });
  });

  it('retries when the colliding run finished in the meantime', async () => {
    const harness = createHarness({ saveError: uniqueViolation() });

    // The in-flight row released the partial index between the failed insert
    // and the lookup. Retrying is correct — and bounded, so a caller is never
    // held on an unbounded loop.
    await expect(harness.service.request(REQUEST)).rejects.toBeInstanceOf(
      QueryFailedError,
    );
    expect(harness.repository.save).toHaveBeenCalledTimes(3);
  });

  it('never swallows a violation that is not the in-flight index', async () => {
    const harness = createHarness({
      saveError: new QueryFailedError('insert', [], {
        code: '23503',
      } as unknown as Error),
    });

    await expect(harness.service.request(REQUEST)).rejects.toBeInstanceOf(
      QueryFailedError,
    );
    expect(harness.repository.findOne).not.toHaveBeenCalled();
  });
});

describe('SocialAdSyncRunService.listRecent', () => {
  it('scopes the listing on the run rows themselves', async () => {
    const harness = createHarness({ found: [] });

    await harness.service.listRecent({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: 'client-a',
      connectionId: 'connection-a',
    });

    expect(harness.findArgs[0]).toMatchObject({
      where: {
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        agencyClientId: 'client-a',
        connectionId: 'connection-a',
      },
      order: { createdAt: 'DESC' },
    });
  });

  it('excludes client runs from an agency listing explicitly', async () => {
    const harness = createHarness({ found: [] });

    await harness.service.listRecent({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: null,
      connectionId: 'connection-a',
    });

    // A literal null reads as "no filter" in TypeORM, which here would list
    // every managed client's runs under the agency's own connection.
    const where = (
      harness.findArgs[0] as { where: { agencyClientId: unknown } }
    ).where;

    expect(where.agencyClientId).not.toBeNull();
    expect(where.agencyClientId).toMatchObject({
      '@instanceof': Symbol.for('FindOperator'),
    });
  });

  it('caps how much history one request can pull', async () => {
    const harness = createHarness({ found: [] });

    await harness.service.listRecent({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: null,
      connectionId: 'connection-a',
      limit: 10_000,
    });

    expect(harness.findArgs[0]).toMatchObject({ take: 100 });
  });

  it('returns sanitized views, never the rows', async () => {
    const harness = createHarness({
      found: [
        {
          id: 'run-a',
          connectionId: 'connection-a',
          runKind: 'manual',
          status: 'succeeded',
          windowStart: '2026-08-01',
          windowEnd: '2026-08-25',
          attempts: 1,
          maxAttempts: 5,
          rowsWritten: 34,
          rowsSkipped: 0,
          entitiesWritten: 12,
          apiCalls: 7,
          lastError: null,
          failedSegments: [],
          lockedBy: 'ip-10-0-0-4:31337:social-sync',
          cursorState: { after: 'QVFIUmx4' },
          tenantId: 'tenant-a',
          availableAt: new Date(),
          startedAt: null,
          finishedAt: null,
          createdAt: new Date(),
        },
      ],
    });

    const [view] = await harness.service.listRecent({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: null,
      connectionId: 'connection-a',
    });

    expect(view).not.toHaveProperty('lockedBy');
    expect(view).not.toHaveProperty('cursorState');
    expect(view).not.toHaveProperty('tenantId');
    expect(view).toMatchObject({ id: 'run-a', rowsWritten: 34 });
  });
});
