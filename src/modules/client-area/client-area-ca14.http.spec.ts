import { clientAreaSettingsUiPermissions } from './client-area-settings-ui-permissions';
import {
  NotFoundException,
  UnauthorizedException,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ClientAreaSettingsRegistry } from '../../common/client-area-bridge/client-area-settings.registry';
import { ClientAreaProductSettingsController } from './controllers/client-area-product-settings.controller';
import { ClientAreaSecurityController } from './controllers/client-area-security.controller';
import { ClientAreaSettingsRequestsController } from './controllers/client-area-settings-requests.controller';
import { ClientAreaSettingsRequestsRegistry } from './client-area-settings-requests.registry';
import type { ClientAreaContext } from './client-area.types';
import { ClientAreaJwtStrategy } from './strategies/client-area-jwt.strategy';
import { ClientAreaSessionService } from './services/client-area-session.service';
import { ClientAreaManagementService } from './services/client-area-management.service';
import { ClientAreaAuthorizationService } from './services/client-area-authorization.service';
import { ClientAreaSecurityService } from './services/client-area-security.service';
import { ClientAreaRateLimitService } from './services/client-area-rate-limit.service';

jest.mock('otplib', () => ({ verify: jest.fn() }));

describe('CA14 real JWT/guards/DTO HTTP (offline identity and domain fixtures)', () => {
  let app: INestApplication<Server>, jwt: JwtService;
  const secret = 'ca14-client-secret-012345678901234567890';
  const tenant = randomUUID(),
    workspace = randomUUID(),
    company = randomUUID(),
    client = randomUUID(),
    user = randomUUID(),
    session = randomUUID();
  let role: 'client_owner' | 'client_member' = 'client_owner',
    live = true,
    inbox = true;
  const limits = new ClientAreaRateLimitService();
  const registry = new ClientAreaSettingsRegistry(),
    requests = new ClientAreaSettingsRequestsRegistry();
  const domain = jest.fn().mockResolvedValue({ success: true });
  const security = {
    sendEmailCode: jest.fn().mockResolvedValue({ success: true }),
    changePassword: jest.fn().mockResolvedValue({ success: true }),
    get: jest.fn().mockResolvedValue({ twoFactorEnabled: false }),
  };
  const requestPublisher = jest.fn().mockResolvedValue({
    requestId: randomUUID(),
    conversationId: randomUUID(),
  });
  const context = (): ClientAreaContext => ({
    surface: 'client_area',
    tenantId: tenant,
    workspaceId: workspace,
    agencyClientId: client,
    companyContextId: company,
    userId: user,
    sessionId: session,
    membershipId: randomUUID(),
    companyDisplayName: 'Company',
    role,
    accountRole: role,
    permissions: new Set(),
    modules: {
      approvals: true,
      conversations: true,
      settings: true,
      leadflow_inbox: inbox,
      leadflow_agents: true,
      social_planner: true,
      social_creative_studio: true,
      social_campaigns: true,
    },
  });
  beforeAll(async () => {
    for (const key of [
      'business.get',
      'business.update',
      'business.publish',
      'business.modes',
      'integrations.list',
      'integrations.connect',
      'integrations.select',
      'integrations.session',
      'integrations.disconnect',
      'integrations.whatsapp.complete',
    ])
      registry.register(key, domain);
    requests.register(requestPublisher);
    const mod = await Test.createTestingModule({
      imports: [JwtModule.register({}), PassportModule],
      controllers: [
        ClientAreaProductSettingsController,
        ClientAreaSecurityController,
        ClientAreaSettingsRequestsController,
      ],
      providers: [
        ClientAreaJwtStrategy,
        {
          provide: ConfigService,
          useValue: new ConfigService({
            CLIENT_AREA_ENABLED: 'true',
            JWT_CLIENT_AREA_ACCESS_SECRET: secret,
          }),
        },
        {
          provide: ClientAreaSessionService,
          useValue: {
            authenticate: jest.fn(() => {
              if (!live) throw new UnauthorizedException();
              return Promise.resolve({
                tenantId: tenant,
                userId: user,
                sessionId: session,
                email: 'client@example.test',
              });
            }),
          },
        },
        {
          provide: ClientAreaManagementService,
          useValue: {
            assertIdentityAgencyEnabled: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: ClientAreaAuthorizationService,
          useValue: {
            authorize: jest.fn(
              ({ companyContextId }: { companyContextId: string }) => {
                if (companyContextId !== company) throw new NotFoundException();
                return Promise.resolve(context());
              },
            ),
          },
        },
        { provide: ClientAreaSettingsRegistry, useValue: registry },
        { provide: ClientAreaSecurityService, useValue: security },
        { provide: ClientAreaRateLimitService, useValue: limits },
        { provide: ClientAreaSettingsRequestsRegistry, useValue: requests },
      ],
    }).compile();
    app = mod.createNestApplication({ logger: false });
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
    role = 'client_owner';
    live = true;
    inbox = true;
    limits.reset();
    jest.clearAllMocks();
  });
  afterAll(async () => app.close());
  const token = () =>
    jwt.signAsync(
      { typ: 'client_area', sub: user, tenantId: tenant, sessionId: session },
      { secret, expiresIn: '5m' },
    );
  const call = async (
    method: 'get' | 'post' | 'patch',
    path: string,
    body: object = {},
  ) =>
    request(app.getHttpServer())
      [method](`/api${path}`)
      .set('Authorization', `Bearer ${await token()}`)
      .set('x-tenant-id', randomUUID())
      .set('x-user-id', randomUUID())
      .send(body);
  const base = `/client-area/companies/${company}/settings`;

  it('publishes can() action keys without making Members Owners or bypassing disabled modules', () => {
    expect(clientAreaSettingsUiPermissions(context())).toContain(
      'client_area.settings.integrations.inbox.manage',
    );
    role = 'client_member';
    const member = clientAreaSettingsUiPermissions(context());
    expect(member).toContain('client_area.settings.security.manage_self');
    expect(member).not.toContain('client_area.settings.members.manage');
    role = 'client_owner';
    inbox = false;
    expect(clientAreaSettingsUiPermissions(context())).not.toContain(
      'client_area.settings.integrations.inbox.manage',
    );
  });

  it('Member receives 403 for Business, Integrations and invitation requests', async () => {
    role = 'client_member';
    for (const path of [
      '/business',
      '/integrations/meta_ads',
      '/integrations/inbox_instagram',
    ])
      expect((await call('get', base + path)).status).toBe(403);
    expect(
      (
        await call('post', base + '/requests/invitation', {
          displayName: 'Person',
          email: 'person@example.test',
          moduleLevels: {},
        })
      ).status,
    ).toBe(403);
    expect(domain).not.toHaveBeenCalled();
    expect(requestPublisher).not.toHaveBeenCalled();
  });
  it('Owner calls use the membership grain and reject browser scope fields', async () => {
    expect((await call('get', base + '/integrations/meta_ads')).status).toBe(
      200,
    );
    expect(domain).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: tenant,
        workspaceId: workspace,
        agencyClientId: client,
        companyContextId: company,
        userId: user,
      }),
      { provider: 'meta_ads' },
    );
    expect(
      (
        await call('post', base + '/integrations/meta_ads/connect', {
          tenantId: randomUUID(),
        })
      ).status,
    ).toBe(400);
    expect(
      (await call('post', base + '/integrations/meta_ads/connect', {})).status,
    ).toBe(200);
    expect(
      (await call('get', base.replace(company, randomUUID()) + '/business'))
        .status,
    ).toBe(404);
  });
  it('live-session revocation and disabled product stop settings requests', async () => {
    live = false;
    expect((await call('get', base + '/business')).status).toBe(401);
    live = true;
    inbox = false;
    expect(
      (await call('post', base + '/integrations/inbox_instagram/connect'))
        .status,
    ).toBe(403);
    expect(domain).not.toHaveBeenCalled();
  });
  it('personal security is available to Members and only receives verified identity', async () => {
    role = 'client_member';
    const personal = await call('get', '/client-area/me/security');
    expect(personal.status).toBe(200);
    expect(personal.headers['cache-control']).toBe('private, no-store');
    const emailProof = await call(
      'post',
      '/client-area/me/security/2fa/email/send',
      {
        currentPassword: 'current-password',
      },
    );
    expect(emailProof.status).toBe(200);
    expect(emailProof.headers['cache-control']).toBe('private, no-store');
    expect(security.sendEmailCode).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: tenant,
        userId: user,
        sessionId: session,
      }),
      { currentPassword: 'current-password' },
    );
    const dto = {
      currentPassword: 'current-password',
      password: 'new-password',
      passwordConfirmation: 'new-password',
    };
    expect(
      (await call('post', '/client-area/me/security/password', dto)).status,
    ).toBe(200);
    expect(security.changePassword).toHaveBeenCalledWith(
      {
        tenantId: tenant,
        userId: user,
        sessionId: session,
        email: 'client@example.test',
      },
      dto,
    );
    expect(
      (
        await call('post', '/client-area/me/security/password', {
          ...dto,
          userId: randomUUID(),
        })
      ).status,
    ).toBe(400);
  });
  it('invitation is a request, rejects disabled/billing suggestions, and deletion accepts Members', async () => {
    const body = {
      displayName: 'Person',
      email: 'person@example.test',
      moduleLevels: { social_planner: 'viewer' },
    };
    expect(
      (await call('post', base + '/requests/invitation', body)).status,
    ).toBe(201);
    expect(requestPublisher).toHaveBeenCalledWith(
      expect.objectContaining({ companyContextId: company }),
      { ...body, kind: 'invitation_request' },
    );
    inbox = false;
    expect(
      (
        await call('post', base + '/requests/invitation', {
          ...body,
          moduleLevels: { leadflow_inbox: 'viewer' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call('post', base + '/requests/invitation', {
          ...body,
          moduleLevels: { agency_billing: 'manager' },
        })
      ).status,
    ).toBe(403);
    role = 'client_member';
    expect(
      (
        await call('post', base + '/requests/deletion', {
          reason: 'Remove my data.',
        })
      ).status,
    ).toBe(201);
  });
});
