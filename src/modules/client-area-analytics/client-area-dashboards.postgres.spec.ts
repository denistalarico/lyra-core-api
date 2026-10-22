import { Test } from '@nestjs/testing';
import {
  ValidationPipe,
  UnauthorizedException,
  NotFoundException,
  ForbiddenException,
  type INestApplication,
  type ExecutionContext,
} from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import {
  ClientAreaAuthGuard,
  ClientAreaMembershipGuard,
} from '../client-area/guards/client-area.guards';
import { ClientAreaAuthorizationService } from '../client-area/services/client-area-authorization.service';
import {
  ClientAreaOverviewController,
  ClientAreaDashboardsController,
  ClientAreaDashboardsAgencyController,
  ClientAreaMetricDataController,
} from './client-area-analytics.controller';
import {
  ClientAreaOverviewService,
  OVERVIEW_SOURCES,
} from './client-area-overview.service';
import { ClientAreaMetricDataService } from './client-area-metric-data.service';
import { ClientAreaSourcesRegistry } from './client-area-sources.registry';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../permissions';
import type {
  ClientAreaRequest,
  ClientAreaModuleKey,
} from '../client-area/client-area.types';
import { randomUUID } from 'node:crypto';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { getAgencyTypeOrmConfig } from '../../config/typeorm.config';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { CreateClientAreaAnalyticsDashboards1800100000000 } from '../../database/migrations/1800100000000-create-client-area-analytics-dashboards';
import {
  ClientAreaCompanyHooksRegistry,
  type ClientAreaCompanyScope,
} from '../client-area/client-area-company-hooks.registry';
import { CompanyProductRegistry } from '../../common/company-products/company-product.registry';
import type { ClientAreaContext } from '../client-area/client-area.types';
import { ClientAreaDashboardEntity } from './client-area-dashboard.entity';
import {
  ClientAreaDashboardsService,
  type DashboardActor,
} from './client-area-dashboards.service';
const run = describePostgresIntegration();
run('CA13 dashboards in isolated lyra_agency_test schema', () => {
  let app: INestApplication;
  let httpMember: ClientAreaContext;
  let httpRevoked = false;
  let admin: DataSource, db: DataSource, service: ClientAreaDashboardsService;
  const schema = `ca13_${randomUUID().replaceAll('-', '')}`;
  const scope: ClientAreaCompanyScope = {
    tenantId: randomUUID(),
    workspaceId: randomUUID(),
    agencyClientId: randomUUID(),
    companyContextId: randomUUID(),
  };
  const agency: DashboardActor = { surface: 'agency', userId: randomUUID() };
  const member = (userId = randomUUID()): DashboardActor => ({
    surface: 'client_area',
    context: {
      ...scope,
      userId,
      surface: 'client_area',
      accountRole: 'client_member',
      role: 'client_member',
      memberAccess: {
        analytics: { available: true, level: 'viewer' },
        agency_projects: { available: true, level: 'viewer' },
        agency_billing: { available: true, level: 'manager' },
        social_campaigns: { available: true, level: 'viewer' },
        leadflow_inbox: { available: true, level: 'viewer' },
        leadflow_crm: { available: true, level: 'viewer' },
      },
    } as ClientAreaContext,
  });
  const migration = new CreateClientAreaAnalyticsDashboards1800100000000();
  beforeAll(async () => {
    if (process.env.AGENCY_DB_NAME !== 'lyra_agency_test')
      throw new Error('CA13 requires lyra_agency_test');
    const config = getAgencyTypeOrmConfig();
    admin = await new DataSource({
      ...config,
      name: 'ca13-admin',
      entities: [],
      synchronize: false,
      migrationsRun: false,
    } as DataSourceOptions).initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    db = await new DataSource({
      ...config,
      name: 'ca13',
      schema,
      entities: [ClientAreaDashboardEntity],
      synchronize: false,
      migrationsRun: false,
      extra: { options: `-c search_path=${schema}` },
    } as DataSourceOptions).initialize();
    await db.query(
      'CREATE TABLE agency_clients(id uuid PRIMARY KEY,tenant_id uuid,workspace_id uuid,status text,archived_at timestamptz)',
    );
    await db.query(
      'CREATE TABLE agency_client_company_contexts(id uuid PRIMARY KEY,tenant_id uuid,workspace_id uuid,agency_client_id uuid,status text,archived_at timestamptz)',
    );
    await db.query(
      'CREATE TABLE client_area_company_settings(tenant_id uuid,workspace_id uuid,agency_client_id uuid,company_context_id uuid,enabled boolean)',
    );
    await db.query(
      'CREATE TABLE agency_client_company_products(tenant_id uuid,workspace_id uuid,agency_client_id uuid,company_context_id uuid,product_key text,status text)',
    );
    await db.query(
      "INSERT INTO agency_clients VALUES($1,$2,$3,'active',NULL)",
      [scope.agencyClientId, scope.tenantId, scope.workspaceId],
    );
    await db.query(
      "INSERT INTO agency_client_company_contexts VALUES($1,$2,$3,$4,'active',NULL)",
      [
        scope.companyContextId,
        scope.tenantId,
        scope.workspaceId,
        scope.agencyClientId,
      ],
    );
    await db.query(
      'INSERT INTO client_area_company_settings VALUES($1,$2,$3,$4,true)',
      [
        scope.tenantId,
        scope.workspaceId,
        scope.agencyClientId,
        scope.companyContextId,
      ],
    );
    service = new ClientAreaDashboardsService(
      db,
      new ClientAreaCompanyHooksRegistry(),
      new CompanyProductRegistry(),
    );
    const memberActor = member();
    if (memberActor.surface !== 'client_area') throw new Error('fixture');
    httpMember = memberActor.context;
    httpMember.memberAccess!.overview = { available: true, level: 'viewer' };
    const authenticate = (execution: ExecutionContext) => {
      const req = execution
        .switchToHttp()
        .getRequest<ClientAreaRequest & { user: unknown }>();
      if (req.path.startsWith('/api/agency/clients/')) {
        if (
          httpRevoked ||
          req.headers.authorization !== 'Bearer ca13-agency-fixture'
        )
          throw new UnauthorizedException();
        req.user = {
          sub: agency.userId,
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          role: 'admin',
        };
        return true;
      }
      if (
        httpRevoked ||
        req.headers.authorization !== 'Bearer ca13-fixture-session'
      )
        throw new UnauthorizedException();
      req.clientAreaIdentity = {
        tenantId: scope.tenantId,
        userId: httpMember.userId,
        sessionId: 'fixture',
        email: 'fixture@example.com',
      };
      req.clientAreaContext = httpMember;
      req.user = {
        sub: httpMember.userId,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        role: 'client_area_actor',
      };
      return true;
    };
    const sources = new ClientAreaSourcesRegistry();
    for (const key of OVERVIEW_SOURCES)
      sources.register({
        key,
        modules: [],
        ownerOnly: key === 'agency.invoices' || key === 'agency.contract',
        read: async (input) => {
          const rows = await db.query<{ id: string }[]>(
            'SELECT id FROM agency_client_company_contexts WHERE tenant_id=$1 AND workspace_id=$2 AND agency_client_id=$3 AND id=$4',
            [
              input.scope.tenantId,
              input.scope.workspaceId,
              input.scope.agencyClientId,
              input.scope.companyContextId,
            ],
          );
          return { companyIds: rows.map((row) => row.id) };
        },
      });
    const module = await Test.createTestingModule({
      controllers: [
        ClientAreaOverviewController,
        ClientAreaDashboardsController,
        ClientAreaDashboardsAgencyController,
        ClientAreaMetricDataController,
      ],
      providers: [
        ClientAreaMembershipGuard,
        ClientAreaOverviewService,
        ClientAreaMetricDataService,
        { provide: ClientAreaSourcesRegistry, useValue: sources },
        { provide: ClientAreaDashboardsService, useValue: service },
        {
          provide: ClientAreaAuthorizationService,
          useValue: {
            authorize: async (input: {
              companyContextId: string;
              module?: ClientAreaModuleKey;
            }) => {
              if (input.companyContextId !== scope.companyContextId)
                throw new NotFoundException();
              await service.assertCompany(scope);
              if (
                input.module &&
                !httpMember.memberAccess?.[input.module]?.available
              )
                throw new ForbiddenException();
              return httpMember;
            },
          },
        },
      ],
    })
      .overrideGuard(ClientAreaAuthGuard)
      .useValue({ canActivate: authenticate })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: authenticate })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });
  beforeEach(async () => {
    httpRevoked = false;
    httpMember.role = 'client_member';
    httpMember.accountRole = 'client_member';
    const runner = db.createQueryRunner();
    await migration.up(runner);
    await runner.release();
    await db.query(
      'TRUNCATE client_area_analytics_dashboards,agency_client_company_products',
    );
    service = new ClientAreaDashboardsService(
      db,
      new ClientAreaCompanyHooksRegistry(),
      new CompanyProductRegistry(),
    );
  });
  afterAll(async () => {
    if (app) await app.close();
    if (db?.isInitialized) await db.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.destroy();
    }
  });
  it('migration is additive/up/up/down/up and constrains ownership/default/layout', async () => {
    const runner = db.createQueryRunner();
    await runner.connect();
    try {
      await db.query('CREATE TABLE ca13_legacy(id int)');
      await db.query('INSERT INTO ca13_legacy VALUES(1)');
      await migration.up(runner);
      await migration.down(runner);
      await migration.up(runner);
      expect(await db.query('SELECT id FROM ca13_legacy')).toEqual([{ id: 1 }]);
      const values = [
        scope.tenantId,
        scope.workspaceId,
        scope.agencyClientId,
        scope.companyContextId,
      ];
      await expect(
        db.query(
          "INSERT INTO client_area_analytics_dashboards(tenant_id,workspace_id,agency_client_id,company_context_id,owner_surface,name) VALUES($1,$2,$3,$4,'client_area','bad')",
          values,
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await service.list(scope, agency);
      await expect(
        db.query(
          "INSERT INTO client_area_analytics_dashboards(tenant_id,workspace_id,agency_client_id,company_context_id,owner_surface,name,is_default) VALUES($1,$2,$3,$4,'agency','duplicate',true)",
          values,
        ),
      ).rejects.toMatchObject({ code: '23505' });
    } finally {
      await runner.release();
    }
  });
  it('seeds one default under concurrency and never replaces Agency edits', async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, () => service.list(scope, agency)),
    );
    expect(results.every((r) => r.items.length === 1)).toBe(true);
    const item = results[0].items[0];
    await service.update(scope, agency, item.id, {
      name: 'Meu padrão',
      layout: {
        version: 1,
        sections: [
          {
            id: 'custom',
            channel: 'agency.projects',
            title: 'Minha seção',
            cards: [],
          },
        ],
      },
    });
    await db.transaction((manager) =>
      service.seed(scope, manager, { product: 'leadflow', active: true }),
    );
    let row = await service.read(scope, agency, item.id);
    expect(row.name).toBe('Meu padrão');
    expect(row.layout.sections[0].title).toBe('Minha seção');
    const added = row.layout.sections.find(
      (s) => s.channel === 'leadflow.overview',
    )!;
    added.title = 'LF editado';
    added.cards = [];
    await service.update(scope, agency, item.id, { layout: row.layout });
    await db.transaction((manager) =>
      service.seed(scope, manager, { product: 'leadflow', active: false }),
    );
    row = await service.read(scope, agency, item.id);
    expect(row.layout.sections[1]).toMatchObject({
      title: 'LF editado',
      hidden: true,
      cards: [],
    });
    await db.transaction((manager) =>
      service.seed(scope, manager, { product: 'leadflow', active: true }),
    );
    row = await service.read(scope, agency, item.id);
    expect(row.layout.sections[1]).toMatchObject({
      title: 'LF editado',
      hidden: false,
      cards: [],
    });
  });
  it('allows a viewer to CRUD their own arrangements, never another author or Agency personal inventory', async () => {
    const a = member(),
      b = member();
    await service.list(scope, a);
    const own = await service.create(scope, a, {
      name: 'Pessoal',
      layout: { version: 1, sections: [] },
    });
    expect((await service.list(scope, a)).items).toHaveLength(2);
    expect((await service.list(scope, b)).items).toHaveLength(1);
    expect((await service.list(scope, agency)).items).toHaveLength(1);
    for (const actor of [b, agency]) {
      await expect(service.read(scope, actor, own.id)).rejects.toMatchObject({
        status: 404,
      });
      await expect(
        service.update(scope, actor, own.id, { name: 'Roubo' }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(service.remove(scope, actor, own.id)).rejects.toMatchObject({
        status: 404,
      });
    }
    expect(
      (await service.update(scope, a, own.id, { name: 'Renomeado' })).name,
    ).toBe('Renomeado');
    await service.remove(scope, a, own.id);
    await expect(service.read(scope, a, own.id)).rejects.toMatchObject({
      status: 404,
    });
  });
  it('returns explicit 403 only for own-company Agency dashboards, 404 for foreign scope', async () => {
    const a = member();
    const id = (await service.list(scope, a)).items[0].id;
    await expect(
      service.update(scope, a, id, { name: 'No' }),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: 'client_area_dashboard_agency_owned' },
    });
    await expect(service.remove(scope, a, id)).rejects.toMatchObject({
      status: 403,
    });
    for (const key of [
      'tenantId',
      'workspaceId',
      'agencyClientId',
      'companyContextId',
    ])
      await expect(
        service.read({ ...scope, [key]: randomUUID() }, agency, id),
      ).rejects.toMatchObject({ status: 404 });
  });
  it('rejects inaccessible cards on save; revocation keeps layout but marks cards unavailable', async () => {
    const a = member();
    const id = (
      await service.create(scope, a, {
        name: 'Social',
        layout: {
          version: 1,
          sections: [
            {
              id: 'social',
              channel: 'social.meta_ads',
              title: 'Social',
              cards: [
                {
                  id: 'spend',
                  kind: 'kpi',
                  size: { w: 2, h: 1 },
                  metric: 'social.spend',
                },
              ],
            },
          ],
        },
      })
    ).id;
    if (a.surface !== 'client_area') throw new Error('fixture');
    a.context.memberAccess!.social_campaigns = {
      available: false,
      level: null,
    };
    const read = await service.read(scope, a, id);
    expect(read.cardAvailability.spend.status).toBe('unavailable');
    expect(read.layout.sections[0].cards).toHaveLength(1);
    await expect(
      service.update(scope, a, id, { layout: read.layout }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.create(scope, a, {
        name: 'Billing',
        layout: {
          version: 1,
          sections: [
            {
              id: 'b',
              channel: 'agency.billing',
              title: 'Billing',
              cards: [
                {
                  id: 'i',
                  kind: 'table',
                  size: { w: 2, h: 1 },
                  source: 'agency.invoices',
                },
              ],
            },
          ],
        },
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('duplicates the published default into a private layout, pruning cards outside the member grants', async () => {
    const a = member();
    const id = (await service.list(scope, a)).items[0].id;
    await service.update(scope, agency, id, { name: 'A'.repeat(120) });
    const copy = await service.duplicate(scope, a, id, {});
    expect(copy.name).toHaveLength(120);
    expect(copy.name.endsWith(' (cópia)')).toBe(true);
    expect(copy.ownerSurface).toBe('client_area');
    expect(copy.isDefault).toBe(false);
    expect(
      copy.layout.sections.find((s) => s.channel === 'agency.billing')?.cards,
    ).toEqual([]);
    expect((await service.list(scope, agency)).items).toHaveLength(1);
  });
  it('wires enabling and product lifecycle registries to the same seeder', async () => {
    const hooks = new ClientAreaCompanyHooksRegistry(),
      registry = new CompanyProductRegistry();
    service = new ClientAreaDashboardsService(db, hooks, registry);
    service.onModuleInit();
    for (const [key, productKey] of [
      ['social-publications', 'social'],
      ['social-approvals', 'social'],
    ] as const)
      registry.register({
        key,
        productKey,
        pending: () => Promise.resolve([]),
      });
    await db.transaction((manager) => hooks.enabled(scope, manager));
    expect((await service.list(scope, agency)).items).toHaveLength(1);
    await db.transaction(async (manager) => {
      const op = { scope, manager, actorUserId: null, afterCommit: [] };
      for (const participant of registry.forProduct('social'))
        await participant.activate?.(op);
    });
    expect(
      (await service.list(scope, agency)).items[0].layout.sections.some(
        (s) => s.channel === 'social.summary',
      ),
    ).toBe(true);
  });
  it('keeps product lifecycle working for a non-active client so archival is never blocked', async () => {
    const hooks = new ClientAreaCompanyHooksRegistry(),
      registry = new CompanyProductRegistry();
    service = new ClientAreaDashboardsService(db, hooks, registry);
    service.onModuleInit();
    for (const [key, productKey] of [
      ['social-publications', 'social'],
      ['social-approvals', 'social'],
      ['leadflow-settings', 'leadflow'],
      ['leadflow-agents', 'leadflow'],
      ['leadflow-automations', 'leadflow'],
      ['leadflow-agenda', 'leadflow'],
    ] as const)
      registry.register({
        key,
        productKey,
        pending: () => Promise.resolve([]),
      });
    await db.transaction((manager) => hooks.enabled(scope, manager));
    await db.query("UPDATE agency_clients SET status='ended' WHERE id=$1", [
      scope.agencyClientId,
    ]);
    try {
      await db.transaction(async (manager) => {
        const op = { scope, manager, actorUserId: null, afterCommit: [] };
        for (const participant of registry.forProduct('social'))
          await participant.activate?.(op);
        for (const participant of registry.forProduct('leadflow'))
          await participant.remove?.(op);
      });
      // Reads keep requiring an active client.
      await expect(service.assertCompany(scope)).rejects.toMatchObject({
        status: 404,
      });
    } finally {
      await db.query("UPDATE agency_clients SET status='active' WHERE id=$1", [
        scope.agencyClientId,
      ]);
    }
    expect(
      (await service.list(scope, agency)).items[0].layout.sections.some(
        (s) => s.channel === 'social.summary' && !s.hidden,
      ),
    ).toBe(true);
  });
  it('exercises the company facade routes against PostgreSQL with fixture authentication', async () => {
    const base = `/api/client-area/companies/${scope.companyContextId}/analytics/dashboards`;
    const http = () => request(app.getHttpServer() as Server);
    const list = await http()
      .get(base)
      .auth('ca13-fixture-session', { type: 'bearer' });
    expect(list.status).toBe(200);
    const publishedId = (list.body as { items: Array<{ id: string }> }).items[0]
      .id;
    expect(
      (
        await http()
          .patch(`${base}/${publishedId}`)
          .auth('ca13-fixture-session', { type: 'bearer' })
          .send({ name: 'No' })
      ).status,
    ).toBe(403);
    expect(
      (
        await http()
          .delete(`${base}/${publishedId}`)
          .auth('ca13-fixture-session', { type: 'bearer' })
      ).status,
    ).toBe(403);
    const created = await http()
      .post(base)
      .auth('ca13-fixture-session', { type: 'bearer' })
      .send({ name: 'Pessoal HTTP', layout: { version: 1, sections: [] } });
    expect(created.status).toBe(201);
    const id = (created.body as { id: string }).id;
    expect(
      (
        await http()
          .get(`${base}/${id}`)
          .auth('ca13-fixture-session', { type: 'bearer' })
      ).status,
    ).toBe(200);
    expect(
      (
        await http()
          .patch(`${base}/${id}`)
          .auth('ca13-fixture-session', { type: 'bearer' })
          .send({ name: 'Editado' })
      ).status,
    ).toBe(200);
    expect(
      (
        await http()
          .post(`${base}/${id}/duplicate`)
          .auth('ca13-fixture-session', { type: 'bearer' })
          .send({ name: 'Duplicado' })
      ).status,
    ).toBe(201);
    expect(
      (
        await http()
          .delete(`${base}/${id}`)
          .auth('ca13-fixture-session', { type: 'bearer' })
      ).status,
    ).toBe(204);
    expect(
      (
        await http()
          .get(`${base}/${id}`)
          .auth('ca13-fixture-session', { type: 'bearer' })
      ).status,
    ).toBe(404);
    const someone = member();
    const personal = await service.create(scope, someone, {
      name: 'Outra pessoa',
    });
    expect(
      (
        await http()
          .get(`${base}/${personal.id}`)
          .auth('ca13-fixture-session', { type: 'bearer' })
      ).status,
    ).toBe(404);
    expect(
      (
        await http()
          .get(
            `/api/client-area/companies/${randomUUID()}/analytics/dashboards`,
          )
          .auth('ca13-fixture-session', { type: 'bearer' })
      ).status,
    ).toBe(404);
  });
  it('projects Owner versus member in Overview and revalidates active scope/session on reads', async () => {
    const http = () => request(app.getHttpServer() as Server),
      base = `/api/client-area/companies/${scope.companyContextId}`;
    const memberResponse = await http()
      .get(`${base}/overview`)
      .auth('ca13-fixture-session', { type: 'bearer' });
    expect(memberResponse.status).toBe(200);
    expect(
      (memberResponse.body as { slices: Record<string, { status: string }> })
        .slices['agency.invoices'].status,
    ).toBe('unavailable');
    httpMember.accountRole = 'client_owner';
    httpMember.role = 'client_owner';
    const owner = await http()
      .get(`${base}/overview`)
      .auth('ca13-fixture-session', { type: 'bearer' });
    expect(
      (
        owner.body as {
          slices: Record<string, { status: string; data: unknown }>;
        }
      ).slices['agency.invoices'],
    ).toEqual({
      status: 'available',
      data: { companyIds: [scope.companyContextId] },
    });
    expect(
      (
        await http()
          .get('/api/agency/client-area-analytics/metrics/agency.projects')
          .auth('ca13-fixture-session', { type: 'bearer' })
      ).status,
    ).toBe(200);
    httpRevoked = true;
    expect(
      (
        await http()
          .get(`${base}/overview`)
          .auth('ca13-fixture-session', { type: 'bearer' })
      ).status,
    ).toBe(401);
    httpRevoked = false;
    await db.query("UPDATE agency_clients SET status='archived' WHERE id=$1", [
      scope.agencyClientId,
    ]);
    try {
      for (const suffix of ['/overview', '/analytics/dashboards'])
        expect(
          (
            await http()
              .get(base + suffix)
              .auth('ca13-fixture-session', { type: 'bearer' })
          ).status,
        ).toBe(404);
    } finally {
      await db.query("UPDATE agency_clients SET status='active' WHERE id=$1", [
        scope.agencyClientId,
      ]);
    }
  });
  it('keeps Agency CRUD private from personal dashboards and proves valid sibling-company isolation over HTTP', async () => {
    const base = `/api/agency/clients/${scope.agencyClientId}/companies/${scope.companyContextId}/client-area/analytics/dashboards`;
    const http = () => request(app.getHttpServer() as Server),
      auth = { type: 'bearer' as const };
    expect(
      (await http().get(base).auth('ca13-agency-fixture', auth)).status,
    ).toBe(200);
    const created = await http()
      .post(base)
      .auth('ca13-agency-fixture', auth)
      .send({ name: 'Publicado' });
    expect(created.status).toBe(201);
    const id = (created.body as { id: string }).id;
    expect(
      (await http().get(`${base}/${id}`).auth('ca13-agency-fixture', auth))
        .status,
    ).toBe(200);
    expect(
      (
        await http()
          .patch(`${base}/${id}`)
          .auth('ca13-agency-fixture', auth)
          .send({ name: 'Publicado editado' })
      ).status,
    ).toBe(200);
    expect(
      (
        await http()
          .post(`${base}/${id}/duplicate`)
          .auth('ca13-agency-fixture', auth)
          .send({ name: 'Outro publicado' })
      ).status,
    ).toBe(201);
    const personal = await service.create(scope, member(), { name: 'Privado' });
    for (const method of ['get', 'patch', 'delete'] as const)
      expect(
        (
          await http()
            [method](`${base}/${personal.id}`)
            .auth('ca13-agency-fixture', auth)
            .send(method === 'patch' ? { name: 'No' } : undefined)
        ).status,
      ).toBe(404);
    const sibling = randomUUID();
    await db.query(
      "INSERT INTO agency_client_company_contexts VALUES($1,$2,$3,$4,'active',NULL)",
      [sibling, scope.tenantId, scope.workspaceId, scope.agencyClientId],
    );
    const siblingBase = base.replace(scope.companyContextId, sibling);
    expect(
      (
        await http()
          .get(`${siblingBase}/${id}`)
          .auth('ca13-agency-fixture', auth)
      ).status,
    ).toBe(404);
    expect(
      (await http().get(`${base}/not-a-uuid`).auth('ca13-agency-fixture', auth))
        .status,
    ).toBe(404);
    expect(
      (await http().delete(`${base}/${id}`).auth('ca13-agency-fixture', auth))
        .status,
    ).toBe(204);
  });
  it('rejects foreign/private targets and revoked/archived authority on every facade CRUD route', async () => {
    const base = `/api/client-area/companies/${scope.companyContextId}/analytics/dashboards`;
    const ownActor: DashboardActor = {
      surface: 'client_area',
      context: httpMember,
    };
    const own = await service.create(scope, ownActor, { name: 'Own' });
    const privateRow = await service.create(scope, member(), {
      name: 'Private',
    });
    const http = () => request(app.getHttpServer() as Server);
    const perform = (
      method: 'get' | 'post' | 'patch' | 'delete',
      path: string,
    ) =>
      http()
        [method](path)
        .auth('ca13-fixture-session', { type: 'bearer' })
        .send(
          method === 'get' || method === 'delete'
            ? undefined
            : { name: 'Attempt' },
        );
    const resources = (id: string) =>
      [
        ['get', `${base}/${id}`],
        ['patch', `${base}/${id}`],
        ['delete', `${base}/${id}`],
        ['post', `${base}/${id}/duplicate`],
      ] as const;
    for (const [method, path] of resources(privateRow.id))
      expect((await perform(method, path)).status).toBe(404);
    const all = [['get', base], ['post', base], ...resources(own.id)] as const;
    for (const [method, path] of all)
      expect(
        (
          await perform(
            method,
            path.replace(scope.companyContextId, randomUUID()),
          )
        ).status,
      ).toBe(404);
    httpRevoked = true;
    for (const [method, path] of all)
      expect((await perform(method, path)).status).toBe(401);
    httpRevoked = false;
    await db.query("UPDATE agency_clients SET status='archived' WHERE id=$1", [
      scope.agencyClientId,
    ]);
    try {
      for (const [method, path] of all)
        expect((await perform(method, path)).status).toBe(404);
    } finally {
      await db.query("UPDATE agency_clients SET status='active' WHERE id=$1", [
        scope.agencyClientId,
      ]);
    }
    expect((await service.read(scope, ownActor, own.id)).name).toBe('Own');
    const agencyBase = `/api/agency/clients/${randomUUID()}/companies/${scope.companyContextId}/client-area/analytics/dashboards`;
    for (const [method, path] of [
      ['get', agencyBase],
      ['post', agencyBase],
      ...resources(own.id).map(
        ([verb, path]) => [verb, path.replace(base, agencyBase)] as const,
      ),
    ] as const)
      expect(
        (
          await http()
            [method](path)
            .auth('ca13-agency-fixture', { type: 'bearer' })
            .send(
              method === 'get' || method === 'delete'
                ? undefined
                : { name: 'Attempt' },
            )
        ).status,
      ).toBe(404);
  });
});
