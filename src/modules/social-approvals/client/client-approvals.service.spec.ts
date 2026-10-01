import { NotFoundException } from '@nestjs/common';
import { IsNull, Not } from 'typeorm';
import { ClientApprovalsService } from './client-approvals.service';
import type { SocialApprovalRequestEntity } from '../entities';

/**
 * AP3 — the read boundary of the Client Area approvals surface.
 *
 * These cover the two filters that make a client read safe (scope tuple and
 * the sent-to-client phase), the comment audience rule, and the author
 * display contract. The end-to-end security matrix against a real database
 * lives in `client-approvals.security-matrix.postgres.spec.ts`.
 */

const scope = {
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  agencyClientId: 'client-a',
  companyContextId: 'company-a',
};

const reader = {
  userId: 'client-user-1',
  permissions: { comment: true, decide: true },
};

function approvalRow(
  overrides: Partial<SocialApprovalRequestEntity> = {},
): SocialApprovalRequestEntity {
  return {
    id: 'approval-1',
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    agencyClientId: scope.agencyClientId,
    companyContextId: scope.companyContextId,
    subjectType: 'planner_content_revision',
    subjectId: 'item-1',
    subjectRevisionId: 'revision-1',
    sourceModule: 'social_planner',
    displayType: 'content_revision',
    title: 'Post de lançamento',
    subjectVersionLabel: 'r2',
    status: 'awaiting_client',
    currentStage: 'client',
    requestedByUserId: 'agency-user-1',
    requestedAt: new Date('2026-01-01T10:00:00.000Z'),
    sentToClientAt: new Date('2026-01-02T10:00:00.000Z'),
    clientFirstViewedAt: null,
    clientLastViewedAt: null,
    internalFirstViewedAt: null,
    internalLastViewedAt: null,
    internalViewedByUserId: null,
    clientViewedByUserId: null,
    approvedAt: null,
    cancelledAt: null,
    supersededAt: null,
    createdAt: new Date('2026-01-01T09:00:00.000Z'),
    updatedAt: new Date('2026-01-02T10:00:00.000Z'),
    ...overrides,
  } as SocialApprovalRequestEntity;
}

function build(
  overrides: {
    approvals?: SocialApprovalRequestEntity[];
    comments?: unknown[];
    decisions?: unknown[];
    memberships?: unknown[];
    profiles?: unknown[];
  } = {},
) {
  const requests = {
    find: jest.fn().mockResolvedValue(overrides.approvals ?? []),
    findOne: jest.fn().mockResolvedValue(overrides.approvals?.[0] ?? null),
  };
  const comments = {
    find: jest.fn().mockResolvedValue(overrides.comments ?? []),
  };
  const decisions = {
    find: jest.fn().mockResolvedValue(overrides.decisions ?? []),
  };
  const profiles = {
    find: jest.fn().mockResolvedValue(overrides.profiles ?? []),
  };
  const memberships = {
    find: jest.fn().mockResolvedValue(overrides.memberships ?? []),
  };
  const subjects = {
    getPreview: jest.fn().mockResolvedValue({
      subjectType: 'planner_content_revision',
      title: 'Post de lançamento',
      versionLabel: 'r2',
      format: 'text',
      text: {
        copy: 'Copy da revisão r2',
        caption: null,
        script: null,
        cta: null,
        hashtags: [],
        firstComment: null,
      },
    }),
  };

  const service = new ClientApprovalsService(
    requests as never,
    comments as never,
    decisions as never,
    profiles as never,
    memberships as never,
    subjects as never,
  );

  return {
    service,
    requests,
    comments,
    decisions,
    profiles,
    memberships,
    subjects,
  };
}

describe('AP3 visibility rule', () => {
  it('never reads an approval that was not sent to the client', async () => {
    const { service, requests } = build({ approvals: [approvalRow()] });

    await service.list(scope);

    expect(requests.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          agencyClientId: scope.agencyClientId,
          companyContextId: scope.companyContextId,
          sentToClientAt: Not(IsNull()),
        }),
      }),
    );
  });

  it('applies the same scope + phase filter to a single approval', async () => {
    const { service, requests } = build({ approvals: [approvalRow()] });

    await service.findVisible(scope, 'approval-1');

    expect(requests.findOne).toHaveBeenCalledWith({
      where: expect.objectContaining({
        tenantId: scope.tenantId,
        companyContextId: scope.companyContextId,
        sentToClientAt: Not(IsNull()),
        id: 'approval-1',
      }),
    });
  });

  it('answers a forged or out-of-company approval id with a plain not-found', async () => {
    const { service, requests } = build();
    requests.findOne.mockResolvedValue(null);

    await expect(service.findVisible(scope, 'forged')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('AP3 list ordering', () => {
  it('puts what needs the client first, then most recent activity', async () => {
    const approvals = [
      approvalRow({
        id: 'approved-old',
        status: 'approved',
        approvedAt: new Date('2026-01-03T10:00:00.000Z'),
      }),
      approvalRow({
        id: 'pending',
        status: 'awaiting_client',
        sentToClientAt: new Date('2026-01-01T10:00:00.000Z'),
      }),
      approvalRow({
        id: 'replaced-recent',
        status: 'superseded',
        supersededAt: new Date('2026-01-09T10:00:00.000Z'),
      }),
    ];
    const { service } = build({ approvals });

    const { items } = await service.list(scope);

    expect(items.map((item) => item.id)).toEqual([
      'pending',
      'replaced-recent',
      'approved-old',
    ]);
    expect(items[0].needsYou).toBe(true);
    expect(items[1].needsYou).toBe(false);
  });
});

describe('AP3 comment visibility', () => {
  const agencyInternal = {
    id: 'comment-internal',
    approvalRequestId: 'approval-1',
    stage: 'client',
    visibility: 'internal',
    actorType: 'user',
    actorUserId: 'agency-user-1',
    body: 'Nota interna: cliente costuma pedir mais cor.',
    createdAt: new Date('2026-01-03T10:00:00.000Z'),
  };
  const clientOwn = {
    id: 'comment-client',
    approvalRequestId: 'approval-1',
    stage: 'client',
    visibility: 'client',
    actorType: 'user',
    actorUserId: 'client-user-1',
    body: 'Pode ajustar o CTA?',
    createdAt: new Date('2026-01-04T10:00:00.000Z'),
  };

  it('queries only client-visible comments, never filtering by stage', async () => {
    const { service, comments, decisions } = build({
      approvals: [approvalRow()],
      comments: [clientOwn],
    });

    await service.detail(scope, 'approval-1', reader);

    // An Agency note written during `awaiting_client` also carries
    // stage='client'; the query must key on the audience column instead.
    expect(comments.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { approvalRequestId: 'approval-1', visibility: 'client' },
      }),
    );
    expect(decisions.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { approvalRequestId: 'approval-1', stage: 'client' },
      }),
    );
  });

  it('does not project an internal comment even when its stage is client', async () => {
    const { service, comments } = build({ approvals: [approvalRow()] });
    // Simulate a repository that (wrongly) returned both rows: the detail
    // must still be built only from what the audience filter allows.
    comments.find.mockResolvedValue([clientOwn]);

    const detail = await service.detail(scope, 'approval-1', reader);

    const bodies = detail.comments.map((comment) => comment.body);
    expect(bodies).toEqual(['Pode ajustar o CTA?']);
    expect(bodies).not.toContain(agencyInternal.body);
  });
});

describe('AP3 comment author display', () => {
  const clientComment = {
    id: 'c1',
    approvalRequestId: 'approval-1',
    stage: 'client',
    visibility: 'client',
    actorType: 'user',
    actorUserId: 'client-user-1',
    body: 'Do cliente',
    createdAt: new Date('2026-01-04T10:00:00.000Z'),
  };
  const agencyReply = {
    id: 'c2',
    approvalRequestId: 'approval-1',
    stage: 'client',
    visibility: 'client',
    actorType: 'user',
    actorUserId: 'agency-user-1',
    body: 'Resposta da agência',
    createdAt: new Date('2026-01-05T10:00:00.000Z'),
  };

  it('names the client member and labels the agency side without an identifier', async () => {
    const { service } = build({
      approvals: [approvalRow()],
      comments: [clientComment, agencyReply],
      memberships: [{ userId: 'client-user-1', companyContextId: 'company-a' }],
      profiles: [
        { userId: 'client-user-1', displayName: 'João da Silva' },
        { userId: 'agency-user-1', displayName: 'Operadora Interna' },
      ],
    });

    const detail = await service.detail(scope, 'approval-1', reader);

    expect(detail.comments[0].author).toEqual({
      name: 'João da Silva',
      side: 'client',
    });
    expect(detail.comments[0].mine).toBe(true);

    // An operator's real name is not shown to the customer, and neither is
    // any id: the agency speaks as a team.
    expect(detail.comments[1].author).toEqual({
      name: 'Equipe da agência',
      side: 'agency',
    });
    expect(detail.comments[1].mine).toBe(false);
    expect(JSON.stringify(detail)).not.toContain('Operadora Interna');
    expect(JSON.stringify(detail)).not.toContain('agency-user-1');
  });

  it('keeps the name of a member who has since lost access', async () => {
    const { service } = build({
      approvals: [approvalRow()],
      comments: [clientComment],
      memberships: [
        // Row exists with status 'revoked'; authorship is historical.
        {
          userId: 'client-user-1',
          companyContextId: 'company-a',
          status: 'revoked',
        },
      ],
      profiles: [{ userId: 'client-user-1', displayName: 'João da Silva' }],
    });

    const detail = await service.detail(scope, 'approval-1', reader);

    expect(detail.comments[0].author.name).toBe('João da Silva');
  });
});

describe('AP3 immutable preview', () => {
  it('always previews the revision recorded on the approval, not the current item', async () => {
    const approval = approvalRow({
      subjectId: 'item-1',
      subjectRevisionId: 'revision-1',
    });
    const { service, subjects } = build({ approvals: [approval] });

    await service.preview(scope, 'approval-1');

    expect(subjects.getPreview).toHaveBeenCalledWith(
      scope,
      expect.objectContaining({
        subjectId: 'item-1',
        subjectRevisionId: 'revision-1',
        subjectVersionLabel: 'r2',
      }),
    );
  });
});

/**
 * AP4 §13–§21 — replacement resolution surfaced through the client service.
 * The resolver's own matrix lives in `resolve-replacement-approval.spec.ts`;
 * this covers wiring: when the service looks it up, and that it never
 * surfaces for a status other than `replaced`.
 */
describe('AP4 replacement wiring', () => {
  function buildWithReplacement(
    superseded: SocialApprovalRequestEntity,
    replacement: SocialApprovalRequestEntity | null,
  ) {
    const requests = {
      // First call: `findVisible` resolving the superseded approval itself.
      // Second call: `resolveReplacementApproval`'s lookup.
      findOne: jest
        .fn()
        .mockResolvedValueOnce(superseded)
        .mockResolvedValueOnce(replacement),
      find: jest.fn().mockResolvedValue([superseded]),
    };
    const comments = { find: jest.fn().mockResolvedValue([]) };
    const decisions = { find: jest.fn().mockResolvedValue([]) };
    const profiles = { find: jest.fn().mockResolvedValue([]) };
    const memberships = { find: jest.fn().mockResolvedValue([]) };
    const subjects = {
      getPreview: jest.fn().mockResolvedValue({
        subjectType: 'planner_content_revision',
        title: 'Post',
        versionLabel: 'r1',
        format: 'text',
        text: { copy: null, caption: null, script: null, cta: null, hashtags: [], firstComment: null },
      }),
    };
    const service = new ClientApprovalsService(
      requests as never,
      comments as never,
      decisions as never,
      profiles as never,
      memberships as never,
      subjects as never,
    );
    return { service, requests };
  }

  it('includes replacementApprovalId on a replaced approval detail when a client-visible replacement exists', async () => {
    const superseded = approvalRow({
      id: 'approval-1',
      status: 'superseded',
      subjectId: 'item-1',
      subjectRevisionId: 'revision-1',
      createdAt: new Date('2026-01-01T09:00:00.000Z'),
      supersededAt: new Date('2026-01-02T09:00:00.000Z'),
    });
    const replacement = approvalRow({
      id: 'approval-2',
      status: 'awaiting_client',
      subjectId: 'item-1',
      subjectRevisionId: 'revision-2',
      createdAt: new Date('2026-01-02T09:00:00.000Z'),
      sentToClientAt: new Date('2026-01-02T10:00:00.000Z'),
    });
    const { service } = buildWithReplacement(superseded, replacement);

    const detail = await service.detail(scope, 'approval-1', reader);

    expect(detail.status).toBe('replaced');
    expect(detail.replacementApprovalId).toBe('approval-2');
  });

  it('omits replacementApprovalId entirely when no eligible replacement exists', async () => {
    const superseded = approvalRow({
      id: 'approval-1',
      status: 'superseded',
    });
    const { service } = buildWithReplacement(superseded, null);

    const detail = await service.detail(scope, 'approval-1', reader);

    expect(detail.status).toBe('replaced');
    expect(detail).not.toHaveProperty('replacementApprovalId');
  });

  it('never looks up a replacement for a non-replaced status', async () => {
    const approval = approvalRow({ id: 'approval-1', status: 'approved' });
    const requests = {
      findOne: jest.fn().mockResolvedValue(approval),
      find: jest.fn().mockResolvedValue([approval]),
    };
    const comments = { find: jest.fn().mockResolvedValue([]) };
    const decisions = { find: jest.fn().mockResolvedValue([]) };
    const profiles = { find: jest.fn().mockResolvedValue([]) };
    const memberships = { find: jest.fn().mockResolvedValue([]) };
    const subjects = {
      getPreview: jest.fn().mockResolvedValue({
        subjectType: 'planner_content_revision',
        title: 'Post',
        versionLabel: 'r1',
        format: 'text',
        text: { copy: null, caption: null, script: null, cta: null, hashtags: [], firstComment: null },
      }),
    };
    const service = new ClientApprovalsService(
      requests as never,
      comments as never,
      decisions as never,
      profiles as never,
      memberships as never,
      subjects as never,
    );

    await service.detail(scope, 'approval-1', reader);

    // Only the one lookup for `findVisible`; no second `findOne` for a
    // replacement that a non-`replaced` status could never offer.
    expect(requests.findOne).toHaveBeenCalledTimes(1);
  });
});
