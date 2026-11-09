import {
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
