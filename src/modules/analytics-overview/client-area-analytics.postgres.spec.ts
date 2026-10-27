import { randomUUID } from 'node:crypto';
import type { DataSource, QueryRunner } from 'typeorm';
import { ClientAreaBridgeRegistry } from '../../common/client-area-bridge/client-area-bridge.registry';
import type { CompanyAwareScope } from '../../common/context/company-aware-scope';
import { AgencyDataSource } from '../../database/agency-typeorm.datasource';
import { CreateLeadFlowAnalyticsReports1800900000000 } from '../../database/migrations/1800900000000-create-leadflow-analytics-reports';
import { AddClientAreaAnalyticsAccess1801300000000 } from '../../database/migrations/1801300000000-add-client-area-analytics-access';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import type { ClientAreaContext } from '../client-area/client-area.types';
import { LeadFlowAnalyticsDashboardEntity } from '../leadflow-analytics/dashboards/leadflow-analytics-dashboard.entity';
import { LeadFlowAnalyticsDashboardsService } from '../leadflow-analytics/dashboards/leadflow-analytics-dashboards.service';
import { LeadFlowClientAreaScopeService } from '../leadflow-client-area/leadflow-client-area-scope.service';
import { SocialAnalyticsDashboardEntity } from '../social-analytics-dashboards/entities';
import { SocialAnalyticsDashboardsService } from '../social-analytics-dashboards/social-analytics-dashboards.service';
import { SocialClientAreaScopeService } from '../social-client-area/social-client-area-scope.service';

const run = describePostgresIntegration();

/**
 * CA-AN1 — the Client Area Analytics over the real schema: company A × B,
 * private Owner dashboards (D-AN-14) and the scope SQL the Bridge runs for
 * dashboards and reports of both products. Everything runs in one
 * transaction that is rolled back.
 */
run('CA-AN1 Client Area Analytics scope (Agency test only)', () => {
  let runner: QueryRunner;
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  const agencyClientId = randomUUID();
  const a: CompanyAwareScope = {
    tenantId,
    workspaceId,
    agencyClientId,
    companyContextId: randomUUID(),
  };
  const b: CompanyAwareScope = { ...a, companyContextId: randomUUID() };
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const operator = randomUUID();
  const member = (
    userId: string,
    scope: CompanyAwareScope = a,
  ): ClientAreaContext =>
    ({
      surface: 'client_area',
      userId,
      tenantId,
      workspaceId,
      agencyClientId,
      companyContextId: scope.companyContextId,
      memberAccess: { analytics: { available: true, level: 'manager' } },
    }) as unknown as ClientAreaContext;

  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
  });
  afterAll(async () => {
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });
  beforeEach(async () => {
    runner = AgencyDataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    // The disposable database may lag behind; both are idempotent.
    await new CreateLeadFlowAnalyticsReports1800900000000().up(runner);
    await new AddClientAreaAnalyticsAccess1801300000000().up(runner);
  });
  afterEach(async () => {
    await runner.rollbackTransaction();
    await runner.release();
  });

  const services = () => ({
    social: new SocialAnalyticsDashboardsService(
      runner.manager.getRepository(SocialAnalyticsDashboardEntity),
    ),
    leadflow: new LeadFlowAnalyticsDashboardsService(
      runner.manager.getRepository(LeadFlowAnalyticsDashboardEntity),
    ),
  });

  it.each(['social', 'leadflow'] as const)(
    '%s: an Owner sees only their own private dashboards; the agency and other members see none; company B stays apart',
    async (product) => {
      const service = services()[product];
      const channel = product === 'social' ? 'instagram' : 'service';
      const create = (
        scope: CompanyAwareScope,
        name: string,
        owner: string | null,
      ) =>
        service.create(scope, owner, { name, channels: [channel] } as never, {
          clientAreaUserId: owner,
        });
      await create(a, 'Privado', ownerA);
      // Same name for another Owner and for a shared row: no collision.
      await create(a, 'Privado', ownerB);
      await create(a, 'Privado', null);
      await create(b, 'Só da empresa B', null);

      const names = async (
        scope: CompanyAwareScope,
        clientAreaUserId: string | null,
      ) =>
        (await service.list(scope, null, { clientAreaUserId }))
          .filter((view) => !view.isDefault && !view.channelKey)
          .map((view) => `${view.name}${view.ownedByMe ? ' (meu)' : ''}`)
          .sort();

      expect(await names(a, ownerA)).toEqual(['Privado', 'Privado (meu)']);
      expect(await names(a, ownerB)).toEqual(['Privado', 'Privado (meu)']);
      expect(await names(a, null)).toEqual(['Privado']);
      expect(await names(a, operator)).toEqual(['Privado']);
      expect(await names(b, ownerA)).toEqual(['Só da empresa B']);

      // One Owner cannot name two private dashboards alike.
      await expect(create(a, ' privado ', ownerA)).rejects.toMatchObject({
        status: 409,
      });
    },
  );

  it('proves dashboards and reports of both products company- and owner-bound in the Bridge SQL', async () => {
    const registry = new ClientAreaBridgeRegistry();
    const db = {
      query: (sql: string, params: unknown[]) => runner.query(sql, params),
    } as unknown as DataSource;
    const social = new SocialClientAreaScopeService(db, registry);
    const leadflow = new LeadFlowClientAreaScopeService(db, registry);
    social.onModuleInit();
    leadflow.onModuleInit();

    const insertDashboard = async (
      table: string,
      scope: CompanyAwareScope,
      owner: string | null,
    ) =>
      (
        (await runner.query(
          `INSERT INTO ${table} (tenant_id, workspace_id, agency_client_id, company_context_id, name, client_area_owner_user_id)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [
            tenantId,
            workspaceId,
            scope.agencyClientId,
            scope.companyContextId,
            `D ${randomUUID()}`,
            owner,
          ],
        )) as { id: string }[]
      )[0].id;
    const insertReport = async (table: string, scope: CompanyAwareScope) =>
      (
        (await runner.query(
          `INSERT INTO ${table} (tenant_id, workspace_id, agency_client_id, company_context_id, title, channels, period_since, period_until, page_mode)
           VALUES ($1, $2, $3, $4, 'Relatório', '[]'::jsonb, '2026-10-01', '2026-10-26', 'continuous') RETURNING id`,
          [tenantId, workspaceId, scope.agencyClientId, scope.companyContextId],
        )) as { id: string }[]
      )[0].id;

    for (const [product, base] of [
      ['social', '/social/analytics'],
      ['leadflow', '/leadflow/analytics'],
    ] as const) {
      const dashboards = `${product}_analytics_dashboards`;
      const reports = `${product}_analytics_reports`;
      const shared = await insertDashboard(dashboards, a, null);
      const mine = await insertDashboard(dashboards, a, ownerA);
      const theirs = await insertDashboard(dashboards, a, ownerB);
      const otherCompany = await insertDashboard(dashboards, b, null);
      const reportA = await insertReport(reports, a);
      const reportB = await insertReport(reports, b);
      const resolve = (
        method: string,
        routePath: string,
        params: Record<string, string>,
        body: Record<string, unknown> = {},
      ) =>
        registry.resolveScope('analytics', member(ownerA), 'key', {
          method,
          routePath,
          params,
          query: {},
          body,
        });
      const patch = (id: string) =>
        resolve('PATCH', `${base}/dashboards/:id`, { id });
      const file = (id: string) =>
        resolve('GET', `${base}/reports/:id/file`, { id });
      const pdf = (dashboardId: string) =>
        resolve('POST', `${base}/reports/pdf`, {}, { dashboardId });

      expect([product, await patch(shared)]).toEqual([
        product,
        expect.objectContaining({ companyContextId: a.companyContextId }),
      ]);
      expect([product, await patch(mine)]).toEqual([
        product,
        expect.objectContaining({ companyContextId: a.companyContextId }),
      ]);
      expect([product, 'theirs', await patch(theirs)]).toEqual([
        product,
        'theirs',
        null,
      ]);
      expect([product, 'company B', await patch(otherCompany)]).toEqual([
        product,
        'company B',
        null,
      ]);
      expect([product, await file(reportA)]).toEqual([
        product,
        expect.objectContaining({ companyContextId: a.companyContextId }),
      ]);
      expect([product, 'report B', await file(reportB)]).toEqual([
        product,
        'report B',
        null,
      ]);
      expect([product, 'pdf of theirs', await pdf(theirs)]).toEqual([
        product,
        'pdf of theirs',
        null,
      ]);
      expect([product, await pdf(mine)]).toEqual([
        product,
        expect.objectContaining({ companyContextId: a.companyContextId }),
      ]);
    }
  });
});
