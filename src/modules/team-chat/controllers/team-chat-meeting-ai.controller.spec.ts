import { Test } from '@nestjs/testing';
import {
  UnauthorizedException,
  ValidationPipe,
  type ExecutionContext,
  type INestApplication,
} from '@nestjs/common';
import request from 'supertest';
import { Readable } from 'node:stream';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../permissions';
import { PERMISSION_KEY_METADATA } from '../../permissions/decorators/permissions.decorators';
import { TeamChatMeetingAiController } from './team-chat-meeting-ai.controller';
import { TeamChatMeetingAiService } from '../services/team-chat-meeting-ai.service';
import { TeamChatPublicMeetingsController } from './team-chat-public-meetings.controller';
import { TeamChatMeetingsService } from '../services/team-chat-meetings.service';

describe('Meeting AI HTTP scope and file contracts (auth/permission/service boundaries scripted)', () => {
  let app: INestApplication;
  const id = '00000000-0000-4000-8000-000000000001';
  const actor = {
    sub: 'actor',
    tenantId: 'tenant',
    workspaceId: 'workspace' as string | undefined,
    role: 'owner',
  };
  const context = {
    tenantId: 'tenant',
    workspaceId: 'workspace',
    userId: 'actor',
    role: 'owner',
  };
  const analysis = {
    availability: jest.fn(),
    getSettings: jest.fn(),
    saveSettings: jest.fn(),
    request: jest.fn(),
    detail: jest.fn(),
    download: jest.fn(),
  };
  const meetings = { joinPublic: jest.fn() };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [
        TeamChatMeetingAiController,
        TeamChatPublicMeetingsController,
      ],
      providers: [
        { provide: TeamChatMeetingAiService, useValue: analysis },
        { provide: TeamChatMeetingsService, useValue: meetings },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(ctx: ExecutionContext) {
          const req = ctx.switchToHttp().getRequest();
          if (!req.headers.authorization) throw new UnauthorizedException();
          req.user = actor;
          return true;
        },
      })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    actor.workspaceId = 'workspace';
  });
  afterAll(async () => {
    await app.close();
  });
  it('ignores spoofed identity/financial scope headers on analysis and settings', async () => {
    analysis.request.mockResolvedValue({ id: 'summary', stage: 'starting' });
    await request(app.getHttpServer())
      .post(`/agency/team-chat/meetings/${id}/analysis`)
      .set('Authorization', 'Bearer fixture')
      .set('x-tenant-id', 'victim')
      .set('x-workspace-id', 'victim')
      .set('x-user-id', 'victim')
      .send({})
      .expect(201);
    expect(analysis.request).toHaveBeenCalledWith(context, id);
    const config = {
      enabled: false,
      expenseAccountId: null,
      costCenterId: null,
      maxCostUsd: 2,
      maxCaptureMinutes: 90,
      retentionDays: 30,
    };
    await request(app.getHttpServer())
      .put('/agency/team-chat/meeting-ai/settings')
      .set('Authorization', 'Bearer fixture')
      .send(config)
      .expect(200);
    expect(analysis.saveSettings).toHaveBeenCalledWith(context, config);
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY_METADATA,
        TeamChatMeetingAiController.prototype.saveSettings,
      ),
    ).toBe('agency.settings.apps.manage.admin');
  });
  it('validates budget/capture/retention and fails closed without authenticated scope', async () => {
    await request(app.getHttpServer())
      .put('/agency/team-chat/meeting-ai/settings')
      .set('Authorization', 'Bearer fixture')
      .send({
        enabled: true,
        maxCostUsd: -1,
        maxCaptureMinutes: 999,
        retentionDays: 0,
      })
      .expect(400);
    expect(analysis.saveSettings).not.toHaveBeenCalled();
    actor.workspaceId = undefined;
    await request(app.getHttpServer())
      .get(`/agency/team-chat/meetings/${id}/analysis`)
      .set('Authorization', 'Bearer fixture')
      .set('x-workspace-id', 'workspace')
      .expect(403);
    await request(app.getHttpServer())
      .get(`/agency/team-chat/meetings/${id}/analysis/pdf`)
      .expect(401);
    expect(analysis.detail).not.toHaveBeenCalled();
    expect(analysis.download).not.toHaveBeenCalled();
  });
  it('streams a private PDF with download/no-store headers, without another generation', async () => {
    analysis.download.mockResolvedValue({
      body: Readable.from([Buffer.from('%PDF fixture')]),
      contentType: 'application/pdf',
    });
    const response = await request(app.getHttpServer())
      .get(`/agency/team-chat/meetings/${id}/analysis/pdf`)
      .set('Authorization', 'Bearer fixture')
      .expect(200);
    expect(response.headers['content-type']).toMatch(/application\/pdf/);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['content-disposition']).toContain(id);
    expect(analysis.download).toHaveBeenCalledWith(context, id);
    expect(analysis.request).not.toHaveBeenCalled();
  });
  it('allows anonymous guest join only on the separate public token surface', async () => {
    meetings.joinPublic.mockResolvedValue({
      meeting: { title: 'Pública' },
      livekit: { token: 'guest' },
    });
    await request(app.getHttpServer())
      .post('/public/agency/team-chat/meetings/public-slug/join')
      .send({ guestName: 'Convidado' })
      .expect(201);
    expect(meetings.joinPublic).toHaveBeenCalledWith('public-slug', {
      guestName: 'Convidado',
    });
    await request(app.getHttpServer())
      .get(`/agency/team-chat/meetings/${id}/analysis`)
      .expect(401);
  });
});
