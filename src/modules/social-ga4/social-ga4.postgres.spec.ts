import { NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import type { CompanyAwareScope } from '../../common/context/company-aware-scope';
import { CreateSocialGa4ReadModel1803900000000 } from '../../database/migrations/1803900000000-create-social-ga4-read-model';
import { CreateSocialGoogleOAuth1803700000000 } from '../../database/migrations/1803700000000-create-social-google-oauth';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import type { Ga4DataClient, Ga4ReportRequest } from './ga4-data.client';
import { Ga4AnalyticsReadService } from './ga4-analytics-read.service';
import { Ga4PropertyDirectoryService } from './ga4-property-directory.service';
import { Ga4SyncService } from './ga4-sync.service';

const run = describePostgresIntegration();

const PROPERTY = '424242';

run('GA4 read model (Postgres)', () => {
  let dataSource: DataSource;
  let directory: Ga4PropertyDirectoryService;
  let reads: Ga4AnalyticsReadService;
  const calls: Ga4ReportRequest[] = [];

  const report = (request: Ga4ReportRequest) => {
    calls.push(request);
    // Two days of traffic with unequal weights, so a mean of daily rates and a
    // ratio of sums give different answers.
    if (request.dimensions.length === 1) {
      return {
        rows: [
          {
            dimensions: ['20261110'],
            metrics: [100, 90, 30, 10, 10, 120, 400, 1, 5],
          },
          {
            dimensions: ['20261111'],
            metrics: [900, 700, 200, 90, 50, 1000, 4000, 9, 95],
          },
        ],
        truncated: false,
        apiCalls: 1,
      };
    }
    return {
      rows: [
        {
          dimensions: ['20261110', 'Organic Search'],
          metrics: [100, 10, 90, 1, 5],
        },
        {
          dimensions: ['20261111', 'Organic Search'],
          metrics: [900, 90, 700, 9, 95],
        },
      ],
      truncated: false,
      apiCalls: 1,
    };
  };

  const client = {
    runReport: (_token: string, request: Ga4ReportRequest) =>
      Promise.resolve(report(request)),
  } as unknown as Ga4DataClient;

  const authorizations = {
    getAccessToken: () => Promise.resolve({ accessToken: 'tok' }),
  };

  async function seedScope(scope: CompanyAwareScope) {
    const [auth] = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO social_google_authorizations
         (tenant_id, workspace_id, agency_client_id, company_context_id, google_sub, granted_scopes)
       VALUES ($1,$2,$3,$4,$5,'{}') RETURNING id`,
      [
        scope.tenantId,
        scope.workspaceId,
        scope.agencyClientId,
        scope.companyContextId,
        `sub-${randomUUID()}`,
      ],
    );
    await dataSource.query(
      `INSERT INTO social_google_product_links (authorization_id, tenant_id, product, status, resources)
       VALUES ($1,$2,'ga4','connected',$3::jsonb)`,
      [
        auth.id,
        scope.tenantId,
        JSON.stringify([
          {
            propertyId: PROPERTY,
            displayName: 'Site',
            accountId: '1',
            timeZone: 'America/Sao_Paulo',
            currency: 'BRL',
          },
        ]),
      ],
    );
  }

  const newScope = (): CompanyAwareScope => ({
    tenantId: randomUUID(),
    workspaceId: randomUUID(),
    agencyClientId: null,
    companyContextId: null,
  });

  beforeAll(async () => {
    process.env.SOCIAL_GA4_SYNC_ENABLED = 'true';
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.AGENCY_DB_HOST,
      port: Number(process.env.AGENCY_DB_PORT),
      username: process.env.AGENCY_DB_USERNAME,
      password: process.env.AGENCY_DB_PASSWORD,
      database: process.env.AGENCY_DB_NAME,
    });
    await dataSource.initialize();
    const runner = dataSource.createQueryRunner();
    await new CreateSocialGoogleOAuth1803700000000().up(runner);
    const migration = new CreateSocialGa4ReadModel1803900000000();
    await migration.down(runner);
    await migration.up(runner);
    // Specs call `up()` on an already migrated database: it must be a no-op.
    await migration.up(runner);
    await runner.release();
    directory = new Ga4PropertyDirectoryService(dataSource);
    reads = new Ga4AnalyticsReadService(dataSource, directory);
  });

  afterAll(async () => {
    delete process.env.SOCIAL_GA4_SYNC_ENABLED;
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  const service = () =>
    new Ga4SyncService(dataSource, directory, authorizations as never, client);

  const window = { windowStart: '2026-11-10', windowEnd: '2026-11-11' };
  const now = new Date('2026-11-13T12:00:00Z');

  it('writes the daily and dimension tables on a manual sync', async () => {
    const scope = newScope();
    await seedScope(scope);

    const result = await service().syncProperty({
      scope,
      propertyId: PROPERTY,
      trigger: 'manual',
      ...window,
      now,
    });

    expect([result.status, result.rowsWritten]).toEqual([
      'succeeded',
      2 + 6 * 2,
    ]);
  });

  it('is idempotent: a second run leaves the same row count', async () => {
    const scope = newScope();
    await seedScope(scope);
    const sync = service();
    await sync.syncProperty({
      scope,
      propertyId: PROPERTY,
      trigger: 'manual',
      ...window,
      now,
    });
    await sync.syncProperty({
      scope,
      propertyId: PROPERTY,
      trigger: 'manual',
      ...window,
      now,
    });

    const [{ count }] = await dataSource.query<Array<{ count: string }>>(
      `SELECT count(*) FROM social_ga4_daily_metrics WHERE tenant_id = $1`,
      [scope.tenantId],
    );

    expect(count).toBe('2');
  });

  it('preserves created_at across a re-run', async () => {
    const scope = newScope();
    await seedScope(scope);
    const sync = service();
    await sync.syncProperty({
      scope,
      propertyId: PROPERTY,
      trigger: 'manual',
      ...window,
      now,
    });
    const [before] = await dataSource.query<Array<{ created_at: Date }>>(
      `SELECT created_at FROM social_ga4_daily_metrics WHERE tenant_id = $1 ORDER BY metric_date LIMIT 1`,
      [scope.tenantId],
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    await sync.syncProperty({
      scope,
      propertyId: PROPERTY,
      trigger: 'manual',
      ...window,
      now,
    });
    const [after] = await dataSource.query<Array<{ created_at: Date }>>(
      `SELECT created_at FROM social_ga4_daily_metrics WHERE tenant_id = $1 ORDER BY metric_date LIMIT 1`,
      [scope.tenantId],
    );

    expect(after.created_at.getTime()).toBe(before.created_at.getTime());
  });

  it('computes the period engagement rate as Σ engaged ÷ Σ sessions', async () => {
    const scope = newScope();
    await seedScope(scope);
    await service().syncProperty({
      scope,
      propertyId: PROPERTY,
      trigger: 'manual',
      ...window,
      now,
    });

    const overview = await reads.overview(scope, {
      propertyId: PROPERTY,
      since: '2026-11-10',
      until: '2026-11-11',
    });

    // (10 + 90) / (100 + 900) = 0.1; a mean of daily rates would say 0.5.
    expect(overview.totals.engagementRate).toBeCloseTo(0.1);
  });

  it('answers 404 for a property of another context', async () => {
    const owner = newScope();
    const other = newScope();
    await seedScope(owner);
    await seedScope(other);
    await service().syncProperty({
      scope: owner,
      propertyId: PROPERTY,
      trigger: 'manual',
      ...window,
      now,
    });
    // The property id is selected in `other` too, but `other` has no data: it
    // must never see the owner's rows, and a property it did not select is a 404.
    await dataSource.query(
      `UPDATE social_google_product_links SET resources = '[]'::jsonb WHERE tenant_id = $1`,
      [other.tenantId],
    );

    await expect(
      reads.overview(other, {
        propertyId: PROPERTY,
        since: '2026-11-10',
        until: '2026-11-11',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('keeps two contexts of one tenant apart', async () => {
    const tenantId = randomUUID();
    const workspaceId = randomUUID();
    const a: CompanyAwareScope = {
      tenantId,
      workspaceId,
      agencyClientId: randomUUID(),
      companyContextId: null,
    };
    const b: CompanyAwareScope = {
      tenantId,
      workspaceId,
      agencyClientId: randomUUID(),
      companyContextId: null,
    };
    await seedScope(a);
    await seedScope(b);
    await service().syncProperty({
      scope: a,
      propertyId: PROPERTY,
      trigger: 'manual',
      ...window,
      now,
    });

    const overview = await reads.overview(b, {
      propertyId: PROPERTY,
      since: '2026-11-10',
      until: '2026-11-11',
    });

    expect(overview.totals.sessions).toBe(0);
  });
});
