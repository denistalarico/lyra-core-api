import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildClientApprovalActions,
  buildClientApprovalComment,
  buildClientApprovalHistory,
  buildClientApprovalListItem,
  buildClientApprovalPreview,
  isClientApprovalMediaRef,
  toClientApprovalStatus,
} from './client-approval.view';
import type {
  SocialApprovalCommentEntity,
  SocialApprovalRequestEntity,
  SocialApprovalStageDecisionEntity,
} from '../entities';

/**
 * AP3 §66 — the client projection must not leak internal fields.
 *
 * The test builds a *fully populated* approval, so every internal column has
 * a distinctive value that would be caught if it ever reached the output. A
 * projection written by construction passes this trivially; a projection that
 * ever regresses to `{ ...approval }` fails immediately.
 */

const INTERNAL_KEYS = [
  'tenantId',
  'workspaceId',
  'agencyClientId',
  'companyContextId',
  'subjectId',
  'subjectRevisionId',
  'sourceModule',
  'requestedByUserId',
  'requestedAt',
  'currentStage',
  'internalFirstViewedAt',
  'internalLastViewedAt',
  'internalViewedByUserId',
  'clientViewedByUserId',
  'subjectVersionLabel',
  'storagePath',
  'contentPath',
  'thumbnailPath',
  'mediaAssetId',
  'thumbnailMediaAssetId',
  'actorUserId',
  'actorType',
  'stage',
  'visibility',
  'approvalRequestId',
  'commentId',
] as const;

/** Every leaf key of an arbitrarily nested projection. */
function deepKeys(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) deepKeys(item, found);
    return found;
  }
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      found.add(key);
      deepKeys(nested, found);
    }
  }
  return found;
}

/** Every string leaf, so id-shaped values can be hunted too. */
function deepStrings(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) deepStrings(item, found);
    return found;
  }
  if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) deepStrings(nested, found);
    return found;
  }
  if (typeof value === 'string') found.push(value);
  return found;
}

const approval = {
  id: 'approval-1',
  tenantId: 'TENANT-SECRET',
  workspaceId: 'WORKSPACE-SECRET',
  agencyClientId: 'AGENCYCLIENT-SECRET',
  companyContextId: 'COMPANY-SECRET',
  subjectType: 'creative_version',
  subjectId: 'SUBJECT-SECRET',
  subjectRevisionId: 'REVISION-SECRET',
  sourceModule: 'creative_studio',
  displayType: 'creative',
  title: 'Post de lançamento',
  subjectVersionLabel: 'v3',
  status: 'awaiting_client',
  currentStage: 'client',
  requestedByUserId: 'REQUESTER-SECRET',
  requestedAt: new Date('2026-01-01T10:00:00.000Z'),
  sentToClientAt: new Date('2026-01-02T10:00:00.000Z'),
  clientFirstViewedAt: new Date('2026-01-03T10:00:00.000Z'),
  clientLastViewedAt: new Date('2026-01-04T10:00:00.000Z'),
  internalFirstViewedAt: new Date('2026-01-01T11:00:00.000Z'),
  internalLastViewedAt: new Date('2026-01-01T12:00:00.000Z'),
  internalViewedByUserId: 'INTERNALVIEWER-SECRET',
  clientViewedByUserId: 'client-user-1',
  approvedAt: null,
  cancelledAt: null,
  supersededAt: null,
  createdAt: new Date('2026-01-01T09:00:00.000Z'),
  updatedAt: new Date('2026-01-04T10:00:00.000Z'),
} as unknown as SocialApprovalRequestEntity;

const clientComment = {
  id: 'comment-1',
  approvalRequestId: 'approval-1',
  stage: 'client',
  visibility: 'client',
  actorType: 'user',
  actorUserId: 'client-user-1',
  body: 'Pode ajustar o CTA?',
  createdAt: new Date('2026-01-05T10:00:00.000Z'),
} as unknown as SocialApprovalCommentEntity;

const clientDecision = {
  id: 'decision-1',
  approvalRequestId: 'approval-1',
  stage: 'client',
  decision: 'changes_requested',
  actorType: 'user',
  actorUserId: 'client-user-1',
  commentId: 'comment-1',
  createdAt: new Date('2026-01-05T10:00:00.000Z'),
} as unknown as SocialApprovalStageDecisionEntity;

describe('AP3 client approval projection contract', () => {
  it('never emits internal keys from the list projection', () => {
    const keys = deepKeys(
      buildClientApprovalListItem(approval, [clientComment]),
    );
    for (const forbidden of INTERNAL_KEYS) {
      expect(keys.has(forbidden)).toBe(false);
    }
  });

  it('never emits internal identifier values anywhere in a full detail shape', () => {
    const detail = {
      ...buildClientApprovalListItem(approval, [clientComment]),
      preview: buildClientApprovalPreview({
        subjectType: 'creative_version',
        title: 'Post de lançamento',
        versionLabel: 'v3',
        format: 'media',
        media: {
          assetType: 'image',
          contentPath:
            '/social/creative-studio/assets/SUBJECT-SECRET/content?versionId=REVISION-SECRET',
          thumbnailPath:
            '/social/creative-studio/assets/SUBJECT-SECRET/thumbnail?versionId=REVISION-SECRET',
        },
      }),
      comments: [
        buildClientApprovalComment(
          clientComment,
          { name: 'João da Silva', side: 'client' },
          'client-user-1',
        ),
      ],
      history: buildClientApprovalHistory(
        approval,
        [clientDecision],
        [clientComment],
        () => 'João da Silva',
      ),
      actions: buildClientApprovalActions(approval, {
        comment: true,
        decide: true,
      }),
    };

    const strings = deepStrings(detail).join('\n');
    for (const secret of [
      'TENANT-SECRET',
      'WORKSPACE-SECRET',
      'AGENCYCLIENT-SECRET',
      'COMPANY-SECRET',
      'SUBJECT-SECRET',
      'REVISION-SECRET',
      'REQUESTER-SECRET',
      'INTERNALVIEWER-SECRET',
    ]) {
      expect(strings).not.toContain(secret);
    }

    // The Agency route family must not survive into a client payload either.
    expect(strings).not.toContain('/social/creative-studio');
  });

  it('turns creative media into opaque refs instead of Agency paths', () => {
    const preview = buildClientApprovalPreview({
      subjectType: 'creative_version',
      title: 'Post',
      versionLabel: 'v3',
      format: 'media',
      media: {
        assetType: 'video',
        contentPath: '/social/creative-studio/assets/a/content?versionId=b',
        thumbnailPath: null,
      },
    });

    expect(preview.media).toEqual({
      assetType: 'video',
      contentRef: 'content',
      thumbnailRef: null,
    });
  });

  it('accepts only the enumerated media refs', () => {
    expect(isClientApprovalMediaRef('content')).toBe(true);
    expect(isClientApprovalMediaRef('thumbnail')).toBe(true);
    for (const forged of [
      'original',
      '../../etc/passwd',
      'private/tenant/a/asset.png',
      's3://bucket/key',
      '',
      null,
      undefined,
    ]) {
      expect(isClientApprovalMediaRef(forged)).toBe(false);
    }
  });

  it('is built by construction: the view module never spreads an entity', () => {
    const source = readFileSync(
      join(__dirname, 'client-approval.view.ts'),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    // A spread of the entity followed by deletions is the failure mode CA0
    // §AB calls out; this keeps the file honest as it grows.
    expect(source).not.toMatch(/\.\.\.approval\b/);
    expect(source).not.toMatch(/\bdelete\s+\w+\./);
  });
});

describe('AP3 client status projection', () => {
  it('maps domain statuses to the client vocabulary', () => {
    expect(toClientApprovalStatus('awaiting_client')).toBe(
      'awaiting_your_review',
    );
    expect(toClientApprovalStatus('approved')).toBe('approved');
    expect(toClientApprovalStatus('superseded')).toBe('replaced');
    expect(toClientApprovalStatus('cancelled')).toBe('withdrawn');
    expect(toClientApprovalStatus('changes_requested')).toBe('in_revision');
    // Sent, then bounced back to internal review: still "the agency has it".
    expect(toClientApprovalStatus('awaiting_internal_review')).toBe(
      'in_revision',
    );
  });

  it('never exposes a raw internal status value', () => {
    const item = buildClientApprovalListItem(approval, []);
    expect(item.status).toBe('awaiting_your_review');
    expect(Object.values(item)).not.toContain('awaiting_client');
  });
});

describe('AP4 replacement projection contract', () => {
  it('never emits replacementApprovalId unless explicitly passed', () => {
    const replaced = { ...approval, status: 'superseded' } as unknown as SocialApprovalRequestEntity;
    const withoutReplacement = buildClientApprovalListItem(replaced, []);
    expect(withoutReplacement).not.toHaveProperty('replacementApprovalId');
  });

  it('emits replacementApprovalId only for a replaced status, as an opaque id', () => {
    const replaced = { ...approval, status: 'superseded' } as unknown as SocialApprovalRequestEntity;
    const withReplacement = buildClientApprovalListItem(
      replaced,
      [],
      'replacement-approval-id',
    );
    expect(withReplacement.replacementApprovalId).toBe('replacement-approval-id');

    // A non-replaced status never carries it even if a caller passed one by
    // mistake — the projection, not the caller, is the enforcement point.
    const approved = { ...approval, status: 'approved' } as unknown as SocialApprovalRequestEntity;
    const stillNoReplacement = buildClientApprovalListItem(
      approved,
      [],
      'replacement-approval-id',
    );
    expect(stillNoReplacement).not.toHaveProperty('replacementApprovalId');
  });
});

describe('AP3 client actions availability', () => {
  it('offers actions only in awaiting_client and only with the permission', () => {
    const open = buildClientApprovalActions(approval, {
      comment: true,
      decide: true,
    });
    expect(open).toEqual({ canComment: true, canDecide: true });

    const viewer = buildClientApprovalActions(approval, {
      comment: true,
      decide: false,
    });
    expect(viewer).toEqual({ canComment: true, canDecide: false });

    for (const status of [
      'approved',
      'cancelled',
      'superseded',
      'changes_requested',
    ] as const) {
      const closed = buildClientApprovalActions(
        { ...approval, status } as SocialApprovalRequestEntity,
        { comment: true, decide: true },
      );
      expect(closed).toEqual({ canComment: false, canDecide: false });
    }
  });
});

describe('AP3 client history', () => {
  it('narrates only client-perceivable events, in order, without duplicating a decision reason', () => {
    const history = buildClientApprovalHistory(
      approval,
      [clientDecision],
      [clientComment],
      () => 'João da Silva',
    );

    expect(history.map((entry) => entry.kind)).toEqual([
      'sent',
      'viewed',
      'changes_requested',
    ]);
    // The comment that anchors the decision is not narrated twice.
    expect(history.filter((entry) => entry.kind === 'commented')).toHaveLength(
      0,
    );
  });

  it('narrates a standalone comment', () => {
    const standalone = {
      ...clientComment,
      id: 'comment-2',
      createdAt: new Date('2026-01-06T10:00:00.000Z'),
    } as SocialApprovalCommentEntity;

    const history = buildClientApprovalHistory(
      approval,
      [],
      [standalone],
      () => 'João da Silva',
    );

    expect(history.map((entry) => entry.kind)).toEqual([
      'sent',
      'viewed',
      'commented',
    ]);
  });
});
