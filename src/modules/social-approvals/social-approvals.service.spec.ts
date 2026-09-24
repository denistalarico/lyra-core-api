import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  SocialApprovalCommentEntity,
  SocialApprovalRequestEntity,
} from './entities';
import { SocialApprovalsService } from './social-approvals.service';

const scope = {
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  agencyClientId: 'client-a',
  companyContextId: 'company-a',
};

function createHarness() {
  const request = {
    id: 'approval-a',
    ...scope,
    status: 'draft',
    currentStage: 'internal',
    title: 'Criativo',
    subjectVersionLabel: 'v1',
  } as unknown as SocialApprovalRequestEntity;
  const comments: Array<Record<string, unknown>> = [];
  const decisions: Array<Record<string, unknown>> = [];
  const requestRepo = {
    create: jest.fn((value) => ({ id: 'approval-a', ...value })),
    save: jest.fn(async (value) => value),
    findOne: jest.fn(async ({ where }: { where: Record<string, string> }) =>
      Object.entries(scope).every(([key, value]) => where[key] === value)
        ? request
        : null,
    ),
    createQueryBuilder: jest.fn(),
  };
  const transactionRequestRepo = {
    findOne: jest.fn(async ({ where }: { where: Record<string, string> }) =>
      Object.entries(scope).every(([key, value]) => where[key] === value)
        ? request
        : null,
    ),
    find: jest.fn(async () => []),
    create: jest.fn((value) => ({ id: 'approval-a', ...value })),
    save: jest.fn(async (value) => value),
  };
  const manager = {
    save: jest.fn(async (value: unknown) => value),
    query: jest.fn().mockResolvedValue(undefined),
    getRepository: (entity: unknown) =>
      entity === SocialApprovalRequestEntity
        ? transactionRequestRepo
        : entity === SocialApprovalCommentEntity
          ? {
              save: async (value: Record<string, unknown>) => {
                const stored = {
                  id: `comment-${comments.length + 1}`,
                  ...value,
                };
                comments.push(stored);
                return stored;
              },
            }
          : {
              save: async (value: Record<string, unknown>) => {
                const stored = {
                  id: `decision-${decisions.length + 1}`,
                  ...value,
                };
                decisions.push(stored);
                return stored;
              },
            },
  };
  const dataSource = {
    transaction: async (fn: (current: typeof manager) => Promise<unknown>) =>
      fn(manager),
  };
  const subjectResolver = {
    resolve: jest.fn(async () => ({
      subjectType: 'creative_version',
      subjectId: 'asset-a',
      subjectRevisionId: 'version-a',
      sourceModule: 'creative_studio',
      displayType: 'creative',
      title: 'Criativo',
      subjectVersionLabel: 'v1',
    })),
  };
  return {
    request,
    comments,
    decisions,
    requestRepo,
    transactionRequestRepo,
    subjectResolver,
    manager,
    service: new SocialApprovalsService(
      requestRepo as never,
      { find: jest.fn() } as never,
      { find: jest.fn() } as never,
      dataSource as never,
      subjectResolver as never,
    ),
  };
}

describe('SocialApprovalsService AP1 state machine', () => {
  it('creates a draft only after resolving an immutable revision in its company scope', async () => {
    const { service, subjectResolver } = createHarness();
    const created = await service.create(scope, 'real-user', {
      subjectType: 'creative_version',
      subjectId: 'asset-a',
      subjectRevisionId: 'version-a',
    });
    expect(subjectResolver.resolve).toHaveBeenCalledWith(
      scope,
      expect.any(Object),
    );
    expect(created).toMatchObject({
      status: 'draft',
      currentStage: 'internal',
      requestedByUserId: 'real-user',
    });
  });

  it('preserves every immutable decision through changes, resubmission, and final client approval', async () => {
    const { service, request, comments, decisions } = createHarness();
    await service.submit(scope, request.id, 'requester');
    await service.requestChanges(
      scope,
      request.id,
      'internal-reviewer',
      'Ajuste o CTA.',
    );
    await service.submit(scope, request.id, 'requester');
    await service.approveInternal(scope, request.id, 'internal-reviewer');
    expect(request).toMatchObject({
      status: 'awaiting_client',
      currentStage: 'client',
    });
    await service.clientRequestChanges(
      scope,
      request.id,
      { type: 'user', userId: 'client-user' },
      'Troque a imagem.',
    );
    await service.submit(scope, request.id, 'requester');
    await service.approveInternal(scope, request.id, 'internal-reviewer');
    await service.clientApprove(scope, request.id, {
      type: 'user',
      userId: 'client-user',
    });
    expect(request.status).toBe('approved');
    expect(comments.map((comment) => comment.body)).toEqual([
      'Ajuste o CTA.',
      'Troque a imagem.',
    ]);
    expect(
      decisions.map(({ stage, decision }) => ({ stage, decision })),
    ).toEqual([
      { stage: 'internal', decision: 'changes_requested' },
      { stage: 'internal', decision: 'approved' },
      { stage: 'client', decision: 'changes_requested' },
      { stage: 'internal', decision: 'approved' },
      { stage: 'client', decision: 'approved' },
    ]);
    expect(new Set(decisions.map((decision) => decision.id)).size).toBe(5);
  });

  it.each([
    ['internal', '   '],
    ['internal', undefined],
    ['client', '   '],
    ['client', undefined],
  ] as const)(
    'requires a non-blank %s changes comment',
    async (stage, body) => {
      const { service, request, comments, decisions } = createHarness();
      request.status =
        stage === 'internal' ? 'awaiting_internal_review' : 'awaiting_client';
      request.currentStage = stage;
      const action =
        stage === 'internal'
          ? service.requestChanges(scope, request.id, 'reviewer', body as never)
          : service.clientRequestChanges(
              scope,
              request.id,
              { type: 'user', userId: 'client-user' },
              body as never,
            );
      await expect(action).rejects.toBeInstanceOf(BadRequestException);
      expect(comments).toHaveLength(0);
      expect(decisions).toHaveLength(0);
    },
  );

  it.each([
    [
      'draft -> approved',
      'draft',
      (service: SocialApprovalsService, id: string) =>
        service.clientApprove(scope, id, {
          type: 'user',
          userId: 'client-user',
        }),
    ],
    [
      'draft -> awaiting_client',
      'draft',
      (service: SocialApprovalsService, id: string) =>
        service.approveInternal(scope, id, 'reviewer'),
    ],
    [
      'approved -> awaiting_internal_review',
      'approved',
      (service: SocialApprovalsService, id: string) =>
        service.submit(scope, id, 'requester'),
    ],
    [
      'cancelled -> submit',
      'cancelled',
      (service: SocialApprovalsService, id: string) =>
        service.submit(scope, id, 'requester'),
    ],
    [
      'superseded -> submit',
      'superseded',
      (service: SocialApprovalsService, id: string) =>
        service.submit(scope, id, 'requester'),
    ],
    [
      'approved -> changes_requested',
      'approved',
      (service: SocialApprovalsService, id: string) =>
        service.requestChanges(scope, id, 'reviewer', 'Não pode'),
    ],
  ] as const)(
    'rejects explicit invalid transition %s',
    async (_label, status, action) => {
      const { service, request } = createHarness();
      request.status = status;
      await expect(action(service, request.id)).rejects.toBeInstanceOf(
        ConflictException,
      );
    },
  );

  it('allows cancellation and manual supersede only while the workflow is active', async () => {
    for (const action of ['cancel', 'supersede'] as const) {
      const { service, request } = createHarness();
      request.status = 'awaiting_client';
      await service[action](scope, request.id, 'owner');
      expect(request.status).toBe(
        action === 'cancel' ? 'cancelled' : 'superseded',
      );
    }
  });

  it('does not let the Agency request-changes path decide the client stage', async () => {
    const { service, request, decisions } = createHarness();
    request.status = 'awaiting_client';
    request.currentStage = 'client';
    await expect(
      service.requestChanges(
        scope,
        request.id,
        'agency-user',
        'Tentativa indevida',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(decisions).toHaveLength(0);
  });

  it('records an Agency view without changing status or appending a decision', async () => {
    const { service, request, decisions } = createHarness();
    request.status = 'awaiting_client';
    await service.markAgencyViewed(scope, request.id, 'agency-user');
    expect(request).toMatchObject({
      status: 'awaiting_client',
      internalViewedByUserId: 'agency-user',
    });
    expect(decisions).toHaveLength(0);
  });

  it('preserves the first Agency view, updates the last viewer, and keeps client fields untouched', async () => {
    const { service, request, decisions } = createHarness();
    request.status = 'approved';
    const first = new Date('2026-09-23T10:00:00.000Z');
    request.internalFirstViewedAt = first;
    request.clientFirstViewedAt = new Date('2026-09-22T10:00:00.000Z');
    request.clientLastViewedAt = new Date('2026-09-22T11:00:00.000Z');
    request.clientViewedByUserId = 'client-user';

    await service.markAgencyViewed(scope, request.id, 'agency-user');

    expect(request).toMatchObject({
      status: 'approved',
      internalFirstViewedAt: first,
      internalViewedByUserId: 'agency-user',
      clientViewedByUserId: 'client-user',
    });
    expect(request.internalLastViewedAt).toBeInstanceOf(Date);
    expect(decisions).toHaveLength(0);
  });

  it('records a client view only at the client stage without a decision', async () => {
    const { service, request, decisions } = createHarness();
    request.status = 'awaiting_client';
    await service.markClientViewed(scope, request.id, 'client-user');
    expect(request).toMatchObject({
      status: 'awaiting_client',
      clientViewedByUserId: 'client-user',
    });
    expect(decisions).toHaveLength(0);
  });

  it('preserves the first client view, updates the last viewer, and never writes internal fields', async () => {
    const { service, request, decisions } = createHarness();
    request.status = 'awaiting_client';
    const first = new Date('2026-09-23T10:00:00.000Z');
    request.clientFirstViewedAt = first;
    request.internalFirstViewedAt = new Date('2026-09-22T10:00:00.000Z');
    request.internalLastViewedAt = new Date('2026-09-22T11:00:00.000Z');
    request.internalViewedByUserId = 'agency-user';

    await service.markClientViewed(scope, request.id, 'client-user-2');

    expect(request).toMatchObject({
      status: 'awaiting_client',
      clientFirstViewedAt: first,
      clientViewedByUserId: 'client-user-2',
      internalViewedByUserId: 'agency-user',
    });
    expect(request.clientLastViewedAt).toBeInstanceOf(Date);
    expect(decisions).toHaveLength(0);
  });

  it('accepts user and system actors only in the client-ready domain boundary', async () => {
    const { service, request, decisions } = createHarness();
    request.status = 'awaiting_client';
    await service.clientApprove(scope, request.id, {
      type: 'system',
      userId: null,
    });
    expect(decisions).toContainEqual(
      expect.objectContaining({
        stage: 'client',
        actorType: 'system',
        actorUserId: null,
      }),
    );
    request.status = 'awaiting_client';
    await expect(
      service.clientApprove(scope, request.id, { type: 'user', userId: null }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.clientApprove(scope, request.id, {
        type: 'system',
        userId: 'agency-client-id',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not find or mutate an approval from Company B when operating Company A', async () => {
    const { service, request, transactionRequestRepo } = createHarness();
    request.status = 'awaiting_internal_review';
    await expect(
      service.approveInternal(
        { ...scope, companyContextId: 'company-b' },
        request.id,
        'reviewer',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(transactionRequestRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyContextId: 'company-b' }),
      }),
    );
    expect(request.status).toBe('awaiting_internal_review');
  });

  it.each(['approved', 'cancelled', 'superseded'] as const)(
    'rejects a client view or decision after the workflow is %s',
    async (status) => {
      const { service, request, comments, decisions } = createHarness();
      request.status = status;
      await expect(service.markClientViewed(scope, request.id, 'client-user')).rejects.toBeInstanceOf(ConflictException);
      await expect(service.clientComment(scope, request.id, 'client-user', 'texto')).rejects.toBeInstanceOf(ConflictException);
      await expect(service.clientApprove(scope, request.id, { type: 'user', userId: 'client-user' })).rejects.toBeInstanceOf(ConflictException);
      await expect(service.clientRequestChanges(scope, request.id, { type: 'user', userId: 'client-user' }, 'texto')).rejects.toBeInstanceOf(ConflictException);
      expect(comments).toHaveLength(0);
      expect(decisions).toHaveLength(0);
    },
  );

  it('rejects missing client users and a Company B approval ID without creating client history', async () => {
    const { service, request, comments, decisions } = createHarness();
    request.status = 'awaiting_client';
    await expect(service.markClientViewed(scope, request.id, undefined)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.clientComment(scope, request.id, undefined, 'texto')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.clientApprove(scope, request.id, { type: 'user', userId: null })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.clientRequestChanges(scope, request.id, { type: 'user', userId: null }, 'texto')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.markClientViewed({ ...scope, companyContextId: 'company-b' }, request.id, 'client-user')).rejects.toBeInstanceOf(NotFoundException);
    expect(comments).toHaveLength(0);
    expect(decisions).toHaveLength(0);
  });

  it('maps active-unique DB violations to a safe conflict while a later workflow can be created', async () => {
    const { service, transactionRequestRepo } = createHarness();
    transactionRequestRepo.save.mockRejectedValueOnce({ code: '23505' });
    const input = {
      subjectType: 'creative_version',
      subjectId: 'asset-a',
      subjectRevisionId: 'version-a',
    };
    await expect(
      service.create(scope, 'requester', input),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.create(scope, 'requester', input),
    ).resolves.toMatchObject({ status: 'draft' });
  });

  it('automatically supersedes only a prior active revision of the same scoped root, preserving its history fields', async () => {
    const { service, transactionRequestRepo, manager, subjectResolver } = createHarness();
    const previous = {
      id: 'approval-r1', ...scope, subjectType: 'creative_version', subjectId: 'asset-a', subjectRevisionId: 'version-a',
      status: 'awaiting_client', comments: ['history'], decisions: ['history'], internalFirstViewedAt: new Date('2026-09-20T10:00:00.000Z'), requestedByUserId: 'requester',
    } as unknown as SocialApprovalRequestEntity;
    transactionRequestRepo.find.mockResolvedValue([previous] as never);
    subjectResolver.resolve.mockResolvedValue({
      subjectType: 'creative_version', subjectId: 'asset-a', subjectRevisionId: 'version-b', sourceModule: 'creative_studio', displayType: 'creative', title: 'Criativo', subjectVersionLabel: 'v2',
    });
    const created = await service.create(scope, 'requester', {
      subjectType: 'creative_version', subjectId: 'asset-a', subjectRevisionId: 'version-b',
    });

    expect(previous).toMatchObject({ status: 'superseded', comments: ['history'], decisions: ['history'], requestedByUserId: 'requester' });
    expect(previous.supersededAt).toBeInstanceOf(Date);
    expect(created).toMatchObject({ subjectRevisionId: 'version-b', status: 'draft' });
    expect(transactionRequestRepo.find).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ ...scope, subjectId: 'asset-a' }), lock: { mode: 'pessimistic_write' },
    }));
    expect(manager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [expect.stringContaining(':company-a:creative_version:asset-a')],
    );
  });
});
