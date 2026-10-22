import type { Server } from 'node:http';
import {
  NotFoundException,
  UnauthorizedException,
  Controller,
  Delete,
  Get,
  Patch,
  Req,
  UseGuards,
  type INestApplication,
} from '@nestjs/common';
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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { PermissionsGuard } from '../permissions/guards/permissions.guard';
import {
  DangerousAction,
  RequirePermission,
} from '../permissions/decorators/permissions.decorators';
import { PermissionScopeEvaluatorService } from '../permissions/services/permission-scope-evaluator.service';
import { PlatformPermissionService } from '../permissions/services/platform-permission.service';
import { AgencyClient } from '../clients/entities/agency-client.entity';
import { ClientAreaExposed } from './client-area.decorators';
import { ClientAreaJwtStrategy } from './strategies/client-area-jwt.strategy';
import { ClientAreaAuthGuard } from './guards/client-area.guards';
import { ClientAreaBridgeAuthenticator } from './services/client-area-bridge-authenticator';
import { ClientAreaSessionService } from './services/client-area-session.service';
import { ClientAreaManagementService } from './services/client-area-management.service';
import { ClientAreaAuthorizationService } from './services/client-area-authorization.service';
import { ClientAreaSelfAccessService } from './services/client-area-self-access.service';
import { resolveMemberAccess } from './client-area-permissions.catalog';
import { resolveSelfMemberAccess } from './client-area-self-modules';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request.type';
import type {
  ClientAreaContext,
  ClientAreaSelfContext,
} from './client-area.types';

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

@Controller('ca7-probe')
@UseGuards(JwtAuthGuard, PermissionsGuard)
class BridgeProbe {
  @Get('tasks/:id')
  @ClientAreaExposed('agency_projects')
  @RequirePermission('agency.tasks.task.update.assigned')
  read(@Req() req: AuthenticatedRequest) {
    return {
      user: req.user,
      managedContext: req.managedContext,
      headers: Object.keys(req.headers).filter((k) => k.startsWith('x-')),
    };
  }
  @Patch('tasks/:id')
  @ClientAreaExposed('agency_projects')
  @RequirePermission('agency.tasks.task.update.assigned')
  update() {
    return { ok: true };
  }
  @Delete('tasks/:id')
  @ClientAreaExposed('agency_projects')
  @RequirePermission('agency.tasks.task.update.assigned')
  archive() {
    return { ok: true };
  }
  @Get('unexposed')
  @RequirePermission('agency.tasks.task.update.assigned')
  unexposed() {
    return { ok: true };
  }
  @Get('no-permission') @ClientAreaExposed('agency_projects') noPermission() {
    return { ok: true };
  }
  @Get('dangerous')
  @ClientAreaExposed('agency_projects')
  @RequirePermission('agency.tasks.task.update.assigned')
  @DangerousAction()
  dangerous() {
    return { ok: true };
  }
}

describe('CA7 real HTTP bridge authentication and scopes', () => {
  let app: INestApplication, jwt: JwtService;
  const saved = { ...process.env };
  const authorize = jest.fn(),
    authenticate = jest.fn(),
    assertCan = jest.fn(),
    resolveSelfContext = jest.fn();
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
      controllers: [BridgeProbe],
      providers: [
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
        {
          provide: ClientAreaSelfAccessService,
          useValue: { resolveSelfContext },
        },
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
    mod
      .get(ClientAreaBridgeRegistry)
      .registerScopeResolver('agency_projects', async (ctx, _key, req) => {
        const row = await repo.findOne({
          where: {
            id: String(req.params?.id),
            tenantId: ctx.tenantId,
            workspaceId: ctx.workspaceId,
          },
        });
        if (
          !row ||
          row.clientId !== ctx.agencyClientId ||
          (req.body?.status === 'archived' &&
            ctx.memberAccess?.agency_projects.level === 'operator' &&
            row.createdById !== ctx.userId)
        )
          return null;
        return {
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          agencyClientId: row.clientId,
          companyContextId: ctx.companyContextId,
          createdById: row.createdById,
        };
      });
    app = mod.createNestApplication();
    await app.init();
    jwt = mod.get(JwtService);
    mod
      .get(ClientAreaBridgeRegistry)
      .register(mod.get(ClientAreaBridgeAuthenticator));
  });
  beforeEach(() => {
    process.env.CLIENT_AREA_BRIDGE_ENABLED = 'true';
    process.env.CLIENT_AREA_SELF_MODULES_ENABLED = 'true';
    resolveSelfContext.mockReset().mockResolvedValue(selfContext());
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
  const selfContext = (
    memberAccess = resolveSelfMemberAccess(true, new Set()),
  ): ClientAreaSelfContext => ({
    surface: 'client_area',
    kind: 'agency_self',
    userId: user,
    tenantId: tenant,
    sessionId: session,
    selfAccessId: randomUUID(),
    workspaceId: workspace,
    agencyDisplayName: 'Agency',
    role: 'client_admin',
    agencyRole: 'admin',
    permissions: new Set(),
    memberAccess,
    modules: { approvals: false, conversations: false },
  });
  const token = (secret = clientSecret) =>
    jwt.signAsync(
      { sub: user, tenantId: tenant, sessionId: session, typ: 'client_area' },
      { secret, expiresIn: '5m' },
    );
  const get = async (path: string) =>
    request(app.getHttpServer() as Server)
      .get(path)
      .set('Authorization', `Bearer ${await token()}`)
      .set('x-lyra-client-area-company', company);
  it('token on an unexposed Agency route is still 401', async () => {
    const result = await get('/ca7-probe/unexposed');
    expect(result.status).toBe(401);
  });
  it('verifies the dedicated signature and a live session', async () => {
    await request(app.getHttpServer() as Server)
      .get(`/ca7-probe/tasks/${task}`)
      .set('Authorization', `Bearer ${await token(agencySecret)}`)
      .set('x-lyra-client-area-company', company)
      .expect(401);
    authenticate.mockRejectedValueOnce(new UnauthorizedException());
    expect((await get(`/ca7-probe/tasks/${task}`)).status).toBe(401);
  });
  it('requires membership in the selected company (404)', async () => {
    await request(app.getHttpServer() as Server)
      .get(`/ca7-probe/tasks/${task}`)
      .set('Authorization', `Bearer ${await token()}`)
      .set('x-lyra-client-area-company', randomUUID())
      .expect(404);
  });
  it('discards forged x-* headers and forces user and company/product server-side without can()', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get(`/ca7-probe/tasks/${task}`)
      .set('Authorization', `Bearer ${await token()}`)
      .set('x-lyra-client-area-company', company)
      .set('x-tenant-id', randomUUID())
      .set('x-user-role', 'owner')
      .set('x-lyra-product-key', 'social')
      .expect(200);
    expect(response.body).toMatchObject({
      user: {
        tenantId: tenant,
        workspaceId: workspace,
        sub: user,
        role: 'client_area_actor',
        surface: 'client_area',
      },
      managedContext: {
        operatingMode: 'client',
        productKey: 'agency',
        clientId: client,
        companyContextId: company,
      },
      headers: [],
    });
    expect(assertCan).not.toHaveBeenCalled();
  });
  it('allows operator editing another creator card, denies archiving it and permits its own', async () => {
    const auth = `Bearer ${await token()}`;
    await request(app.getHttpServer() as Server)
      .patch(`/ca7-probe/tasks/${otherCreatorTask}`)
      .set('Authorization', auth)
      .set('x-lyra-client-area-company', company)
      .send({ name: 'edited' })
      .expect(200);
    await request(app.getHttpServer() as Server)
      .patch(`/ca7-probe/tasks/${otherCreatorTask}`)
      .set('Authorization', auth)
      .set('x-lyra-client-area-company', company)
      .send({ status: 'archived' })
      .expect(404);
    await request(app.getHttpServer() as Server)
      .delete(`/ca7-probe/tasks/${otherCreatorTask}`)
      .set('Authorization', auth)
      .set('x-lyra-client-area-company', company)
      .expect(404);
    await request(app.getHttpServer() as Server)
      .delete(`/ca7-probe/tasks/${task}`)
      .set('Authorization', auth)
      .set('x-lyra-client-area-company', company)
      .expect(200);
  });
  it('never authorizes a foreign client resource or reassignment', async () => {
    expect((await get(`/ca7-probe/tasks/${foreignTask}`)).status).toBe(404);
    await request(app.getHttpServer() as Server)
      .patch(`/ca7-probe/tasks/${task}`)
      .set('Authorization', `Bearer ${await token()}`)
      .set('x-lyra-client-area-company', company)
      .send({ clientId: randomUUID() })
      .expect(404);
  });
  it('denies viewer mutations (403), missing permission (403), dangerous actions (403) and the disabled bridge (401)', async () => {
    context.memberAccess = resolveMemberAccess(
      'client_member',
      { agency_projects: true },
      { agency_projects: 'viewer' },
    );
    await request(app.getHttpServer() as Server)
      .patch(`/ca7-probe/tasks/${task}`)
      .set('Authorization', `Bearer ${await token()}`)
      .set('x-lyra-client-area-company', company)
      .send({ name: 'x' })
      .expect(403);
    expect((await get('/ca7-probe/no-permission')).status).toBe(403);
    expect((await get('/ca7-probe/dangerous')).status).toBe(403);
    process.env.CLIENT_AREA_BRIDGE_ENABLED = 'false';
    expect((await get(`/ca7-probe/tasks/${task}`)).status).toBe(401);
  });
  it('keeps Agency token handling and permission checks', async () => {
    const auth = await jwt.signAsync(
      {
        sub: user,
        tenantId: tenant,
        workspaceId: workspace,
        sessionId: session,
        role: 'owner',
        email: 'staff@example.com',
      },
      { secret: agencySecret, expiresIn: '5m' },
    );
    await request(app.getHttpServer() as Server)
      .get('/ca7-probe/unexposed')
      .set('Authorization', `Bearer ${auth}`)
      .expect(200);
    expect(assertCan).toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
  });
  describe('CA15 agency self-context', () => {
    const getSelf = async (path: string) =>
      request(app.getHttpServer() as Server)
        .get(path)
        .set('Authorization', `Bearer ${await token()}`)
        .set('x-lyra-client-area-company', 'agency_self')
        .set('x-lyra-client-id', client)
        .set('x-lyra-operating-mode', 'client')
        .set('x-user-role', 'owner');
    it('acts as the operator in Agency mode, ignoring forged headers', async () => {
      const response = await getSelf(`/ca7-probe/tasks/${task}`).then((r) =>
        r.ok ? r : Promise.reject(new Error(String(r.status))),
      );
      expect(response.body).toEqual({
        user: {
          sub: user,
          tenantId: tenant,
          workspaceId: workspace,
          sessionId: session,
          email: 'client@example.com',
          role: 'admin',
        },
        managedContext: {
          operatingMode: 'agency',
          clientId: null,
          companyContextId: null,
          managedTenantId: null,
          productKey: 'agency',
        },
        headers: [],
      });
      expect(assertCan).toHaveBeenCalled();
      expect(authorize).not.toHaveBeenCalled();
    });
    it('works with the company Bridge off but needs its own flag (401)', async () => {
      process.env.CLIENT_AREA_BRIDGE_ENABLED = 'false';
      expect((await getSelf(`/ca7-probe/tasks/${task}`)).status).toBe(200);
      process.env.CLIENT_AREA_SELF_MODULES_ENABLED = 'false';
      expect((await getSelf(`/ca7-probe/tasks/${task}`)).status).toBe(401);
    });
    it('is 401 without a usable self access and 403 for an unavailable module', async () => {
      resolveSelfContext.mockResolvedValueOnce(null);
      expect((await getSelf(`/ca7-probe/tasks/${task}`)).status).toBe(401);
      resolveSelfContext.mockResolvedValueOnce(
        selfContext(resolveSelfMemberAccess(false, new Set())),
      );
      expect((await getSelf(`/ca7-probe/tasks/${task}`)).status).toBe(403);
      expect((await getSelf('/ca7-probe/unexposed')).status).toBe(401);
    });
  });
});
