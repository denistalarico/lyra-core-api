import {
  resolveDecisionReviewOutcome,
  sameReviewActionKeys,
} from './inbox-agent-runtime.service';

describe('agent decision review outcomes', () => {
  const plan = [
    { key: 'stage', allowed: true },
    { key: 'summary', allowed: true },
    { key: 'invented-tag', allowed: false },
  ];

  it('distinguishes analysis-only, partial and complete action reviews', () => {
    expect(resolveDecisionReviewOutcome(plan, 'analysis', [])).toBe(
      'analysis_approved',
    );
    expect(resolveDecisionReviewOutcome(plan, 'actions', ['stage'])).toBe(
      'actions_partially_approved',
    );
    expect(
      resolveDecisionReviewOutcome(plan, 'actions', ['stage', 'summary']),
    ).toBe('actions_applied');
  });

  it('compares idempotent subsets independent of ordering and duplicates', () => {
    expect(
      sameReviewActionKeys(['summary', 'stage'], ['stage', 'summary']),
    ).toBe(true);
    expect(sameReviewActionKeys(['stage', 'stage'], ['stage'])).toBe(true);
    expect(sameReviewActionKeys(['stage'], [])).toBe(false);
  });
});
