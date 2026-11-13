import {
  approvalPieceVersions,
  approvalStepPhase,
  projectApprovalPiece,
  type PieceProjectionInput,
  type ProjectedStepInput,
} from './approval-piece.projection';

const step = (
  id: string,
  position: number,
  status: ProjectedStepInput['status'],
  isStale = false,
): ProjectedStepInput => ({ id, position, status, isStale });

const piece = (
  steps: ProjectedStepInput[],
  overrides: Partial<PieceProjectionInput> = {},
): PieceProjectionInput => ({
  finishedAt: null,
  sourceState: 'active',
  sendOrder: 'sequential',
  steps,
  ...overrides,
});

describe('approval piece projection (D-13)', () => {
  it('maps a request status to a phase, and a stale approval to preparation', () => {
    expect(approvalStepPhase('draft', false)).toBe('preparation');
    expect(approvalStepPhase(null, false)).toBe('preparation');
    expect(approvalStepPhase('cancelled', false)).toBe('preparation');
    expect(approvalStepPhase('approved', false)).toBe('approved');
    expect(approvalStepPhase('approved', true)).toBe('preparation');
  });

  it('finished and posted win over everything', () => {
    const steps = [step('copy', 0, 'awaiting_client')];
    expect(
      projectApprovalPiece(piece(steps, { finishedAt: new Date() }))
        .boardColumn,
    ).toBe('finished');
    expect(
      projectApprovalPiece(piece(steps, { sourceState: 'posted' })).boardColumn,
    ).toBe('finished');
  });

  it('Ajustes has priority over the other columns', () => {
    expect(
      projectApprovalPiece(
        piece([
          step('copy', 0, 'awaiting_client'),
          step('creative', 1, 'changes_requested'),
        ]),
      ),
    ).toEqual({ boardColumn: 'changes', activeStepId: 'creative' });
  });

  it('sequential: the copy approved returns the card to preparation on Criativo', () => {
    expect(
      projectApprovalPiece(
        piece([step('copy', 0, 'approved'), step('creative', 1, null)]),
      ),
    ).toEqual({ boardColumn: 'preparation', activeStepId: 'creative' });
  });

  it('sequential: an untouched step does not hide a later one under review', () => {
    expect(
      projectApprovalPiece(
        piece([step('copy', 0, null), step('creative', 1, 'awaiting_client')]),
      ),
    ).toEqual({ boardColumn: 'awaiting_client', activeStepId: 'creative' });
  });

  it('together: the piece sits on the most delayed step', () => {
    expect(
      projectApprovalPiece(
        piece(
          [
            step('copy', 0, 'awaiting_client'),
            step('creative', 1, 'awaiting_internal_review'),
          ],
          { sendOrder: 'together' },
        ),
      ),
    ).toEqual({ boardColumn: 'internal_review', activeStepId: 'creative' });
  });

  it('all approved is Aprovado; a stale step reopens it', () => {
    expect(
      projectApprovalPiece(
        piece([step('copy', 0, 'approved'), step('creative', 1, 'approved')]),
      ).boardColumn,
    ).toBe('approved');
    expect(
      projectApprovalPiece(
        piece([
          step('copy', 0, 'approved', true),
          step('creative', 1, 'approved'),
        ]),
      ),
    ).toEqual({ boardColumn: 'preparation', activeStepId: 'copy' });
  });
});

describe('approval piece versions (E3)', () => {
  const at = (minutes: number) => new Date(Date.UTC(2026, 10, 13, 12, minutes));
  const request = (
    id: string,
    stepId: string,
    revision: string,
    minutes: number,
    status: 'draft' | 'awaiting_client' | 'cancelled' = 'awaiting_client',
  ) => ({
    id,
    stepId,
    subjectRevisionId: revision,
    status,
    createdAt: at(minutes),
  });

  it('a copy and a creative sent together are one version', () => {
    const versions = approvalPieceVersions([
      request('creative-1', 'creative', 'c1', 0),
      request('copy-1', 'copy', 't1', 0),
    ]);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ number: 1, isCurrent: true });
    expect(versions[0].parts).toEqual(
      expect.arrayContaining([
        { stepId: 'copy', approvalId: 'copy-1', changed: true },
        { stepId: 'creative', approvalId: 'creative-1', changed: true },
      ]),
    );
  });

  it('a later send of one part keeps the other part as it was', () => {
    const versions = approvalPieceVersions([
      request('copy-1', 'copy', 't1', 0),
      request('creative-1', 'creative', 'c1', 30),
      request('copy-2', 'copy', 't2', 60),
    ]);
    expect(versions.map((version) => version.number)).toEqual([1, 2, 3]);
    expect(versions[2].parts).toEqual([
      { stepId: 'copy', approvalId: 'copy-2', changed: true },
      { stepId: 'creative', approvalId: 'creative-1', changed: false },
    ]);
    expect(versions.map((version) => version.isCurrent)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it('resending the same revision and drafts do not make a version', () => {
    const versions = approvalPieceVersions([
      request('copy-1', 'copy', 't1', 0, 'cancelled'),
      request('copy-2', 'copy', 't1', 40),
      request('copy-3', 'copy', 't2', 50, 'draft'),
    ]);
    expect(versions).toHaveLength(1);
    expect(versions[0].parts).toEqual([
      { stepId: 'copy', approvalId: 'copy-2', changed: true },
    ]);
  });

  it('two revisions of the same part in a minute are two versions', () => {
    const versions = approvalPieceVersions([
      request('copy-1', 'copy', 't1', 0),
      request('copy-2', 'copy', 't2', 1),
    ]);
    expect(versions).toHaveLength(2);
  });
});
