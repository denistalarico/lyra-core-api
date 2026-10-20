import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { Readable } from 'node:stream';
import {
  NotFoundException,
  RequestMethod,
  type INestApplication,
} from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ConfigModule } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import {
  CLIENT_AREA_EXPOSED_METADATA,
  ClientAreaBridgeRegistry,
  ClientAreaBridgeRegistryModule,
} from '../../common/client-area-bridge/client-area-bridge.registry';
import { OperationalContextResolver } from '../../common/context/operational-context.resolver';
import { TenantContextAuthority } from '../../common/context/tenant-context-authority.service';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { ClientAreaJwtStrategy } from '../client-area/strategies/client-area-jwt.strategy';
import { ClientAreaAuthGuard } from '../client-area/guards/client-area.guards';
import { ClientAreaBridgeAuthenticator } from '../client-area/services/client-area-bridge-authenticator';
import { ClientAreaSessionService } from '../client-area/services/client-area-session.service';
import { ClientAreaManagementService } from '../client-area/services/client-area-management.service';
import { ClientAreaAuthorizationService } from '../client-area/services/client-area-authorization.service';
import { resolveMemberAccess } from '../client-area/client-area-permissions.catalog';
import type {
  ClientAreaAccessLevel,
  ClientAreaContext,
} from '../client-area/client-area.types';
import { PermissionsGuard } from '../permissions/guards/permissions.guard';
import { PlatformPermissionService } from '../permissions/services/platform-permission.service';
import { PermissionScopeEvaluatorService } from '../permissions/services/permission-scope-evaluator.service';
import { AgencyClient } from '../clients/entities/agency-client.entity';
import { InboxController } from '../inbox/inbox.controller';
import { InboxSettingsController } from '../inbox/inbox-settings.controller';
import { InboxMediaController } from '../inbox/inbox-media.controller';
import { WhatsAppOutboundController } from '../inbox/channels/whatsapp/whatsapp-outbound.controller';
import { InstagramOutboundController } from '../inbox/channels/instagram/instagram-outbound.controller';
import { FacebookMessengerOutboundController } from '../inbox/channels/facebook-messenger/facebook-messenger-outbound.controller';
import { CrmController } from '../crm/crm.controller';
import { AgencyContactsController } from '../agency/agency-contacts.controller';
import { LeadFlowAgendaController } from '../leadflow-agenda/leadflow-agenda.controller';
import { LeadFlowAgentsController } from '../leadflow-agents/leadflow-agents.controller';
import { LeadFlowClientAreaScopeService } from './leadflow-client-area-scope.service';
import { LeadFlowClientAreaInterceptor } from './leadflow-client-area.interceptor';
import {
  LEADFLOW_CLIENT_AREA_ROUTES,
  type LeadFlowClientRoute,
} from './leadflow-client-area.routes';

const tenant = randomUUID(),
  workspace = randomUUID(),
  company = randomUUID(),
  client = randomUUID(),
  user = randomUUID(),
  session = randomUUID();
const own = randomUUID(),
  foreign = randomUUID(),
  otherCreator = randomUUID();
const secret = 'ca11-client-secret-012345678901234567890',
  agencySecret = 'ca11-agency-secret-012345678901234567890';
const controllers = [
  InboxController,
  InboxSettingsController,
  InboxMediaController,
  WhatsAppOutboundController,
  InstagramOutboundController,
  FacebookMessengerOutboundController,
  CrmController,
  AgencyContactsController,
  LeadFlowAgendaController,
  LeadFlowAgentsController,
];
describe('CA11 actual product controllers through the real HTTP bridge', () => {
  let app: INestApplication, jwt: JwtService, level: ClientAreaAccessLevel;
  const saved = { ...process.env },
    calls: unknown[][] = [];
  const fakeService = new Proxy(
    {},
    {
      get: (_target, key) =>
        key === 'then'
          ? undefined
          : (...args: unknown[]) => {
              calls.push(args);
              if (key === 'getAuthorizedAsset')
                return Promise.resolve({
                  file: {
                    contentType: 'text/plain',
                    body: Readable.from(['fixture']),
                  },
                });
              return Promise.resolve({
                id: own,
                name: 'Fixture',
                title: 'Fixture',
                score: 42,
                metadata: { token: 'secret' },
                tenantId: tenant,
                conversation: { id: own },
                message: { id: own, externalMessageId: 'mocked' },
              });
            },
    },
  );
  beforeAll(async () => {
    Object.assign(process.env, {
      CLIENT_AREA_ENABLED: 'true',
      CLIENT_AREA_BRIDGE_ENABLED: 'true',
      JWT_CLIENT_AREA_ACCESS_SECRET: secret,
      JWT_ACCESS_SECRET: agencySecret,
    });
    const registry = new ClientAreaBridgeRegistry();
    const query = jest.fn((_sql: string, values: unknown[]) => {
      const id = values.at(-1);
      if (id === foreign || values.includes(foreign))
        return Promise.resolve([]);
      return Promise.resolve([
        {
          id,
          client,
          company,
          creator: id === otherCreator ? randomUUID() : user,
          parent: own,
          channel: own,
          external: 'recipient',
        },
      ]);
    });
    new LeadFlowClientAreaScopeService(
      { query } as unknown as DataSource,
      registry,
    ).onModuleInit();
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
    const tokens = new Set<unknown>();
    for (const controller of controllers)
      for (const token of Reflect.getMetadata(
        'design:paramtypes',
        controller,
      ) as unknown[])
        tokens.add(token);
    const mod = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }),
        PassportModule,
        JwtModule.register({}),
        ClientAreaBridgeRegistryModule,
      ],
      controllers,
      providers: [
        ...Array.from(tokens).map((provide) => ({
          provide: provide as never,
          useValue: fakeService,
        })),
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
        {
          provide: ClientAreaSessionService,
          useValue: {
            authenticate: () =>
              Promise.resolve({
                tenantId: tenant,
                userId: user,
                sessionId: session,
                email: 'fixture@example.test',
              }),
          },
        },
        {
          provide: ClientAreaManagementService,
          useValue: {
            assertIdentityAgencyEnabled: () =>
              Promise.resolve({ enabled: true }),
          },
        },
        {
          provide: ClientAreaAuthorizationService,
          useValue: {
            authorize: ({
              companyContextId,
            }: {
              companyContextId: unknown;
            }) => {
              if (companyContextId !== company) throw new NotFoundException();
              const modules = {
                approvals: false,
                conversations: false,
                leadflow_inbox: true,
                leadflow_crm: true,
                leadflow_appointments: true,
                leadflow_agents: true,
              };
              return Promise.resolve({
                surface: 'client_area',
                tenantId: tenant,
                workspaceId: workspace,
                agencyClientId: client,
                companyContextId: company,
                companyDisplayName: 'Fixture company',
                userId: user,
                sessionId: session,
                membershipId: randomUUID(),
                role: 'client_member',
                modules,
                permissions: new Set(),
                memberAccess: resolveMemberAccess('client_member', modules, {
                  leadflow_inbox: level,
                  leadflow_crm: level,
                  leadflow_appointments: level,
                  leadflow_agents: level,
                }),
              } as ClientAreaContext);
            },
          },
        },
        {
          provide: PlatformPermissionService,
          useValue: { assertCan: jest.fn() },
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
      ],
    })
      .overrideProvider(ClientAreaBridgeRegistry)
      .useValue(registry)
      .compile();
    registry.register(mod.get(ClientAreaBridgeAuthenticator));
    app = mod.createNestApplication();
    app.useGlobalInterceptors(new LeadFlowClientAreaInterceptor());
    await app.init();
    jwt = mod.get(JwtService);
  });
  afterAll(async () => {
    await app?.close();
    for (const key of Object.keys(process.env))
      if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  });
  beforeEach(() => {
    level = 'manager';
    calls.length = 0;
    process.env.CLIENT_AREA_BRIDGE_ENABLED = 'true';
  });
  it('keeps every actual LeadFlow opt-in equal to the closed method/template/module contract', () => {
    const actual: string[] = [];
    for (const controller of controllers)
      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        const method: unknown = Object.getOwnPropertyDescriptor(
          controller.prototype,
          name,
        )?.value;
        if (typeof method !== 'function') continue;
        const module = Reflect.getMetadata(
          CLIENT_AREA_EXPOSED_METADATA,
          method,
        ) as string | undefined;
        if (!module?.startsWith('leadflow_')) continue;
        const base = Reflect.getMetadata(PATH_METADATA, controller) as string;
        const leaf = Reflect.getMetadata(PATH_METADATA, method) as string;
        const path = `/${base}/${leaf}`.replace(/\/+/g, '/').replace(/\/$/, '');
        const verb =
          RequestMethod[
            Reflect.getMetadata(METHOD_METADATA, method) as RequestMethod
          ];
        actual.push(`${verb} ${path} ${module}`);
      }
    expect(actual.sort()).toEqual(
      LEADFLOW_CLIENT_AREA_ROUTES.map(
        (r) => `${r.method} ${r.path} ${r.module}`,
      ).sort(),
    );
  });
  const call = (
    route: LeadFlowClientRoute,
    companyId = company,
    id = own,
    body: Record<string, unknown> = {},
  ) => {
    const path = route.path.replace(/:[a-zA-Z]+/g, id);
    const req = request(app.getHttpServer() as Server)
      [route.method.toLowerCase() as 'get' | 'post' | 'patch'](path)
      .set(
        'Authorization',
        `Bearer ${jwt.sign({ sub: user, tenantId: tenant, sessionId: session, typ: 'client_area' }, { secret })}`,
      )
      .set('x-lyra-client-area-company', companyId)
      .set('x-tenant-id', randomUUID())
      .set('x-user-id', randomUUID());
    if (route.kind === 'outbound') {
      if (route.path.endsWith('send-media'))
        return req
          .query({ channelId: own, conversationId: id, to: 'recipient' })
          .field('channelId', own)
          .field('conversationId', id)
          .field('to', 'recipient')
          .attach('file', Buffer.from('fixture'), 'fixture.txt');
      return req.send({
        channelId: own,
        conversationId: id,
        to: 'recipient',
        text: 'mock',
        ...body,
      });
    }
    return route.method === 'GET' ? req : req.send(body);
  };
  it.each(
    LEADFLOW_CLIENT_AREA_ROUTES.map(
      (route) => [`${route.method} ${route.path}`, route] as const,
    ),
  )('forces company membership on %s', async (_name, route) => {
    await call(route, foreign).expect(404);
    expect(calls).toHaveLength(0);
    const response = await call(route);
    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(300);
    if (route.kind !== 'media')
      expect(JSON.stringify(response.body)).not.toMatch(
        /tenantId|workspaceId|secret|accessTokenEncrypted/,
      );
    if (route.path === '/crm/loss-reasons') {
      expect(calls).toHaveLength(0);
      return;
    }
    if (route.path.endsWith('/lead-score')) {
      expect(calls[0]?.[0]).toEqual({
        tenantId: tenant,
        workspaceId: workspace,
      });
      return;
    }
    const input = calls[0]?.[0] as { ctx?: unknown };
    const ctx = (route.kind === 'outbound' ? input.ctx : input) as {
      userId: string;
      managedContext: { companyContextId: string };
    };
    expect(ctx.userId).toBe(user);
    expect(ctx.managedContext.companyContextId).toBe(company);
  });
  it.each(
    LEADFLOW_CLIENT_AREA_ROUTES.filter((route) =>
      route.path.includes('/:'),
    ).map((route) => [`${route.method} ${route.path}`, route] as const),
  )('returns 404 for another company resource on %s', async (_name, route) => {
    await call(route, company, foreign).expect(404);
    expect(calls).toHaveLength(0);
  });
  it('denies viewer writes, operator items owned by others, and routes without exposure', async () => {
    const patch = LEADFLOW_CLIENT_AREA_ROUTES.find(
      (route) =>
        route.path === '/crm/opportunities/:id' && route.method === 'PATCH',
    )!;
    level = 'viewer';
    await call(patch).expect(403);
    level = 'operator';
    await call(patch, company, otherCreator).expect(404);
    await call(patch).expect(200);
    await request(app.getHttpServer() as Server)
      .get('/inbox/forward-targets')
      .set(
        'Authorization',
        `Bearer ${jwt.sign({ sub: user, tenantId: tenant, sessionId: session, typ: 'client_area' }, { secret })}`,
      )
      .set('x-lyra-client-area-company', company)
      .expect(401);
    process.env.CLIENT_AREA_BRIDGE_ENABLED = 'false';
    await call(patch).expect(401);
  });
});
