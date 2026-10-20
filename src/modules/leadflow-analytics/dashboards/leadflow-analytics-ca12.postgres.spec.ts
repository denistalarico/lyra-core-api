import { randomUUID } from 'node:crypto';
import { Table, type QueryRunner } from 'typeorm';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import { CreateLeadflowAnalyticsDashboards1800000000000 } from '../../../database/migrations/1800000000000-create-leadflow-analytics-dashboards';
import { describePostgresIntegration } from '../../../testing/postgres-integration';
import type { CompanyAwareScope } from '../../../common/context/company-aware-scope';
import { CrmOpportunityEntity } from '../../crm/entities/crm-opportunity.entity';
import { CrmOpportunityEventEntity } from '../../crm/entities/crm-opportunity-event.entity';
import { CrmPipelineEntity } from '../../crm/entities/crm-pipeline.entity';
import { CrmStageEntity } from '../../crm/entities/crm-stage.entity';
import { InboxConversationEventEntity } from '../../inbox/entities/inbox-conversation-event.entity';
import { LeadFlowAnalyticsService } from '../services/leadflow-analytics.service';
import { LeadFlowTimeseriesService } from '../services/leadflow-timeseries.service';
import { LeadFlowAnalyticsDashboardEntity } from './leadflow-analytics-dashboard.entity';
import { LeadFlowAnalyticsDashboardsService } from './leadflow-analytics-dashboards.service';
import { parseDashboardLayout } from './dashboard-layout.contract';

const run = describePostgresIntegration();
run('CA12 dashboards and daily company isolation (Agency test only)', () => {
  const migration = new CreateLeadflowAnalyticsDashboards1800000000000();
  let runner: QueryRunner;
  let schema: string;
  let service: LeadFlowAnalyticsDashboardsService;
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  const clientId = randomUUID();
  const a: CompanyAwareScope = {
    tenantId,
    workspaceId,
    agencyClientId: clientId,
    companyContextId: randomUUID(),
  };
  const b: CompanyAwareScope = { ...a, companyContextId: randomUUID() };
  beforeAll(async () => {
    if (
      AgencyDataSource.options.type !== 'postgres' ||
      AgencyDataSource.options.database !== 'lyra_agency_test'
    )
      throw new Error('CA12 requires lyra_agency_test');
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
  });
  afterAll(async () => {
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });
  beforeEach(async () => {
    runner = AgencyDataSource.createQueryRunner();
    await runner.connect();
    schema = `ca12_${randomUUID().replaceAll('-', '')}`;
    await runner.query(`CREATE SCHEMA "${schema}"`);
    await runner.query(`SET search_path TO "${schema}", public`);
    await migration.up(runner);
    service = new LeadFlowAnalyticsDashboardsService(
      runner.manager.getRepository(LeadFlowAnalyticsDashboardEntity),
    );
  });
  afterEach(async () => {
    await runner.query('SET search_path TO public');
    await runner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await runner.release();
  });
  it('migration up/down/up is additive/idempotent and enforces scope/default/name uniqueness', async () => {
    await runner.query(
      'CREATE TABLE leadflow_analytics_views(id int PRIMARY KEY)',
    );
    await runner.query('INSERT INTO leadflow_analytics_views VALUES (1)');
    await migration.up(runner);
    await migration.down(runner);
    await migration.up(runner);
    expect(
      await runner.query('SELECT id FROM leadflow_analytics_views'),
    ).toEqual([{ id: 1 }]);
    expect(
      await runner.query(
        "SELECT to_regclass('leadflow_analytics_dashboards')::text AS name",
      ),
    ).toEqual([{ name: 'leadflow_analytics_dashboards' }]);
    await expect(
      runner.query(
        `INSERT INTO leadflow_analytics_dashboards(tenant_id,workspace_id,agency_client_id,name) VALUES ($1,$2,$3,'bad')`,
        [tenantId, workspaceId, clientId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    const items = await service.list(a, null);
    expect(items).toHaveLength(6);
    expect(items.filter((item) => item.isDefault)).toHaveLength(1);
    for (const item of items)
      expect(parseDashboardLayout(item.layout)).toEqual(item.layout);
    await expect(
      runner.query(
        `INSERT INTO leadflow_analytics_dashboards(tenant_id,workspace_id,agency_client_id,company_context_id,name,is_default) VALUES ($1,$2,$3,$4,'other default',true)`,
        [tenantId, workspaceId, clientId, a.companyContextId],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      service.create(a, null, {
        name: ' visão geral ',
        channels: ['overview'],
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('concurrent lazy seeding produces one default and one fixed screen per section', async () => {
    const second = AgencyDataSource.createQueryRunner();
    await second.connect();
    try {
      await second.query(`SET search_path TO "${schema}", public`);
      const other = new LeadFlowAnalyticsDashboardsService(
        second.manager.getRepository(LeadFlowAnalyticsDashboardEntity),
      );
      await Promise.all([
        service.list(a, randomUUID()),
        other.list(a, randomUUID()),
      ]);
      expect(
        (await service.list(a, null)).map(
          (item) => item.channelKey ?? 'default',
        ),
      ).toEqual([
        'default',
        'service',
        'commercial',
        'lead_quality',
        'automations',
        'recommendations',
      ]);
    } finally {
      await second.query('SET search_path TO public');
      await second.release();
    }
  });
  it('CRUD isolates the full quartet, preserves default/fixed screens and legacy data', async () => {
    const item = await service.create(a, randomUUID(), {
      name: 'Meu painel',
      channels: ['service'],
    });
    for (const foreign of [
      b,
      { ...a, tenantId: randomUUID() },
      { ...a, workspaceId: randomUUID() },
      { ...a, agencyClientId: randomUUID() },
    ]) {
      await expect(
        service.update(foreign, item.id, { name: 'forged' }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(service.remove(foreign, item.id)).rejects.toMatchObject({
        status: 404,
      });
    }
    const updated = await service.update(a, item.id, { name: 'Renomeado' });
    expect(updated.name).toBe('Renomeado');
    expect(updated.layout).toEqual(item.layout);
    const defaults = await service.list(a, null);
    await expect(service.remove(a, defaults[0].id)).rejects.toMatchObject({
      status: 400,
    });
    await expect(service.remove(a, defaults[1].id)).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      service.update(a, item.id, { layout: { version: 2, sections: [] } }),
    ).rejects.toMatchObject({ status: 400 });
    await service.remove(a, item.id);
    await expect(service.find(a, item.id)).rejects.toMatchObject({
      status: 404,
    });
  });
  it('daily messages and commercial cohorts partition companies, tenant/workspace, UTC and successful outbound', async () => {
    for (const entity of [
      CrmOpportunityEntity,
      CrmOpportunityEventEntity,
      CrmPipelineEntity,
      CrmStageEntity,
      InboxConversationEventEntity,
    ]) {
      await runner.createTable(
        Table.create(
          AgencyDataSource.getMetadata(entity),
          AgencyDataSource.driver,
        ),
        false,
        false,
        false,
      );
    }
    await runner.query(
      `CREATE TABLE inbox_channels(id uuid PRIMARY KEY, tenant_id uuid, workspace_id uuid, agency_client_id uuid, company_context_id uuid, deleted_at timestamptz)`,
    );
    await runner.query(
      `CREATE TABLE inbox_conversations(id uuid PRIMARY KEY, tenant_id uuid, workspace_id uuid, channel_id uuid, business_mode text)`,
    );
    await runner.query(
      `CREATE TABLE inbox_messages(id uuid PRIMARY KEY, tenant_id uuid, workspace_id uuid, conversation_id uuid, direction text, status text, occurred_at timestamptz, sender_agent_id uuid)`,
    );
    const commercial = new LeadFlowAnalyticsService(
      runner.manager.getRepository(CrmOpportunityEntity),
      runner.manager.getRepository(CrmOpportunityEventEntity),
      runner.manager.getRepository(CrmPipelineEntity),
      runner.manager.getRepository(CrmStageEntity),
      runner.manager.getRepository(InboxConversationEventEntity),
    );
    const timeseries = new LeadFlowTimeseriesService(
      {
        query: (sql: string, params: unknown[]) => runner.query(sql, params),
      } as never,
      commercial,
    );
    const channelA = randomUUID();
    const agent = randomUUID();
    for (const [scope, channelId] of [
      [a, channelA],
      [b, randomUUID()],
      [{ ...a, tenantId: randomUUID() }, randomUUID()],
      [{ ...a, workspaceId: randomUUID() }, randomUUID()],
    ] as const) {
      const conversationId = randomUUID();
      const pipelineId = randomUUID();
      const stageId = randomUUID();
      await runner.query(
        'INSERT INTO inbox_channels VALUES($1,$2,$3,$4,$5,NULL)',
        [
          channelId,
          scope.tenantId,
          scope.workspaceId,
          clientId,
          scope.companyContextId,
        ],
      );
      await runner.query(
        "INSERT INTO inbox_conversations VALUES($1,$2,$3,$4,'general')",
        [conversationId, scope.tenantId, scope.workspaceId, channelId],
      );
      for (const [direction, status, time] of [
        ['inbound', 'delivered', '2026-07-01T23:59:00Z'],
        ['outbound', 'sent', '2026-07-02T00:01:00Z'],
        ['outbound', 'failed', '2026-07-02T00:02:00Z'],
      ]) {
        await runner.query(
          'INSERT INTO inbox_messages VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [
            randomUUID(),
            scope.tenantId,
            scope.workspaceId,
            conversationId,
            direction,
            status,
            time,
            agent,
          ],
        );
      }
      await runner.manager
        .getRepository(CrmPipelineEntity)
        .save({ id: pipelineId, ...scope, name: 'Pipeline' });
      await runner.manager.getRepository(CrmStageEntity).save({
        id: stageId,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        pipelineId,
        name: 'Etapa',
      });
      await runner.manager.getRepository(CrmOpportunityEntity).save({
        ...scope,
        pipelineId,
        stageId,
        title: 'Ganha',
        status: 'won',
        createdAt: new Date('2026-07-01T10:00:00Z'),
        updatedAt: new Date('2026-07-02T10:00:00Z'),
        wonAt: new Date('2026-07-02T10:00:00Z'),
      });
    }
    const ctx = {
      tenantId,
      workspaceId,
      managedContext: {
        productKey: 'leadflow' as const,
        operatingMode: 'client' as const,
        clientId,
        companyContextId: a.companyContextId,
        managedTenantId: null,
      },
    };
    const period = { from: '2026-07-01T00:00:00Z', to: '2026-07-03T00:00:00Z' };
    const result = await timeseries.get(ctx, period);
    const aggregate = await commercial.getCommercialJourney(ctx, period);
    expect(
      result.rows.reduce(
        (total, row) => total + (row.opportunities_won ?? 0),
        0,
      ),
    ).toBe(aggregate.summary.won);
    expect(result.rows).toEqual([
      {
        day: '2026-07-01',
        messages_inbound: 1,
        messages_outbound: 0,
        conversations: 1,
        opportunities_created: 1,
        opportunities_won: 1,
      },
      {
        day: '2026-07-02',
        messages_inbound: 0,
        messages_outbound: 1,
        conversations: 1,
        opportunities_created: 0,
        opportunities_won: 0,
      },
      {
        day: '2026-07-03',
        messages_inbound: 0,
        messages_outbound: 0,
        conversations: 0,
        opportunities_created: 0,
        opportunities_won: 0,
      },
    ]);
    expect(
      (
        await timeseries.get(ctx, {
          ...period,
          metrics: 'messages_inbound',
          channelId: randomUUID(),
        })
      ).rows.every((row) => row.messages_inbound === 0),
    ).toBe(true);
    expect(
      (
        await timeseries.get(ctx, {
          ...period,
          metrics: 'messages_outbound',
          agentId: agent,
        })
      ).rows[1].messages_outbound,
    ).toBe(1);
    await expect(
      timeseries.get(
        {
          ...ctx,
          managedContext: { ...ctx.managedContext, companyContextId: null },
        },
        period,
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      timeseries.get(ctx, { ...period, metrics: 'secret' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      timeseries.get(ctx, { from: '2020-01-01', to: period.to }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
