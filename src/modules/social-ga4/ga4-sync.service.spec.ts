import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { QueryFailedError, type DataSource } from 'typeorm';
import { GoogleCredentialError } from '../social-google/social-google-authorization.service';
import { Ga4DataError, type Ga4DataClient } from './ga4-data.client';
import type { Ga4PropertyDirectoryService } from './ga4-property-directory.service';
import { Ga4SyncService } from './ga4-sync.service';

const scope = {
  tenantId: 't',
  workspaceId: 'w',
  agencyClientId: null,
  companyContextId: null,
};
const NOW = new Date('2026-11-13T12:00:00Z');
const dailyRow = {
  dimensions: ['20261111'],
  metrics: [10, 8, 3, 6, 30, 20, 50, 2, 9.5],
};

function build(options: {
  enabled?: boolean;
  properties?: Array<{ propertyId: string; timeZone: string | null }>;
  report?: jest.Mock;
  token?: jest.Mock;
  runCount?: number;
}) {
  if (options.enabled !== false) process.env.SOCIAL_GA4_SYNC_ENABLED = 'true';
  else delete process.env.SOCIAL_GA4_SYNC_ENABLED;

  const queries: Array<{ sql: string; params: unknown[] | undefined }> = [];
  const query = jest.fn((sql: string, params?: unknown[]) => {
    queries.push({ sql, params });
    if (/SELECT count\(\*\)/.test(sql)) {
      return Promise.resolve([{ count: String(options.runCount ?? 0) }]);
    }
    if (/INSERT INTO social_ga4_sync_runs/.test(sql)) {
      return Promise.resolve([{ id: 'run-1' }]);
    }
    return Promise.resolve([]);
  });
  const dataSource = {
    query,
    transaction: (work: (manager: { query: typeof query }) => Promise<void>) =>
      work({ query }),
  } as unknown as DataSource;
  const directory = {
    forScope: jest.fn().mockResolvedValue({
      scope,
      authorizationId: 'auth-1',
      properties: (
        options.properties ?? [
          { propertyId: '111', timeZone: 'America/Sao_Paulo' },
        ]
      ).map((property) => ({
        displayName: 'Site',
        accountId: '1',
        currency: 'BRL',
        ...property,
      })),
    }),
  } as unknown as Ga4PropertyDirectoryService;
  const authorizations = {
    getAccessToken:
      options.token ?? jest.fn().mockResolvedValue({ accessToken: 'tok' }),
  };
  const runReport =
    options.report ??
    jest.fn((_token: string, request: { dimensions: string[] }) =>
      Promise.resolve({
        rows: request.dimensions.length === 1 ? [dailyRow] : [],
        truncated: false,
        apiCalls: 1,
      }),
    );
  const service = new Ga4SyncService(
    dataSource,
    directory,
    authorizations as never,
    { runReport } as unknown as Ga4DataClient,
  );
  return { service, queries, runReport, authorizations };
}

afterEach(() => {
  delete process.env.SOCIAL_GA4_SYNC_ENABLED;
});

describe('Ga4SyncService', () => {
  it('refuses to run with the kill switch off', async () => {
    const { service } = build({ enabled: false });

    await expect(
      service.syncProperty({
        scope,
        propertyId: '111',
        trigger: 'manual',
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('answers 404 for a property not selected in this scope', async () => {
    const { service } = build({});

    await expect(
      service.syncProperty({
        scope,
        propertyId: '999',
        trigger: 'manual',
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('never falls back to UTC for a property with no time zone', async () => {
    const { service } = build({
      properties: [{ propertyId: '111', timeZone: null }],
    });

    await expect(
      service.syncProperty({
        scope,
        propertyId: '111',
        trigger: 'manual',
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a manual window that includes today', async () => {
    const { service } = build({});

    await expect(
      service.syncProperty({
        scope,
        propertyId: '111',
        trigger: 'manual',
        windowStart: '2026-11-12',
        windowEnd: '2026-11-13',
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a manual window longer than the short-window ceiling', async () => {
    const { service } = build({});

    await expect(
      service.syncProperty({
        scope,
        propertyId: '111',
        trigger: 'manual',
        windowStart: '2026-09-01',
        windowEnd: '2026-11-12',
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reads D-3→D-1 in the property zone once the property has history', async () => {
    const { service } = build({ runCount: 5 });

    const result = await service.syncProperty({
      scope,
      propertyId: '111',
      trigger: 'scheduled',
      now: NOW,
    });

    expect([result.windowStart, result.windowEnd]).toEqual([
      '2026-11-10',
      '2026-11-12',
    ]);
  });

  it('backfills thirty days on the first sync of a property', async () => {
    const { service } = build({ runCount: 0 });

    const result = await service.syncProperty({
      scope,
      propertyId: '111',
      trigger: 'scheduled',
      now: NOW,
    });

    expect(result.windowStart).toBe('2026-10-14');
  });

  it('finishes succeeded and counts the rows and calls of the daily and six dimension reports', async () => {
    const { service } = build({ runCount: 5 });

    const result = await service.syncProperty({
      scope,
      propertyId: '111',
      trigger: 'manual',
      now: NOW,
    });

    expect([result.status, result.apiCalls, result.rowsWritten]).toEqual([
      'succeeded',
      7,
      1,
    ]);
  });

  it('upserts on the scope-wide key so a re-run keeps created_at', async () => {
    const { service, queries } = build({ runCount: 5 });

    await service.syncProperty({
      scope,
      propertyId: '111',
      trigger: 'manual',
      now: NOW,
    });

    const upsert = queries.find((q) =>
      /INSERT INTO social_ga4_daily_metrics/.test(q.sql),
    );
    expect(upsert?.sql).toMatch(
      /ON CONFLICT \(.*COALESCE\(agency_client_id.*metric_date\)/s,
    );
  });

  it('does not overwrite created_at on conflict', async () => {
    const { service, queries } = build({ runCount: 5 });

    await service.syncProperty({
      scope,
      propertyId: '111',
      trigger: 'manual',
      now: NOW,
    });

    const upsert = queries.find((q) =>
      /INSERT INTO social_ga4_daily_metrics/.test(q.sql),
    );
    expect(upsert?.sql.split('DO UPDATE SET')[1]).not.toMatch(/created_at/);
  });

  it('removes window rows the new pass did not write', async () => {
    const { service, queries } = build({ runCount: 5 });

    await service.syncProperty({
      scope,
      propertyId: '111',
      trigger: 'manual',
      now: NOW,
    });

    expect(
      queries.some((q) => /DELETE FROM social_ga4_daily_metrics/.test(q.sql)),
    ).toBe(true);
  });

  it('marks the run partial when a breakdown fails but the headline numbers landed', async () => {
    const report = jest.fn((_t: string, request: { dimensions: string[] }) =>
      request.dimensions.length === 1
        ? Promise.resolve({ rows: [dailyRow], truncated: false, apiCalls: 1 })
        : Promise.reject(new Ga4DataError('bad_request')),
    );
    const { service } = build({ runCount: 5, report });

    const result = await service.syncProperty({
      scope,
      propertyId: '111',
      trigger: 'manual',
      now: NOW,
    });

    expect(result.status).toBe('partial');
  });

  it('stops at the first quota error instead of hammering the property', async () => {
    const report = jest.fn((_t: string, request: { dimensions: string[] }) =>
      request.dimensions.length === 1
        ? Promise.resolve({ rows: [dailyRow], truncated: false, apiCalls: 1 })
        : Promise.reject(new Ga4DataError('rate_limited')),
    );
    const { service } = build({ runCount: 5, report });

    await service.syncProperty({
      scope,
      propertyId: '111',
      trigger: 'manual',
      now: NOW,
    });

    expect(report).toHaveBeenCalledTimes(2);
  });

  it('records a credential failure as a failed run with only the code', async () => {
    const token = jest
      .fn()
      .mockRejectedValue(new GoogleCredentialError('reauth_required'));
    const { service } = build({ runCount: 5, token });

    const result = await service.syncProperty({
      scope,
      propertyId: '111',
      trigger: 'manual',
      now: NOW,
    });

    expect([result.status, result.errorCode]).toEqual([
      'failed',
      'reauth_required',
    ]);
  });

  it('turns an actionable manual failure into a 409', async () => {
    const { service } = build({});

    expect(() =>
      service.throwIfActionable({
        runId: 'r',
        propertyId: '111',
        status: 'failed',
        windowStart: '2026-11-10',
        windowEnd: '2026-11-12',
        rowsWritten: 0,
        apiCalls: 0,
        errorCode: 'reauth_required',
      }),
    ).toThrow(ConflictException);
  });

  it('answers 409 when the same window is already running', async () => {
    const { service } = build({ runCount: 5 });
    const conflict = Object.assign(
      new QueryFailedError('q', [], new Error('dup')),
      { code: '23505' },
    );
    const original = (service as unknown as { dataSource: DataSource })
      .dataSource;
    const query = original.query as jest.Mock;
    query.mockImplementation((sql: string) => {
      if (/INSERT INTO social_ga4_sync_runs/.test(sql))
        return Promise.reject(conflict);
      if (/SELECT count/.test(sql)) return Promise.resolve([{ count: '5' }]);
      return Promise.resolve([]);
    });

    await expect(
      service.syncProperty({
        scope,
        propertyId: '111',
        trigger: 'manual',
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
