import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import {
  CLIENT_AREA_EXPOSED_METADATA,
  clientAreaExposedModules,
} from '../../../common/client-area-bridge/client-area-bridge.registry';
import { TaskWorkspaceController } from '../controllers/task-workspace.controller';
import { ProjectEventsController } from '../controllers/project-events.controller';
import { ProjectFollowersAttachmentsController } from '../controllers/project-followers-attachments.controller';
import { ProjectEventsService } from '../services/project-events.service';
import { ProjectFollowersAttachmentsService } from '../services/project-followers-attachments.service';
import { ClientAgencyBillingController } from '../../client-agency-billing/client-agency-billing.controller';
import {
  ClientAgencyBillingService,
  billingOwnerScope,
} from '../../client-agency-billing/client-agency-billing.service';
import { ProjectsCrudController } from '../controllers/projects-crud.controller';
import { TasksCrudController } from '../controllers/tasks-crud.controller';
import { ProjectBoardsController } from '../controllers/project-boards.controller';
import { ProjectSettingsController } from '../controllers/project-settings.controller';
import { TasksCrudService } from '../services/tasks-crud.service';
import { ProjectsCrudService } from '../services/projects-crud.service';
import { TaskAttachmentsService } from '../services/task-attachments.service';
import { TaskWorkspaceService } from '../services/task-workspace.service';
import { ProjectSettingsService } from '../services/project-settings.service';
import { ProjectBoardsService } from '../services/project-boards.service';
import { ProjectsClientAreaScopeService } from './projects-client-area-scope.service';
import { ProjectsClientAreaInterceptor } from './projects-client-area.interceptor';
import type { ProjectRequestContext } from './projects-client-area.context';
import type { Server } from 'node:http';
import {
  NotFoundException,
  UnauthorizedException,
  type INestApplication,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  ClientAreaBridgeRegistry,
  ClientAreaBridgeRegistryModule,
} from '../../../common/client-area-bridge/client-area-bridge.registry';
import { TenantContextAuthority } from '../../../common/context/tenant-context-authority.service';
import { OperationalContextResolver } from '../../../common/context/operational-context.resolver';
import { JwtStrategy } from '../../auth/strategies/jwt.strategy';
import { PermissionsGuard } from '../../permissions/guards/permissions.guard';
import { PermissionScopeEvaluatorService } from '../../permissions/services/permission-scope-evaluator.service';
import { PlatformPermissionService } from '../../permissions/services/platform-permission.service';
import { AgencyClient } from '../../clients/entities/agency-client.entity';
import { ClientAreaJwtStrategy } from '../../client-area/strategies/client-area-jwt.strategy';
import {
  ClientAreaAuthGuard,
  ClientAreaMembershipGuard,
} from '../../client-area/guards/client-area.guards';
import { ClientAreaBridgeAuthenticator } from '../../client-area/services/client-area-bridge-authenticator';
import { ClientAreaSessionService } from '../../client-area/services/client-area-session.service';
import { ClientAreaManagementService } from '../../client-area/services/client-area-management.service';
import { ClientAreaAuthorizationService } from '../../client-area/services/client-area-authorization.service';
import { resolveMemberAccess } from '../../client-area/client-area-permissions.catalog';
import type { ClientAreaContext } from '../../client-area/client-area.types';

const tenant = randomUUID(),
  workspace = randomUUID(),
  company = randomUUID(),
  client = randomUUID(),
  user = randomUUID(),
  session = randomUUID();
const task = randomUUID(),
  foreignTask = randomUUID(),
  otherCreatorTask = randomUUID();
const clientSecret = 'ca7-client-secret-012345678901234567890';
const agencySecret = 'ca7-agency-secret-012345678901234567890';

const project = randomUUID();
const tasksService = {
  findOne: () =>
    Promise.resolve({
      id: task,
      title: 'Card',
      trackedMinutes: 123,
      blockedReason: 'Internal',
      tenantId: tenant,
    }),
  update: () => Promise.resolve({ id: task, title: 'Moved' }),
  archive: () => Promise.resolve({ id: task, status: 'archived' }),
};
const projectsService = {
  create: jest.fn(
    (ctx: ProjectRequestContext, body: { clientId?: string; name: string }) =>
      Promise.resolve({
        id: project,
        name: body.name,
        clientId: body.clientId,
        publicPagePassword: 'secret',
      }),
  ),
  archive: () => Promise.resolve({ id: project, status: 'archived' }),
};
describe('CA9 production Projects controllers through the real HTTP bridge', () => {
  let app: INestApplication, jwt: JwtService;
  const saved = { ...process.env };
  const authorize = jest.fn(),
    authenticate = jest.fn(),
    assertCan = jest.fn();
  let context: ClientAreaContext;
  beforeAll(async () => {
    Object.assign(process.env, {
      CLIENT_AREA_ENABLED: 'true',
      CLIENT_AREA_BRIDGE_ENABLED: 'true',
      JWT_CLIENT_AREA_ACCESS_SECRET: clientSecret,
      JWT_ACCESS_SECRET: agencySecret,
    });
    const repo = {
      findOne: jest.fn(
        ({
          where,
        }: {
          where: { id: string; tenantId: string; workspaceId: string };
        }) =>
          Promise.resolve(
            where.tenantId === tenant &&
              where.workspaceId === workspace &&
              ([task, foreignTask, otherCreatorTask] as string[]).includes(
                where.id,
              )
              ? {
                  id: where.id,
                  clientId: where.id === foreignTask ? randomUUID() : client,
                  createdById:
                    where.id === otherCreatorTask ? randomUUID() : user,
                }
              : null,
          ),
      ),
    };
    const registry = new ClientAreaBridgeRegistry();
    const dependencies = Array(
      (
        Reflect.getMetadata(
          'design:paramtypes',
          PermissionScopeEvaluatorService,
        ) as unknown[]
      ).length,
    ).fill(repo);
    dependencies[dependencies.length - 1] = registry;
    const evaluator = Reflect.construct(
      PermissionScopeEvaluatorService,
      dependencies,
    ) as PermissionScopeEvaluatorService;
    const mod = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }),
        PassportModule,
        JwtModule.register({}),
        ClientAreaBridgeRegistryModule,
      ],
      controllers: [
        TaskWorkspaceController,
        ProjectEventsController,
        ProjectFollowersAttachmentsController,
        ClientAgencyBillingController,
        ProjectSettingsController,
        ProjectBoardsController,
        TasksCrudController,
        ProjectsCrudController,
      ],
      providers: [
        { provide: ProjectEventsService, useValue: {} },
        { provide: ProjectFollowersAttachmentsService, useValue: {} },
        ClientAreaMembershipGuard,
        {
          provide: ClientAgencyBillingService,
          useValue: {
            invoices: (ctx: ClientAreaContext) => {
              billingOwnerScope(ctx);
              return { invoices: [] };
            },
            invoicePdf: (ctx: ClientAreaContext) => {
              billingOwnerScope(ctx);
              return Promise.resolve({
                buffer: Buffer.from('%PDF-fixture'),
                fileName: 'invoice.pdf',
              });
            },
          },
        },
        ProjectsClientAreaScopeService,
        ProjectsClientAreaInterceptor,
        {
          provide: getDataSourceToken('agency'),
          useValue: {
            query: (sql: string, values: unknown[]) =>
              Promise.resolve(
                sql.includes('agency_tasks') &&
                  values[2] === client &&
                  ([task, otherCreatorTask] as string[]).includes(
                    String(values[3]),
                  )
                  ? [
                      {
                        id: values[3],
                        createdById: values[3] === task ? user : 'other',
                      },
                    ]
                  : sql.includes('agency_projects') &&
                      values[2] === client &&
                      values[3] === project
                    ? [{ id: project, createdById: user }]
                    : [],
              ),
          },
        },
        { provide: TasksCrudService, useValue: tasksService },
        { provide: ProjectsCrudService, useValue: projectsService },
        { provide: TaskAttachmentsService, useValue: {} },
        { provide: TaskWorkspaceService, useValue: {} },
        { provide: ProjectSettingsService, useValue: {} },
        {
          provide: ProjectBoardsService,
          useValue: {
            getProjectsBoard: () =>
              Promise.resolve({
                columns: [],
                unassigned: { id: null, name: 'Other', cards: [] },
              }),
          },
        },
        JwtStrategy,
        ClientAreaJwtStrategy,
        ClientAreaAuthGuard,
        ClientAreaBridgeAuthenticator,
        PermissionsGuard,
        {
          provide: TenantContextAuthority,
          useValue: new TenantContextAuthority({
            getRepository: () => ({
              findOne: () => Promise.resolve({ role: 'owner' }),
            }),
          } as never),
        },
        { provide: ClientAreaSessionService, useValue: { authenticate } },
        {
          provide: ClientAreaManagementService,
          useValue: {
            assertIdentityAgencyEnabled: jest
              .fn()
              .mockResolvedValue({ enabled: true }),
          },
        },
        { provide: ClientAreaAuthorizationService, useValue: { authorize } },
        { provide: PlatformPermissionService, useValue: { assertCan } },
        {
          provide: OperationalContextResolver,
          useValue: { resolve: jest.fn().mockResolvedValue(null) },
        },
        { provide: PermissionScopeEvaluatorService, useValue: evaluator },
        {
          provide: getRepositoryToken(AgencyClient, 'agency'),
          useValue: {
            findOne: () => Promise.resolve({ managedTenantId: randomUUID() }),
          },
        },
      ],
    })
      .overrideProvider(ClientAreaBridgeRegistry)
      .useValue(registry)
      .compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    jwt = mod.get(JwtService);
    mod
      .get(ClientAreaBridgeRegistry)
      .register(mod.get(ClientAreaBridgeAuthenticator));
  });
  beforeEach(() => {
    process.env.CLIENT_AREA_BRIDGE_ENABLED = 'true';
    assertCan.mockReset().mockResolvedValue(undefined);
    context = {
      surface: 'client_area',
      tenantId: tenant,
      workspaceId: workspace,
      agencyClientId: client,
      companyContextId: company,
      membershipId: randomUUID(),
      userId: user,
      sessionId: session,
      companyDisplayName: 'Company',
      role: 'client_member',
      permissions: new Set(),
      modules: {
        approvals: false,
        conversations: false,
        agency_projects: true,
      },
      memberAccess: resolveMemberAccess(
        'client_member',
        { agency_projects: true },
        { agency_projects: 'operator' },
      ),
    };
    authenticate.mockReset().mockImplementation(() =>
      Promise.resolve({
        tenantId: tenant,
        userId: user,
        sessionId: session,
        email: 'client@example.com',
      }),
    );
    authorize
      .mockReset()
      .mockImplementation(
        ({ companyContextId }: { companyContextId: string }) => {
          if (companyContextId !== company) {
            throw new NotFoundException();
          }
          return Promise.resolve(context);
        },
      );
  });
  afterAll(async () => {
    if (app) await app.close();
    process.env = { ...saved };
  });
  const token = (secret = clientSecret) =>
    jwt.signAsync(
      { sub: user, tenantId: tenant, sessionId: session, typ: 'client_area' },
      { secret, expiresIn: '5m' },
    );
  const get = async (path: string) =>
    request(app.getHttpServer() as Server)
      .get(`/api${path}`)
      .set('Authorization', `Bearer ${await token()}`)
      .set('x-lyra-client-area-company', company);
  it('rejects workspace configuration, foreign company and a disabled bridge', async () => {
    expect((await get('/agency/projects/settings')).status).toBe(401);
    await request(app.getHttpServer() as Server)
      .get('/api/agency/projects')
      .set('Authorization', `Bearer ${await token()}`)
      .set('x-lyra-client-area-company', randomUUID())
      .expect(404);
    process.env.CLIENT_AREA_BRIDGE_ENABLED = 'false';
    expect((await get('/agency/projects')).status).toBe(401);
  });
  it('allows operator editing another creator card, but requires authorship for archive and delete', async () => {
    const auth = `Bearer ${await token()}`;
    const mutate = (method: 'patch' | 'delete', id: string, body?: object) =>
      request(app.getHttpServer() as Server)
        [method](`/api/agency/projects/tasks/${id}`)
        .set('Authorization', auth)
        .set('x-lyra-client-area-company', company)
        .send(body);
    await mutate('patch', otherCreatorTask, {
      title: 'Moved',
      stageId: null,
    }).expect(200);
    await mutate('patch', otherCreatorTask, { status: 'archived' }).expect(404);
    await mutate('delete', otherCreatorTask).expect(404);
    await mutate('delete', task).expect(200);
  });
  it('denies foreign resources, internal write fields and Viewer mutations', async () => {
    expect((await get(`/agency/projects/tasks/${foreignTask}`)).status).toBe(
      404,
    );
    await request(app.getHttpServer() as Server)
      .patch(`/api/agency/projects/tasks/${task}`)
      .set('Authorization', `Bearer ${await token()}`)
      .set('x-lyra-client-area-company', company)
      .send({ trackedMinutes: 99 })
      .expect(404);
    context.memberAccess = resolveMemberAccess(
      'client_member',
      { agency_projects: true },
      { agency_projects: 'viewer' },
    );
    expect((await get(`/agency/projects/tasks/${task}`)).status).toBe(200);
    await request(app.getHttpServer() as Server)
      .patch(`/api/agency/projects/tasks/${task}`)
      .set('Authorization', `Bearer ${await token()}`)
      .set('x-lyra-client-area-company', company)
      .send({ title: 'Forbidden' })
      .expect(403);
  });
  it('confines Manager project creation and archival, hides internal response fields, and preserves identity', async () => {
    context.memberAccess = resolveMemberAccess(
      'client_member',
      { agency_projects: true },
      { agency_projects: 'manager' },
    );
    const response = await request(app.getHttpServer() as Server)
      .post('/api/agency/projects')
      .set('Authorization', `Bearer ${await token()}`)
      .set('x-lyra-client-area-company', company)
      .set('x-user-id', randomUUID())
      .send({ name: 'New', clientId: randomUUID() })
      .expect(201);
    expect(response.body).toEqual({ id: project, name: 'New' });
    const [ctx, body] = projectsService.create.mock.calls.at(-1)!;
    expect(ctx.userId).toBe(user);
    expect(ctx.clientArea?.agencyClientId).toBe(client);
    expect(body.clientId).toBe(client);
    await request(app.getHttpServer() as Server)
      .delete(`/api/agency/projects/${project}`)
      .set('Authorization', `Bearer ${await token()}`)
      .set('x-lyra-client-area-company', company)
      .expect(200);
    await request(app.getHttpServer() as Server)
      .delete(`/api/agency/projects/${randomUUID()}`)
      .set('Authorization', `Bearer ${await token()}`)
      .set('x-lyra-client-area-company', company)
      .expect(404);
    const card = await get(`/agency/projects/tasks/${task}`);
    expect(card.body).not.toHaveProperty('trackedMinutes');
    expect(card.body).not.toHaveProperty('blockedReason');
  });
  it('checks Owner and company on facade routes, streams PDF bytes, and rejects a revoked session', async () => {
    const path = `/client-area/companies/${company}/agency/billing/invoices`;
    await request(app.getHttpServer() as Server)
      .get(`/api${path}`)
      .set('Authorization', `Bearer ${await token()}`)
      .expect(403);
    context.role = 'client_owner';
    context.accountRole = 'client_owner';
    const pdf = await request(app.getHttpServer() as Server)
      .get(`/api${path}/${task}/pdf`)
      .set('Authorization', `Bearer ${await token()}`)
      .expect(200);
    expect(pdf.headers['content-type']).toMatch(/application\/pdf/);
    expect((pdf.body as Buffer).toString()).toBe('%PDF-fixture');
    expect(pdf.headers['cache-control']).toBe('no-store');
    await request(app.getHttpServer() as Server)
      .get(`/api/client-area/companies/${randomUUID()}/agency/billing/invoices`)
      .set('Authorization', `Bearer ${await token()}`)
      .expect(404);
    authenticate.mockRejectedValueOnce(new UnauthorizedException());
    await request(app.getHttpServer() as Server)
      .get(`/api${path}`)
      .set('Authorization', `Bearer ${await token()}`)
      .expect(401);
  });
  it('checks company, live session and Viewer mutation level on every production Projects opt-in', async () => {
    const verbs: Partial<
      Record<RequestMethod, 'get' | 'post' | 'patch' | 'delete'>
    > = {
      [RequestMethod.GET]: 'get',
      [RequestMethod.POST]: 'post',
      [RequestMethod.PATCH]: 'patch',
      [RequestMethod.DELETE]: 'delete',
    };
    const controllers = [
      ProjectsCrudController,
      TasksCrudController,
      ProjectBoardsController,
      TaskWorkspaceController,
      ProjectEventsController,
      ProjectFollowersAttachmentsController,
    ];
    const endpoints = controllers.flatMap((controller) =>
      Object.getOwnPropertyNames(controller.prototype).flatMap((name) => {
        const handler = Reflect.get(controller.prototype, name) as object;
        if (
          !clientAreaExposedModules(
            Reflect.getMetadata(CLIENT_AREA_EXPOSED_METADATA, handler),
          ).includes('agency_projects')
        )
          return [];
        const verb =
          verbs[Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod];
        if (!verb) throw new Error('Unsupported HTTP method');
        const base = Reflect.getMetadata(PATH_METADATA, controller) as string;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as string;
        const url = `/api/${base}/${path ?? ''}`
          .replace(/\/$/, '')
          .replace(/:([a-zA-Z]+)/g, (_match, key: string) =>
            key === 'projectId' ? project : task,
          );
        return [{ verb, url }];
      }),
    );
    expect(endpoints).toHaveLength(32);
    context.memberAccess = resolveMemberAccess(
      'client_member',
      { agency_projects: true },
      { agency_projects: 'viewer' },
    );
    const auth = `Bearer ${await token()}`;
    for (const endpoint of endpoints) {
      const call = (companyId: string) =>
        request(app.getHttpServer() as Server)
          [endpoint.verb](endpoint.url)
          .set('Authorization', auth)
          .set('x-lyra-client-area-company', companyId)
          .send({});
      await call(randomUUID()).expect(404);
      authenticate.mockRejectedValueOnce(new UnauthorizedException());
      await call(company).expect(401);
      if (endpoint.verb !== 'get') await call(company).expect(403);
    }
  });
});
