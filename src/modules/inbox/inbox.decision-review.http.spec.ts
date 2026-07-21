import type {
  CanActivate,
  ExecutionContext,
  INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request.type';
import { PermissionsGuard } from '../permissions';
import { InboxController } from './inbox.controller';
import { InboxService } from './inbox.service';
import { ConversationOwnershipService } from './services/conversation-ownership.service';
import { InboxAgentRuntimeService } from './services/inbox-agent-runtime.service';
import { InboxChannelLifecycleService } from './services/inbox-channel-lifecycle.service';

describe('Inbox decision review HTTP contract', () => {
  let app: INestApplication;
  const review = jest.fn();

  beforeAll(async () => {
    const authGuard: CanActivate = {
      canActivate(context: ExecutionContext) {
        const httpRequest = context
          .switchToHttp()
          .getRequest<AuthenticatedRequest>();
        httpRequest.user = {
          tenantId: '00000000-0000-4000-8000-000000000001',
          workspaceId: '00000000-0000-4000-8000-000000000002',
          sub: '00000000-0000-4000-8000-000000000003',
          role: 'admin',
        } as AuthenticatedRequest['user'];
        return true;
      },
    };
    const module = await Test.createTestingModule({
      controllers: [InboxController],
      providers: [
        { provide: InboxService, useValue: {} },
        { provide: ConversationOwnershipService, useValue: {} },
        { provide: InboxAgentRuntimeService, useValue: { review } },
        { provide: InboxChannelLifecycleService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(authGuard)
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => app.close());

  it('routes analysis-only approval as an explicit empty subset', async () => {
    review.mockResolvedValueOnce({
      id: '00000000-0000-4000-8000-000000000005',
      status: 'approved',
      reviewOutcome: 'analysis_approved',
      reviewedActionKeys: [],
    });
    const conversationId = '00000000-0000-4000-8000-000000000004';
    const decisionId = '00000000-0000-4000-8000-000000000005';
    const response = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .post(
        `/inbox/conversations/${conversationId}/agent-decisions/${decisionId}/approve-analysis`,
      )
      .set('Idempotency-Key', 'decision-review:test:analysis')
      .send({})
      .expect(201);
    expect((response.body as { reviewOutcome: string }).reviewOutcome).toBe(
      'analysis_approved',
    );
    expect(review).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: '00000000-0000-4000-8000-000000000001',
        workspaceId: '00000000-0000-4000-8000-000000000002',
      }),
      conversationId,
      decisionId,
      true,
      [],
      'analysis',
      'decision-review:test:analysis',
    );
  });
});
