import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { EntityMetadataNotFoundError } from 'typeorm';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { InboxChannelsController } from '../../inbox/channels/inbox-channels.controller';
import { InboundMessageIngestionService } from '../../inbox/channels/services/inbound-message-ingestion.service';
import { InboxChannelEntity } from '../../inbox/entities/inbox-channel.entity';
import { InboxConversationEntity } from '../../inbox/entities/inbox-conversation.entity';
import { InboxMediaAssetEntity } from '../../inbox/entities/inbox-media-asset.entity';
import { InboxController } from '../../inbox/inbox.controller';
import { InboxService } from '../../inbox/inbox.service';
import { InboxAgentRuntimeService } from '../../inbox/services/inbox-agent-runtime.service';
import { InboxChannelLifecycleService } from '../../inbox/services/inbox-channel-lifecycle.service';
import { AgentActivationPolicyService } from '../../inbox/services/agent-activation-policy.service';
import { ConversationOwnershipService } from '../../inbox/services/conversation-ownership.service';
import { PlatformRoleKey } from '../enums/permission.enums';
import { PERMISSION_KEY_METADATA } from '../decorators/permissions.decorators';
import { PermissionsGuard } from '../guards/permissions.guard';
import { PermissionsModule } from '../permissions.module';
import { PermissionScopeEvaluatorService } from './permission-scope-evaluator.service';

const AGENCY_CONNECTION = 'agency';
const CHANNEL_ID = '11111111-1111-4111-8111-111111111111';

function repositoryMock() {
  return { findOne: jest.fn().mockResolvedValue(null) };
}

function httpServer(
  application: INestApplication,
): Parameters<typeof request>[0] {
  return application.getHttpServer() as Parameters<typeof request>[0];
}

function repositoryTokens(): string[] {
  const dependencies =
    (Reflect.getMetadata('self:paramtypes', PermissionScopeEvaluatorService) as
      | Array<{ index: number; param: string }>
      | undefined) ?? [];

  return [...new Set(dependencies.map(({ param }) => param))];
}

function typeOrmModuleRepositoryTokens(): string[] {
  const imports =
    (Reflect.getMetadata('imports', PermissionsModule) as
      | Array<{ providers?: Array<{ provide?: string }> }>
      | undefined) ?? [];

  return imports.flatMap(({ providers = [] }) =>
    providers
      .map(({ provide }) => provide)
      .filter((token): token is string => typeof token === 'string'),
  );
}

describe('PermissionScopeEvaluatorService datasource wiring', () => {
  const defaultChannelToken = getRepositoryToken(InboxChannelEntity);
  const agencyChannelToken = getRepositoryToken(
    InboxChannelEntity,
    AGENCY_CONNECTION,
  );
  const defaultConversationToken = getRepositoryToken(InboxConversationEntity);
  const agencyConversationToken = getRepositoryToken(
    InboxConversationEntity,
    AGENCY_CONNECTION,
  );
  const defaultMediaToken = getRepositoryToken(InboxMediaAssetEntity);
  const agencyMediaToken = getRepositoryToken(
    InboxMediaAssetEntity,
    AGENCY_CONNECTION,
  );

  it('injects Inbox repositories exclusively from the agency datasource', () => {
    const tokens = repositoryTokens();

    expect(tokens).toEqual(
      expect.arrayContaining([
        agencyChannelToken,
        agencyConversationToken,
        agencyMediaToken,
      ]),
    );
    expect(tokens).not.toEqual(
      expect.arrayContaining([
        defaultChannelToken,
        defaultConversationToken,
        defaultMediaToken,
      ]),
    );
  });

  it('registers Inbox repositories exclusively in the agency TypeORM feature', () => {
    const tokens = typeOrmModuleRepositoryTokens();

    expect(tokens).toEqual(
      expect.arrayContaining([
        agencyChannelToken,
        agencyConversationToken,
        agencyMediaToken,
      ]),
    );
    expect(tokens).not.toEqual(
      expect.arrayContaining([
        defaultChannelToken,
        defaultConversationToken,
        defaultMediaToken,
      ]),
    );
  });
});

describe('Inbox channel permission scope HTTP integration', () => {
  let app: INestApplication;
  const agencyChannelRepository = repositoryMock();
  const defaultChannelRepository = {
    findOne: jest
      .fn()
      .mockRejectedValue(new EntityMetadataNotFoundError(InboxChannelEntity)),
  };
  const inboxService = {
    patchChannel: jest.fn().mockResolvedValue({
      id: CHANNEL_ID,
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      name: 'Updated channel',
      hasAccessToken: true,
    }),
  };
  const inboundIngestionService = {
    ingest: jest.fn().mockResolvedValue({
      conversation: { id: 'conversation-1' },
      message: { id: 'message-1' },
    }),
  };
  const metaProvider = { send: jest.fn() };
  const outboundProvider = { send: jest.fn() };

  beforeAll(async () => {
    agencyChannelRepository.findOne.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(
          where.id === CHANNEL_ID &&
            where.tenantId === 'tenant-1' &&
            where.workspaceId === 'workspace-1'
            ? {
                id: CHANNEL_ID,
                tenantId: 'tenant-1',
                workspaceId: 'workspace-1',
                status: 'active',
              }
            : null,
        ),
    );

    const standardRepositoryProviders = repositoryTokens().map((token) => ({
      provide: token,
      useValue: repositoryMock(),
    }));

    const moduleRef = await Test.createTestingModule({
      controllers: [InboxController, InboxChannelsController],
      providers: [
        PermissionScopeEvaluatorService,
        ...standardRepositoryProviders,
        {
          provide: getRepositoryToken(InboxChannelEntity),
          useValue: defaultChannelRepository,
        },
        {
          provide: getRepositoryToken(InboxChannelEntity, AGENCY_CONNECTION),
          useValue: agencyChannelRepository,
        },
        { provide: InboxService, useValue: inboxService },
        { provide: ConversationOwnershipService, useValue: {} },
        { provide: InboxAgentRuntimeService, useValue: {} },
        { provide: InboxChannelLifecycleService, useValue: {} },
        { provide: AgentActivationPolicyService, useValue: {} },
        {
          provide: InboundMessageIngestionService,
          useValue: inboundIngestionService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (executionContext: ExecutionContext) => {
          const httpRequest = executionContext.switchToHttp().getRequest<{
            headers: Record<string, string | undefined>;
            user?: Record<string, unknown>;
          }>();
          httpRequest.user = {
            sub: 'user-1',
            tenantId: 'tenant-1',
            workspaceId: httpRequest.headers['x-workspace-id'] ?? 'workspace-1',
            role: PlatformRoleKey.Admin,
          };
          return true;
        },
      })
      .overrideGuard(PermissionsGuard)
      .useFactory({
        inject: [PermissionScopeEvaluatorService, Reflector],
        factory: (
          evaluator: PermissionScopeEvaluatorService,
          reflector: Reflector,
        ) => ({
          canActivate: async (executionContext: ExecutionContext) => {
            const httpRequest = executionContext.switchToHttp().getRequest<{
              body?: Record<string, unknown>;
              method: string;
              params?: Record<string, string | string[] | undefined>;
              query?: Record<string, unknown>;
              route?: { path?: string };
              user: {
                sub: string;
                tenantId: string;
                workspaceId: string;
                role: PlatformRoleKey;
              };
            }>();
            const permissionKey = reflector.get<string>(
              PERMISSION_KEY_METADATA,
              executionContext.getHandler(),
            );

            if (permissionKey) {
              await evaluator.assertScope(
                {
                  tenantId: httpRequest.user.tenantId,
                  workspaceId: httpRequest.user.workspaceId,
                  userId: httpRequest.user.sub,
                  role: httpRequest.user.role,
                },
                permissionKey,
                {
                  method: httpRequest.method,
                  routePath: httpRequest.route?.path,
                  params: httpRequest.params,
                  query: httpRequest.query,
                  body: httpRequest.body,
                },
              );
            }

            return true;
          },
        }),
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
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
    await app.close();
  });

  beforeEach(() => {
    agencyChannelRepository.findOne.mockClear();
    defaultChannelRepository.findOne.mockClear();
    inboxService.patchChannel.mockClear();
    inboundIngestionService.ingest.mockClear();
    metaProvider.send.mockClear();
    outboundProvider.send.mockClear();
  });

  it('PATCH allows an authorized channel without consulting default metadata', async () => {
    await request(httpServer(app))
      .patch(`/api/inbox/channels/${CHANNEL_ID}`)
      .send({ name: 'Updated channel' })
      .expect(200)
      .expect(({ body }) => {
        expect(body).not.toHaveProperty('accessToken');
        expect(body).not.toHaveProperty('accessTokenEncrypted');
        expect(body).not.toHaveProperty('verifyToken');
        expect(body).not.toHaveProperty('webhookSecret');
      });

    expect(defaultChannelRepository.findOne).not.toHaveBeenCalled();
    expect(agencyChannelRepository.findOne).toHaveBeenCalledWith({
      where: {
        id: CHANNEL_ID,
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
      },
    });
    expect(inboxService.patchChannel).toHaveBeenCalled();
  });

  it('PATCH denies a channel from another workspace', async () => {
    await request(httpServer(app))
      .patch(`/api/inbox/channels/${CHANNEL_ID}`)
      .set('x-workspace-id', 'workspace-2')
      .send({ name: 'Denied update' })
      .expect(403);

    expect(inboxService.patchChannel).not.toHaveBeenCalled();
  });

  it('PATCH returns a controlled denial for a missing channel', async () => {
    await request(httpServer(app))
      .patch('/api/inbox/channels/22222222-2222-4222-8222-222222222222')
      .send({ name: 'Missing channel' })
      .expect(403);

    expect(inboxService.patchChannel).not.toHaveBeenCalled();
  });

  it('PATCH rejects tenant/workspace mutation fields from the public payload', async () => {
    await request(httpServer(app))
      .patch(`/api/inbox/channels/${CHANNEL_ID}`)
      .send({ tenantId: 'tenant-2', workspaceId: 'workspace-2' })
      .expect(400);

    expect(inboxService.patchChannel).not.toHaveBeenCalled();
  });

  it('test-inbound accepts an authorized channel without outbound calls', async () => {
    await request(httpServer(app))
      .post('/api/inbox/channels/test-inbound')
      .send({
        channelId: CHANNEL_ID,
        channelType: 'whatsapp',
        externalThreadId: 'thread-1',
        sender: { externalId: 'sender-1', displayName: 'Sender' },
        messageType: 'text',
        content: 'fixture only',
      })
      .expect(201)
      .expect({
        ok: true,
        conversationId: 'conversation-1',
        messageId: 'message-1',
      });

    expect(defaultChannelRepository.findOne).not.toHaveBeenCalled();
    expect(agencyChannelRepository.findOne).toHaveBeenCalledWith({
      where: {
        id: CHANNEL_ID,
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
      },
    });
    expect(inboundIngestionService.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        channelId: CHANNEL_ID,
      }),
    );
    expect(metaProvider.send).not.toHaveBeenCalled();
    expect(outboundProvider.send).not.toHaveBeenCalled();
  });

  it('test-inbound denies a channel from another workspace without ingestion', async () => {
    await request(httpServer(app))
      .post('/api/inbox/channels/test-inbound')
      .set('x-workspace-id', 'workspace-2')
      .send({
        channelId: CHANNEL_ID,
        channelType: 'whatsapp',
        externalThreadId: 'thread-1',
        sender: { externalId: 'sender-1', displayName: 'Sender' },
        messageType: 'text',
        content: 'fixture only',
      })
      .expect(403);

    expect(inboundIngestionService.ingest).not.toHaveBeenCalled();
  });
});
