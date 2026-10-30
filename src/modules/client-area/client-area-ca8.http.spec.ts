import type { Server } from 'node:http';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { ClientAreaPublicController } from './controllers/client-area-public.controller';
import { ClientAreaPreferencesController } from './controllers/client-area-preferences.controller';
import { ClientAreaIdentityPreferencesEntity } from './entities/client-area-identity-preferences.entity';
import { ClientAreaPublicBrandingService } from './services/client-area-public-branding.service';
import { ClientAreaRateLimitService } from './services/client-area-rate-limit.service';
import {
  ClientAreaAuthGuard,
  ClientAreaEnabledGuard,
} from './guards/client-area.guards';
import { buildCorsOptions } from '../../config/cors.config';
import {
  buildClientAreaInvitationUrl,
  buildClientAreaResetUrl,
} from './services/client-area-email.service';

jest.mock('otplib', () => ({ verify: jest.fn() }));
describe('CA8 HTTP contracts (auth identity fixture)', () => {
  let app: INestApplication<Server>;
  const limits = new ClientAreaRateLimitService();
  const publicSettings = {
    findOne: jest.fn().mockResolvedValue({
      enabled: true,
      tenantId: 'tenant',
      workspaceId: 'workspace',
      publicSlug: 'agency-test',
      customDomain: 'clients.example.test',
      domainMode: 'custom',
      domainVerificationStatus: 'verified',
      domainVerifiedAt: new Date(),
      domainVerificationToken: 'never-public',
    }),
  };
  const branding = new ClientAreaPublicBrandingService(
    publicSettings as never,
    {
      branding: jest.fn().mockResolvedValue({
        displayName: 'Agency',
        login: { layout: 'centered' },
      }),
    } as never,
    new ConfigService(),
  );
  const resolveBranding = jest.spyOn(branding, 'resolve');
  const repo = {
    findOne: jest.fn().mockResolvedValue({
      tenantId: 'private',
      userId: 'private',
      theme: 'dark',
      locale: 'es',
    }),
    upsert: jest.fn().mockResolvedValue({}),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [
        ClientAreaPublicController,
        ClientAreaPreferencesController,
      ],
      providers: [
        ClientAreaEnabledGuard,
        {
          provide: ConfigService,
          useValue: new ConfigService({
            CLIENT_AREA_ENABLED: 'true',
            JWT_CLIENT_AREA_ACCESS_SECRET: 'x'.repeat(40),
          }),
        },
        { provide: ClientAreaPublicBrandingService, useValue: branding },
        { provide: ClientAreaRateLimitService, useValue: limits },
        {
          provide: getRepositoryToken(
            ClientAreaIdentityPreferencesEntity,
            'agency',
          ),
          useValue: repo,
        },
      ],
    })
      .overrideGuard(ClientAreaAuthGuard)
      .useValue({
        canActivate: (ctx: {
          switchToHttp: () => {
            getRequest: () => { clientAreaIdentity: unknown };
          };
        }) => {
          ctx.switchToHttp().getRequest().clientAreaIdentity = {
            tenantId: 'verified-tenant',
            userId: 'verified-user',
          };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });
  it('public branding uses X-Real-IP budget, no-store, slug and observed host', async () => {
    await request(app.getHttpServer())
      .get('/client-area/public/branding?a=agency-test')
      .set('Host', 'clients.example.test')
      .set('X-Real-IP', '1.2.3.4')
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(resolveBranding).toHaveBeenCalledWith(
      'agency-test',
      'clients.example.test',
    );
    for (let i = 0; i < 59; i++) limits.consume({ branding_ip: '1.2.3.4' });
    await request(app.getHttpServer())
      .get('/client-area/public/branding?a=agency-test')
      .set('X-Real-IP', '1.2.3.4')
      .set('X-Forwarded-For', 'forged')
      .expect(429);
  });
  it('returns generic 404 for an unknown slug and accepts only a verified host selector', async () => {
    publicSettings.findOne.mockResolvedValueOnce(null);
    const missing = await request(app.getHttpServer())
      .get('/client-area/public/branding?a=missing')
      .expect(404);
    expect(JSON.stringify(missing.body)).not.toContain('never-public');
    const response = await request(app.getHttpServer())
      .get('/client-area/public/branding')
      .set('Host', 'api.example.test')
      .set('x-lyra-client-area-host', 'clients.example.test')
      .expect(200);
    expect(resolveBranding).toHaveBeenLastCalledWith(
      undefined,
      'clients.example.test',
    );
    expect(response.body).toEqual({
      branding: { displayName: 'Agency', login: { layout: 'centered' } },
    });
  });
  it('preferences project theme/locale/sidebar and use the verified identity', async () => {
    await request(app.getHttpServer())
      .get('/client-area/me/preferences')
      .set('x-user-id', 'forged')
      .expect(200)
      .expect({ theme: 'dark', locale: 'es', sidebarCollapsed: false });
    await request(app.getHttpServer())
      .patch('/client-area/me/preferences')
      .send({ theme: 'light' })
      .expect(200);
    expect(repo.upsert).toHaveBeenLastCalledWith(
      { tenantId: 'verified-tenant', userId: 'verified-user', theme: 'light' },
      ['tenantId', 'userId'],
    );
    await request(app.getHttpServer())
      .patch('/client-area/me/preferences')
      .send({ sidebarCollapsed: true })
      .expect(200);
    expect(repo.upsert).toHaveBeenLastCalledWith(
      {
        tenantId: 'verified-tenant',
        userId: 'verified-user',
        sidebarCollapsed: true,
      },
      ['tenantId', 'userId'],
    );
    await request(app.getHttpServer())
      .patch('/client-area/me/preferences')
      .send({ locale: 'invalid' })
      .expect(400);
    await request(app.getHttpServer())
      .patch('/client-area/me/preferences')
      .send({ theme: null })
      .expect(400);
    await request(app.getHttpServer())
      .patch('/client-area/me/preferences')
      .send({ tenantId: 'forged' })
      .expect(400);
  });
  it('adds dynamic verified origins to static origins and fails closed on errors', async () => {
    const dynamic = jest.fn().mockResolvedValue(true);
    const options = buildCorsOptions(
      { CORS_ORIGINS: 'https://agency.example.test', NODE_ENV: 'production' },
      dynamic,
    );
    const check = (origin: string) =>
      new Promise((resolve) =>
        (
          options.origin as (
            origin: string,
            cb: (error: Error | null, result: boolean) => void,
          ) => void
        )(origin, (_error, result) => resolve(result)),
      );
    expect(await check('https://agency.example.test')).toBe(true);
    expect(dynamic).not.toHaveBeenCalled();
    expect(await check('https://clients.example.test')).toBe(true);
    dynamic.mockRejectedValueOnce(new Error('database unavailable'));
    expect(await check('https://unknown.test')).toBe(false);
    expect(options.allowedHeaders).toContain('x-lyra-client-area-company');
  });
  it('invitation and reset links retain surface, token and branding selector', () => {
    expect(
      buildClientAreaInvitationUrl(
        'https://agency.test',
        'token',
        'agency-slug',
      ),
    ).toBe('https://agency.test/client-area/invitations/token?a=agency-slug');
    expect(
      buildClientAreaResetUrl('https://agency.test', 'token', 'agency-slug'),
    ).toBe(
      'https://agency.test/client-area/reset-password?token=token&a=agency-slug',
    );
  });
});
