import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import {
  ClientAreaBridgeRegistry,
  ClientAreaBridgeRegistryModule,
} from '../../common/client-area-bridge/client-area-bridge.registry';
import { CompanyProductWriteInterceptor } from '../../common/company-products/company-product-write.interceptor';
import { OperationalContextResolver } from '../../common/context/operational-context.resolver';
import { TenantContextAuthority } from '../../common/context/tenant-context-authority.service';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { resolveMemberAccess } from '../client-area/client-area-permissions.catalog';
import type {
  ClientAreaAccessLevel,
  ClientAreaContext,
} from '../client-area/client-area.types';
import { ClientAreaAuthGuard } from '../client-area/guards/client-area.guards';
import { ClientAreaBridgeAuthenticator } from '../client-area/services/client-area-bridge-authenticator';
import { ClientAreaAuthorizationService } from '../client-area/services/client-area-authorization.service';
import { ClientAreaManagementService } from '../client-area/services/client-area-management.service';
import { ClientAreaSessionService } from '../client-area/services/client-area-session.service';
import { ClientAreaJwtStrategy } from '../client-area/strategies/client-area-jwt.strategy';
import { AgencyClient } from '../clients/entities/agency-client.entity';
import { AgencyClientCompanyProduct } from '../clients/entities/agency-client-company-product.entity';
import { AgencyClientStatus } from '../clients/enums';
import { PermissionsGuard } from '../permissions/guards/permissions.guard';
import { PermissionScopeEvaluatorService } from '../permissions/services/permission-scope-evaluator.service';
import { PlatformPermissionService } from '../permissions/services/platform-permission.service';
import { SocialPlannerService } from '../social-planner/services/social-planner.service';
import { CreativeProductionService } from '../social-creative-studio/creative-production.service';
import { SocialClientAreaScopeService } from './social-client-area-scope.service';
import { SocialClientAreaInterceptor } from './social-client-area.interceptor';
import {
  SOCIAL_CLIENT_AREA_CONTROLLERS,
  socialRoutes,
} from './social-client-area.routes.inventory';

const tenant = randomUUID(),
  workspace = randomUUID(),
  company = randomUUID(),
  client = randomUUID(),
  user = randomUUID(),
  session = randomUUID();
/** One row id the fake database answers for every table, in this company. */
const own = randomUUID(),
  alien = randomUUID(),
  foreign = randomUUID();
const clientSecret = 'ca10-client-secret-012345678901234567890';
const agencySecret = 'ca10-agency-secret-012345678901234567890';

/** Any service method resolves to a view carrying internal keys. */
const view = () => ({
  id: own,
  title: 'Post',
  createdById: user,
  tenantId: tenant,
  agencyClientId: client,
  costCents: 120,
  nested: { workspaceId: workspace, effectivePrompt: 'brand rules', ok: 1 },
});
const serviceProxy = () => {
  const methods = new Map<string | symbol, jest.Mock>();
  return new Proxy(
    {},
    {
      get: (_target, name) => {
        if (name === 'then') return undefined;
        if (!methods.has(name))
          methods.set(
            name,
            jest.fn(() => Promise.resolve(view())),
          );
        return methods.get(name);
      },
    },
  );
};
/** Every constructor dependency of the controllers, by its Nest token. */
function controllerDependencies() {
  const tokens = new Set<unknown>();
  for (const controller of SOCIAL_CLIENT_AREA_CONTROLLERS) {
    const types =
      (Reflect.getMetadata('design:paramtypes', controller) as unknown[]) ?? [];
    const injected =
      (Reflect.getMetadata('self:paramtypes', controller) as {
        index: number;
        param: unknown;
      }[]) ?? [];
    types.forEach((type, index) =>
      tokens.add(injected.find((item) => item.index === index)?.param ?? type),
    );
  }
  return [...tokens].map((provide) => ({
    provide: provide as string,
    useValue: serviceProxy(),
  }));
}

describe('CA10 Social controllers through the real HTTP bridge', () => {
  let app: INestApplication, jwt: JwtService;
  const saved = { ...process.env };
  const authorize = jest.fn(),
    authenticate = jest.fn();
  let context: ClientAreaContext;
  let productStatus = 'active';
  let planner: Record<string, jest.Mock>;
  let production: Record<string, jest.Mock>;
  const fakeQuery = jest.fn(
    (sql: string, values: [string, string, string[]]) => {
      const [t, w, ids] = values;
      if (t !== tenant || w !== workspace) return Promise.resolve([]);
      return Promise.resolve(
        ids.flatMap((id) =>
          ([own, alien, foreign] as string[]).includes(id)
            ? [
                {
                  id,
                  client,
                  company: id === foreign ? randomUUID() : company,
                  creator: id === alien ? randomUUID() : user,
                  parent: own,
                },
              ]
            : [],
        ),
      );
    },
  );

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
    ).fill({ findOne: () => Promise.resolve(null) });
    dependencies[dependencies.length - 1] = registry;
    const evaluator = Reflect.construct(
      PermissionScopeEvaluatorService,
      dependencies,
    ) as PermissionScopeEvaluatorService;
    const repositories = {
      getRepository: (entity: unknown) => ({
        findOne: () =>
          Promise.resolve(
            entity === AgencyClient
              ? {
                  id: client,
                  tenantId: tenant,
                  workspaceId: workspace,
                  status: AgencyClientStatus.Active,
                  archivedAt: null,
                  archiveStatus: 'none',
                }
              : entity === AgencyClientCompanyProduct
                ? { status: productStatus }
                : null,
          ),
      }),
    };
    const mod = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }),
        PassportModule,
        JwtModule.register({}),
        ClientAreaBridgeRegistryModule,
      ],
      controllers: SOCIAL_CLIENT_AREA_CONTROLLERS,
      providers: [
        ...controllerDependencies(),
        SocialClientAreaScopeService,
        { provide: APP_INTERCEPTOR, useClass: SocialClientAreaInterceptor },
        { provide: APP_INTERCEPTOR, useClass: CompanyProductWriteInterceptor },
        {
          provide: getDataSourceToken('agency'),
          useValue: { query: fakeQuery, manager: repositories },
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
        { provide: PlatformPermissionService, useValue: serviceProxy() },
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
    app = mod.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    await app.init();
    jwt = mod.get(JwtService);
    registry.register(mod.get(ClientAreaBridgeAuthenticator));
    planner = mod.get(SocialPlannerService);
    production = mod.get(CreativeProductionService);
  });

  const levels = (
    level: ClientAreaAccessLevel,
    toggles: { ai?: boolean; media?: boolean } = {},
  ) => {
    const modules = {
      social_planner: true,
      social_creative_studio: true,
      social_campaigns: true,
    };
    context.memberAccess = resolveMemberAccess('client_member', modules, {
      social_planner: level,
      social_creative_studio: level,
      social_campaigns: level,
    });
    context.allowAiCostActions = toggles.ai === true;
    context.allowMediaSpendActions = toggles.media === true;
  };
  beforeEach(() => {
    process.env.CLIENT_AREA_BRIDGE_ENABLED = 'true';
    productStatus = 'active';
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
      modules: { approvals: false, conversations: false },
    };
    levels('operator');
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
          if (companyContextId !== company) throw new NotFoundException();
          return Promise.resolve(context);
        },
      );
  });
  afterAll(async () => {
    if (app) await app.close();
    process.env = { ...saved };
  });

  const token = () =>
    jwt.signAsync(
      { sub: user, tenantId: tenant, sessionId: session, typ: 'client_area' },
      { secret: clientSecret, expiresIn: '5m' },
    );
  const call = async (
    verb: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
    body: object = {},
    companyId = company,
  ) =>
    request(app.getHttpServer() as Server)
      [verb](`/api${path}`)
      .set('Authorization', `Bearer ${await token()}`)
      .set('x-lyra-client-area-company', companyId)
      .set('x-tenant-id', randomUUID())
      .send(body);
  const fill = (path: string, id = own) => path.replace(/:[a-zA-Z]+/g, id);
  const batchBody = {
    contentIds: [own],
    proposalIds: [own],
    referenceIds: [own],
    connectionId: own,
  };
  const exposed = socialRoutes().filter((route) => route.exposed);
  const verb = (route: { verb: string }) =>
    route.verb.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
  const url = (route: { verb: string; path: string }) =>
    route.verb === 'GET'
      ? `${fill(route.path)}?connectionId=${own}`
      : fill(route.path);

  it('checks company, live session and Viewer mutation level on every Social opt-in', async () => {
    expect(exposed).toHaveLength(123);
    levels('viewer');
    for (const route of exposed) {
      const at = `${route.verb} ${route.path}`;
      const status = async (companyId = company) =>
        (await call(verb(route), url(route), batchBody, companyId)).status;
      expect([at, await status(randomUUID())]).toEqual([at, 404]);
      authenticate.mockRejectedValueOnce(new UnauthorizedException());
      expect([at, await status()]).toEqual([at, 401]);
      if (route.verb !== 'GET') expect([at, await status()]).toEqual([at, 403]);
    }
  });

  it('lets a Manager with both D-13 toggles through the guards on every opt-in', async () => {
    levels('manager', { ai: true, media: true });
    for (const route of exposed) {
      const at = `${route.verb} ${route.path}`;
      const { status } = await call(verb(route), url(route), batchBody);
      expect([at, [401, 403, 404].includes(status)]).toEqual([at, false]);
    }
  });

  it('keeps unexposed routes and a disabled bridge at 401', async () => {
    levels('manager', { ai: true, media: true });
    expect(
      (await call('delete', `/social/planner/content/${own}`)).status,
    ).toBe(401);
    expect(
      (
        await call(
          'post',
          `/social/planner/content/${own}/revisions/${own}/send-for-approval`,
        )
      ).status,
    ).toBe(401);
    expect(
      (await call('post', `/social/campaigns/meta/boost/${own}/confirm`))
        .status,
    ).toBe(401);
    expect(
      (await call('post', `/social/creative-studio/assets/${own}/archive`))
        .status,
    ).toBe(401);
    process.env.CLIENT_AREA_BRIDGE_ENABLED = 'false';
    expect((await call('get', '/social/planner/plans')).status).toBe(401);
  });

  it('confines resources to the membership company and an Operator to their own rows', async () => {
    expect(
      (await call('get', `/social/planner/content/${foreign}`)).status,
    ).toBe(404);
    // Batches (D-CA10-BE-3 fixed): one row of another company, or one foreign row for an Operator, denies it all.
    for (const contentIds of [
      [own, foreign],
      [own, alien],
    ])
      expect(
        (
          await call('post', '/social/planner/content/batch/archive', {
            contentIds,
          })
        ).status,
      ).toBe(404);
    expect(
      (
        await call('post', '/social/planner/content/batch/archive', {
          contentIds: [own],
        })
      ).status,
    ).toBe(201);
    // A list of ids in the body: one row of another company denies the call.
    expect(
      (
        await call('put', `/social/planner/content/${own}/references/order`, {
          referenceIds: [own, foreign],
        })
      ).status,
    ).toBe(404);
    expect(
      (await call('patch', `/social/planner/content/${alien}`, { title: 'x' }))
        .status,
    ).toBe(404);
    expect(
      (await call('patch', `/social/planner/content/${own}`, { title: 'x' }))
        .status,
    ).toBe(200);
    // Body ids that are not the company's are 404 even on the Operator's row.
    expect(
      (
        await call('patch', `/social/planner/content/${own}`, {
          campaignInstanceId: foreign,
        })
      ).status,
    ).toBe(404);
    // Creating is not authorship-bound; Manager-only creation is a 403.
    expect(
      (await call('post', `/social/planner/plans/${own}/content`, {})).status,
    ).toBe(201);
    expect((await call('post', '/social/planner/plans', {})).status).toBe(403);
    levels('manager');
    expect(
      (await call('patch', `/social/planner/content/${alien}`, { title: 'x' }))
        .status,
    ).toBe(200);
    const [scope, , actor] = planner.updateContent.mock.calls.at(-1) as [
      Record<string, unknown>,
      string,
      string,
    ];
    expect(scope).toEqual({
      tenantId: tenant,
      workspaceId: workspace,
      agencyClientId: client,
      companyContextId: company,
    });
    expect(actor).toBe(user);
  });

  it('blocks AI generation and media spend without the agency toggles (D-13)', async () => {
    levels('manager');
    const generate = await call(
      'post',
      `/social/planner/plans/${own}/generate`,
      {},
    );
    expect(generate.status).toBe(403);
    expect(generate.body).toMatchObject({
      code: 'client_area_cost_action_disabled',
    });
    const image = await call(
      'post',
      '/social/creative-studio/generations/images',
      { prompt: 'x' },
    );
    expect(image.body).toMatchObject({
      code: 'client_area_cost_action_disabled',
    });
    for (const path of [
      '/social/campaigns/meta/actions/budget/preflight',
      `/social/campaigns/meta/actions/status/${own}/confirm`,
    ]) {
      const response = await call('post', path, { connectionId: own });
      expect([path, response.status, response.body.code]).toEqual([
        path,
        403,
        'client_area_cost_action_disabled',
      ]);
    }
    // Reads and ordinary writes are not cost actions.
    expect((await call('get', `/social/planner/plans/${own}`)).status).toBe(
      200,
    );
    expect(
      (await call('patch', `/social/planner/content/${own}`, {})).status,
    ).toBe(200);
    levels('manager', { ai: true });
    expect(
      (await call('post', `/social/planner/plans/${own}/generate`, {})).status,
    ).toBe(201);
    expect(
      (
        await call('post', '/social/campaigns/meta/actions/budget/preflight', {
          connectionId: own,
        })
      ).status,
    ).toBe(403);
  });

  it('answers 409 on writes while the Social product is being removed (D-15)', async () => {
    levels('manager');
    productStatus = 'removal_scheduled';
    const write = await call('patch', `/social/planner/content/${own}`, {});
    expect(write.status).toBe(409);
    expect(write.body).toMatchObject({
      code: 'company_product_removal_scheduled',
    });
    expect((await call('get', `/social/planner/content/${own}`)).status).toBe(
      200,
    );
  });

  it('projects responses without agency-internal fields and reads Production as the client actor', async () => {
    const response = await call('get', `/social/planner/content/${own}`);
    expect(response.body).toEqual({
      id: own,
      title: 'Post',
      createdById: user,
      nested: { ok: 1 },
    });
    await call('get', `/social/creative-studio/production/${own}`);
    const [ctx] = production.view.mock.calls.at(-1) as [{ role: string }];
    expect(ctx.role).toBe('client_area_actor');
  });
});
