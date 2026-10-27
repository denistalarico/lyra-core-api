import type { DashboardActor } from './client-area-dashboards.service';
import type { ClientAreaCompanyScope } from '../client-area/client-area-company-hooks.registry';
import type { Server } from 'node:http';
import {
  NotFoundException,
  ForbiddenException,
  UnauthorizedException,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  ClientAreaBridgeRegistry,
  ClientAreaBridgeRegistryModule,
} from '../../common/client-area-bridge/client-area-bridge.registry';
import { TenantContextAuthority } from '../../common/context/tenant-context-authority.service';
import { OperationalContextResolver } from '../../common/context/operational-context.resolver';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { PermissionsGuard } from '../permissions/guards/permissions.guard';
import { PermissionScopeEvaluatorService } from '../permissions/services/permission-scope-evaluator.service';
import { PlatformPermissionService } from '../permissions/services/platform-permission.service';
import { AgencyClient } from '../clients/entities/agency-client.entity';
import { ClientAreaJwtStrategy } from '../client-area/strategies/client-area-jwt.strategy';
import {
  ClientAreaAuthGuard,
  ClientAreaMembershipGuard,
} from '../client-area/guards/client-area.guards';
import { ClientAreaBridgeAuthenticator } from '../client-area/services/client-area-bridge-authenticator';
import { ClientAreaSessionService } from '../client-area/services/client-area-session.service';
import { ClientAreaManagementService } from '../client-area/services/client-area-management.service';
import { ClientAreaAuthorizationService } from '../client-area/services/client-area-authorization.service';
import { AuditChangeInterceptor } from '../client-area/services/audit-change.interceptor';
import { AuditChangeService } from '../client-area/services/audit-change.service';
import {
  CLIENT_AREA_MODULE_KEYS,
  type ClientAreaModuleKey,
  type ClientAreaContext,
} from '../client-area/client-area.types';
import {
  ClientAreaOverviewController,
  ClientAreaDashboardsController,
  ClientAreaDashboardsAgencyController,
  ClientAreaMetricDataController,
} from './client-area-analytics.controller';
import { ClientAreaSourcesRegistry } from './client-area-sources.registry';
import {
  ClientAreaOverviewService,
  OVERVIEW_SOURCES,
} from './client-area-overview.service';
import { ClientAreaMetricDataService } from './client-area-metric-data.service';
import { ClientAreaDashboardsService } from './client-area-dashboards.service';
import { ClientAreaAnalyticsModule } from './client-area-analytics.module';
jest.mock('otplib', () => ({ verify: jest.fn() }));
const scope = {
    tenantId: randomUUID(),
    workspaceId: randomUUID(),
    agencyClientId: randomUUID(),
    companyContextId: randomUUID(),
  },
  user = randomUUID(),
  session = randomUUID();
const clientSecret = 'ca13-client-secret-012345678901234567890',
  agencySecret = 'ca13-agency-secret-012345678901234567890';
describe('CA13 real HTTP facade and Bridge guards (offline signed sessions)', () => {
  let app: INestApplication,
    jwt: JwtService,
    context: ClientAreaContext,
    revoked = false,
    archived = false;
  const saved = { ...process.env },
    dataRead = jest.fn(),
    assertCan = jest.fn(),
    audit = jest.fn(),
    create = jest.fn();
  const dashboards = {
    assertCompany: jest.fn(),
    list: jest.fn(),
    read: jest.fn(),
    create,
    update: jest.fn(),
    remove: jest.fn(),
    duplicate: jest.fn(),
  };
  beforeAll(async () => {
    Object.assign(process.env, {
      CLIENT_AREA_ENABLED: 'true',
      CLIENT_AREA_BRIDGE_ENABLED: 'true',
      JWT_CLIENT_AREA_ACCESS_SECRET: clientSecret,
      JWT_ACCESS_SECRET: agencySecret,
    });
    const registry = new ClientAreaBridgeRegistry();
    const dependencies = Array(
      (
        Reflect.getMetadata(
          'design:paramtypes',
          PermissionScopeEvaluatorService,
        ) as unknown[]
      ).length,
    ).fill({});
    dependencies[dependencies.length - 1] = registry;
    const evaluator = Reflect.construct(
      PermissionScopeEvaluatorService,
      dependencies,
    ) as PermissionScopeEvaluatorService;
    const sources = new ClientAreaSourcesRegistry();
    for (const key of OVERVIEW_SOURCES)
      sources.register({
        key,
        modules: key.startsWith('agency.') ? ['agency_projects'] : [],
        ownerOnly: key === 'agency.invoices' || key === 'agency.contract',
        read: (input) =>
          Promise.resolve({ company: input.scope.companyContextId }),
      });
    sources.register({
      key: 'metric.social.paid',
      modules: [],
      read: dataRead,
    });
    const mod = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }),
        PassportModule,
        JwtModule.register({}),
        ClientAreaBridgeRegistryModule,
      ],
      controllers: [
        ClientAreaOverviewController,
        ClientAreaDashboardsController,
        ClientAreaDashboardsAgencyController,
        ClientAreaMetricDataController,
      ],
      providers: [
        JwtStrategy,
        ClientAreaJwtStrategy,
        ClientAreaAuthGuard,
        ClientAreaMembershipGuard,
        ClientAreaBridgeAuthenticator,
        PermissionsGuard,
        ClientAreaOverviewService,
        ClientAreaMetricDataService,
        {
          provide: TenantContextAuthority,
          useValue: new TenantContextAuthority({
            getRepository: () => ({
              findOne: () => Promise.resolve({ role: 'owner' }),
            }),
          } as never),
        },
        {
          provide: ClientAreaSessionService,
          useValue: {
            authenticate: (payload: {
              sub: string;
              tenantId: string;
              sessionId: string;
            }) => {
              if (
                revoked ||
                payload.sub !== user ||
                payload.tenantId !== scope.tenantId ||
                payload.sessionId !== session
              )
                throw new UnauthorizedException();
              return Promise.resolve({
                tenantId: scope.tenantId,
                userId: user,
                sessionId: session,
                email: 'fixture@example.com',
              });
            },
          },
        },
        {
          provide: ClientAreaManagementService,
          useValue: { assertIdentityAgencyEnabled: () => Promise.resolve() },
        },
        {
          provide: ClientAreaAuthorizationService,
          useValue: {
            authorize: ({
              companyContextId,
              module,
            }: {
              companyContextId: string;
              module?: ClientAreaModuleKey;
            }) => {
              if (archived || companyContextId !== scope.companyContextId)
                throw new NotFoundException();
              if (module && !context.memberAccess?.[module]?.available)
                throw new ForbiddenException();
              return Promise.resolve(context);
            },
          },
        },
        {
          provide: PlatformPermissionService,
          useValue: {
            assertCan,
            canAccessClient: () => Promise.resolve(true),
            auditPermissionDecision: () => Promise.resolve(),
          },
        },
        {
          provide: OperationalContextResolver,
          useValue: { resolve: () => Promise.resolve(null) },
        },
        { provide: PermissionScopeEvaluatorService, useValue: evaluator },
        {
          provide: getRepositoryToken(AgencyClient, 'agency'),
          useValue: {
            findOne: () => Promise.resolve({ managedTenantId: randomUUID() }),
          },
        },
        { provide: ClientAreaSourcesRegistry, useValue: sources },
        { provide: ClientAreaDashboardsService, useValue: dashboards },
        { provide: AuditChangeService, useValue: { record: audit } },
        { provide: APP_INTERCEPTOR, useClass: AuditChangeInterceptor },
      ],
    })
      .overrideProvider(ClientAreaBridgeRegistry)
      .useValue(registry)
      .compile();
    new ClientAreaAnalyticsModule(registry).onModuleInit();
    registry.register(mod.get(ClientAreaBridgeAuthenticator));
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    jwt = mod.get(JwtService);
  });
  beforeEach(() => {
    revoked = false;
    archived = false;
    process.env.CLIENT_AREA_BRIDGE_ENABLED = 'true';
    jest.clearAllMocks();
    assertCan.mockResolvedValue(undefined);
    audit.mockResolvedValue(undefined);
    dataRead.mockResolvedValue({
      mode: 'canonical_sources',
      sources: { paid: { current: { spend: '1.00' } } },
    });
    create.mockImplementation(
      (
        _scope: ClientAreaCompanyScope,
        actor: DashboardActor,
        body: { name: string },
      ) =>
        Promise.resolve({
          id: randomUUID(),
          name: body.name,
          ownerSurface: actor.surface,
        }),
    );
    dashboards.list.mockResolvedValue({ items: [], total: 0 });
    dashboards.assertCompany.mockResolvedValue(undefined);
    context = {
      ...scope,
      surface: 'client_area',
      userId: user,
      sessionId: session,
      membershipId: randomUUID(),
      role: 'client_member',
      accountRole: 'client_member',
      companyDisplayName: 'Fixture',
      permissions: new Set(),
      modules: {
        approvals: true,
        conversations: true,
        ...Object.fromEntries(
          CLIENT_AREA_MODULE_KEYS.map((key) => [key, true]),
        ),
      },
      // CA-AN1 (D-AN-13): a Viewer never reaches Analytics, so the module
      // itself is held at Operator (read-only, like the Viewer it replaced).
      memberAccess: Object.fromEntries(
        CLIENT_AREA_MODULE_KEYS.map((key) => [
          key,
          {
            available: true,
            level: key === 'analytics' ? 'operator' : 'viewer',
          },
        ]),
      ) as ClientAreaContext['memberAccess'],
    } as ClientAreaContext;
  });
  afterAll(async () => {
    if (app) await app.close();
    process.env = { ...saved };
  });
  const token = () =>
    jwt.signAsync(
      {
        sub: user,
        tenantId: scope.tenantId,
        sessionId: session,
        typ: 'client_area',
      },
      { secret: clientSecret, expiresIn: '5m' },
    );
  const base = () => `/api/client-area/companies/${scope.companyContextId}`;
  const get = async (path: string) =>
    request(app.getHttpServer() as Server)
      .get(path)
      .auth(await token(), { type: 'bearer' })
      .set('x-lyra-client-area-company', scope.companyContextId);
  it('binds signed identity/company before Overview and ignores forged authority headers', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get(`${base()}/overview`)
      .auth(await token(), { type: 'bearer' })
      .set('x-tenant-id', randomUUID())
      .set('x-user-id', randomUUID());
    expect(response.status).toBe(200);
    expect(
      (
        response.body as {
          slices: Record<string, { status: string; data: unknown }>;
        }
      ).slices['agency.projects'],
    ).toEqual({
      status: 'available',
      data: { company: scope.companyContextId },
    });
    expect(
      (response.body as { slices: Record<string, { status: string }> }).slices[
        'agency.invoices'
      ].status,
    ).toBe('unavailable');
    expect(
      (await get(`/api/client-area/companies/${randomUUID()}/overview`)).status,
    ).toBe(404);
  });
  it('lets a viewer create a personal layout, projects actor from the token, and audits the successful write', async () => {
    const response = await request(app.getHttpServer() as Server)
      .post(`${base()}/analytics/dashboards`)
      .auth(await token(), { type: 'bearer' })
      .send({ name: 'Pessoal', layout: { version: 1, sections: [] } });
    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith(
      scope,
      expect.objectContaining({
        surface: 'client_area',
        context: expect.objectContaining({ userId: user }) as ClientAreaContext,
      }),
      expect.objectContaining({ name: 'Pessoal' }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: user,
        actorSurface: 'client_area',
        ...scope,
      }),
    );
    const bad = await request(app.getHttpServer() as Server)
      .post(`${base()}/analytics/dashboards`)
      .auth(await token(), { type: 'bearer' })
      .send({
        name: 'Forged',
        ownerSurface: 'agency',
        ownerUserId: randomUUID(),
      });
    expect(bad.status).toBe(400);
    expect(create).toHaveBeenCalledTimes(1);
  });
  it('routes metrics through real read-only Bridge permission/scope checks and never Agency can()', async () => {
    const response = await get(
      '/api/agency/client-area-analytics/metrics/social.spend',
    );
    expect(response.status).toBe(200);
    expect((response.body as { status: string }).status).toBe('available');
    expect(dataRead).toHaveBeenCalledWith(
      expect.objectContaining({ scope, context, userId: user }),
    );
    expect(assertCan).not.toHaveBeenCalled();
    expect(
      (
        await get(
          '/api/agency/client-area-analytics/metrics/leadflow.quality.operational',
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await get(
          '/api/agency/client-area-analytics/metrics/social.spend?agencyClientId=' +
            randomUUID(),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app.getHttpServer() as Server)
          .post('/api/agency/client-area-analytics/metrics/social.spend')
          .auth(await token(), { type: 'bearer' })
          .send({})
      ).status,
    ).toBe(404);
  });
  it('denies data after source-module revocation and rejects invalid filters at the HTTP boundary', async () => {
    context.memberAccess!.social_campaigns = { available: false, level: null };
    const response = await get(
      '/api/agency/client-area-analytics/metrics/social.spend',
    );
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'unavailable',
      reason: 'module_unavailable',
    });
    expect(dataRead).not.toHaveBeenCalled();
    expect(
      (
        await get(
          '/api/agency/client-area-analytics/metrics/social.spend?unknown=1',
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await get(
          '/api/agency/client-area-analytics/metrics/social.spend?from=2020-01-01&to=2026-01-01',
        )
      ).status,
    ).toBe(400);
  });
  it('keeps the Bridge kill switch independent from facades; closed Agency CRUD remains 401', async () => {
    process.env.CLIENT_AREA_BRIDGE_ENABLED = 'false';
    expect(
      (await get('/api/agency/client-area-analytics/metrics/social.spend'))
        .status,
    ).toBe(401);
    expect((await get(`${base()}/overview`)).status).toBe(200);
    expect(
      (
        await get(
          `/api/agency/clients/${scope.agencyClientId}/companies/${scope.companyContextId}/client-area/analytics/dashboards`,
        )
      ).status,
    ).toBe(401);
  });
  it('rejects revoked sessions as 401 and archived/unavailable companies as 404 on every client read', async () => {
    for (const path of [
      `${base()}/overview`,
      `${base()}/analytics/dashboards`,
      '/api/agency/client-area-analytics/metrics/social.spend',
    ]) {
      revoked = true;
      expect((await get(path)).status).toBe(401);
      revoked = false;
      archived = true;
      expect((await get(path)).status).toBe(404);
      archived = false;
    }
  });
});
