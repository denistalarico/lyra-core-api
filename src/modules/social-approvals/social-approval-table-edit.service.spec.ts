import 'reflect-metadata';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { SocialContentItemEntity } from '../social-planner/entities';
import { buildTablePayloads } from './approval-content-snapshots';
import {
  SocialApprovalPieceEntity,
  SocialApprovalSnapshotEntity,
  SocialApprovalStepEntity,
} from './entities';
import { hashSnapshotPayload } from './social-approval-pieces.service';
import { SocialApprovalTableEditService } from './social-approval-table-edit.service';

jest.mock('./approval-content-snapshots', () => ({
  ...jest.requireActual('./approval-content-snapshots'),
  buildTablePayloads: jest.fn(),
}));

const build = buildTablePayloads as jest.MockedFunction<
  typeof buildTablePayloads
>;
const scope = {
  tenantId: 't',
  workspaceId: 'w',
  agencyClientId: 'c',
  companyContextId: 'cc',
} as never;
const columns = [{ key: 'title', label: 'Título' }];
const picture = (title: string) => ({ columns, rows: [{ title }] });

function setup(reviewedTitle = 'Post A') {
  const item = {
    id: 'item-1',
    title: 'Post A',
    objective: null,
    theme: null,
    keyMessage: null,
  } as Record<string, unknown>;
  const saved: unknown[] = [];
  const repositories = new Map<unknown, Record<string, jest.Mock>>([
    [
      SocialApprovalStepEntity,
      {
        findOneOrFail: jest
          .fn()
          .mockResolvedValue({ id: 'step', pieceId: 'piece' }),
      },
    ],
    [
      SocialApprovalPieceEntity,
      {
        findOneOrFail: jest.fn().mockResolvedValue({
          id: 'piece',
          kind: 'plan_table',
          sourceId: 'plan',
        }),
      },
    ],
    [
      SocialApprovalSnapshotEntity,
      {
        findOneOrFail: jest.fn().mockResolvedValue({
          contentHash: hashSnapshotPayload(picture(reviewedTitle)),
        }),
      },
    ],
    [
      SocialContentItemEntity,
      {
        find: jest.fn().mockResolvedValue([item]),
        save: jest.fn(async (rows: unknown[]) => saved.push(...rows)),
      },
    ],
  ]);
  const manager = {
    getRepository: (entity: unknown) => repositories.get(entity),
  };
  build.mockImplementation(async (_manager, _sources, ids) => {
    ids?.set('table', ['item-1']);
    return new Map([['table', picture(String(item.title))]]);
  });
  const approvals = {
    lockForEdit: jest.fn().mockResolvedValue({
      id: 'old',
      subjectType: 'approval_snapshot',
      displayType: 'table',
      subjectId: 'step',
      subjectRevisionId: 'snap-1',
      title: 'Plano',
    }),
    reissueAfterEditInTransaction: jest.fn().mockResolvedValue({ id: 'new' }),
  };
  const pieces = {
    createSnapshot: jest
      .fn()
      .mockResolvedValue({ id: 'snap-2', revisionNumber: 2 }),
  };
  const authority = { assertInternalDecider: jest.fn() };
  const service = new SocialApprovalTableEditService(
    { transaction: (run: (m: unknown) => unknown) => run(manager) } as never,
    approvals as never,
    pieces as never,
    { get: jest.fn().mockResolvedValue({}) } as never,
    authority as never,
  );
  return { service, approvals, pieces, authority, saved, item };
}

describe('SocialApprovalTableEditService', () => {
  it('writes the edit on the Planner item and reissues the request as a new version', async () => {
    const { service, approvals, pieces, authority, saved, item } = setup();
    const result = await service.edit(
      scope,
      'old',
      { rows: [{ index: 0, title: ' Post B ' }] },
      { userId: 'u', role: 'manager' },
    );
    expect(authority.assertInternalDecider).toHaveBeenCalled();
    expect(approvals.lockForEdit).toHaveBeenCalledWith(
      expect.anything(),
      scope,
      'old',
      'awaiting_internal_review',
    );
    expect(saved).toEqual([item]);
    expect(item.title).toBe('Post B');
    expect(item.updatedById).toBe('u');
    expect(pieces.createSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'step' }),
      'table',
      picture('Post B'),
      { type: 'user', userId: 'u' },
      'agency',
    );
    expect(approvals.reissueAfterEditInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      scope,
      { type: 'user', userId: 'u' },
      expect.objectContaining({ id: 'old' }),
      expect.objectContaining({
        subjectRevisionId: 'snap-2',
        displayType: 'table',
        subjectVersionLabel: 'r2',
      }),
      expect.any(Array),
      'agency',
      null,
    );
    expect(result).toEqual({ approvalId: 'new', changed: true });
  });

  it('keeps the request when nothing changed', async () => {
    const { service, approvals } = setup();
    await expect(
      service.edit(
        scope,
        'old',
        { rows: [{ index: 0, title: 'Post A' }] },
        { userId: 'u' },
      ),
    ).resolves.toEqual({ approvalId: 'old', changed: false });
    expect(approvals.reissueAfterEditInTransaction).not.toHaveBeenCalled();
  });

  it('refuses when the Planner table no longer is the picture under review', async () => {
    const { service } = setup('Outro título');
    await expect(
      service.edit(
        scope,
        'old',
        { rows: [{ index: 0, title: 'X' }] },
        { userId: 'u' },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses an empty title and an unknown row', async () => {
    const { service } = setup();
    await expect(
      service.edit(
        scope,
        'old',
        { rows: [{ index: 0, title: '  ' }] },
        { userId: 'u' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.edit(
        scope,
        'old',
        { rows: [{ index: 3, title: 'X' }] },
        { userId: 'u' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
