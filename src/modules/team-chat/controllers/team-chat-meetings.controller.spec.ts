import type { INestApplication, ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../permissions';
import { TeamChatMeetingsController } from './team-chat-meetings.controller';
import { TeamChatMeetingsService } from '../services/team-chat-meetings.service';

/** Real HTTP parameter binding; auth/permission guards and service are fixture boundaries. */
describe('Meeting HTTP authenticated identity', () => {
  let app: INestApplication;
  const authenticated = {
    sub: 'actor-a',
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a' as string | undefined,
  };
  const service = {
    joinInternal: jest.fn(),
    endMeeting: jest.fn(),
    requestAiSummary: jest.fn(),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [TeamChatMeetingsController],
      providers: [{ provide: TeamChatMeetingsService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          context.switchToHttp().getRequest().user = authenticated;
          return true;
        },
      })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    await app.init();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    authenticated.workspaceId = 'workspace-a';
  });
  afterAll(async () => {
    await app.close();
  });

  it('ignores spoofed identity/ownership headers when joining', async () => {
    service.joinInternal.mockResolvedValue({ ok: true });
    await request(app.getHttpServer())
      .post('/agency/team-chat/meetings/meeting-a/join')
      .set('x-user-id', 'victim-b')
      .set('x-tenant-id', 'tenant-b')
      .set('x-workspace-id', 'workspace-b')
      .send({ displayName: 'Impersonation' })
      .expect(201);
    expect(service.joinInternal).toHaveBeenCalledWith(
      { tenantId: 'tenant-a', workspaceId: 'workspace-a', userId: 'actor-a' },
      'meeting-a',
      { displayName: 'Impersonation' },
    );
  });
  it('uses the same authenticated context for ending and summary requests', async () => {
    const context = {
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      userId: 'actor-a',
    };
    await request(app.getHttpServer())
      .post('/agency/team-chat/meetings/meeting-a/end')
      .set('x-workspace-id', 'workspace-b')
      .expect(201);
    expect(service.endMeeting).toHaveBeenCalledWith(context, 'meeting-a');
    await request(app.getHttpServer())
      .post('/agency/team-chat/meetings/meeting-a/ai-summary/request')
      .send({})
      .expect(201);
    expect(service.requestAiSummary).toHaveBeenCalledWith(
      context,
      'meeting-a',
      {},
    );
  });
  it('fails closed without an authenticated workspace even if supplied in a header', async () => {
    authenticated.workspaceId = undefined;
    await request(app.getHttpServer())
      .post('/agency/team-chat/meetings/meeting-a/join')
      .set('x-workspace-id', 'workspace-a')
      .send({})
      .expect(403);
    expect(service.joinInternal).not.toHaveBeenCalled();
  });
});
