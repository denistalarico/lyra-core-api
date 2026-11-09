import { normalizeStageOrder } from './social-approval-board-preferences.service';

describe('normalizeStageOrder', () => {
  it('keeps the saved order and appends the columns not saved', () => {
    expect(normalizeStageOrder(['approved', 'preparation'])).toEqual([
      'approved',
      'preparation',
      'internal_review',
      'awaiting_client',
      'changes',
      'finished',
    ]);
  });

  it('drops unknown and repeated columns', () => {
    const order = normalizeStageOrder(['changes', 'changes', 'nope']);
    expect(order[0]).toBe('changes');
    expect(order).toHaveLength(6);
    expect(new Set(order).size).toBe(6);
  });
});
