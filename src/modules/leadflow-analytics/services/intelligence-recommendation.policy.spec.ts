import {
  AUTOMATION_FAILURE_POLICY,
  buildAutomationFailureRecommendationCandidate,
} from './intelligence-recommendation.policy';

describe('automation failure intelligence policy', () => {
  const sample = {
    automationId: '29a2671e-4831-4fea-b442-7003937362bc',
    automationName: 'Follow-up comercial',
    recipeKey: 'followup_idle_lead',
    businessModeKey: 'services',
    succeededRuns: 6,
    failedRuns: 4,
  };

  it('creates an evidenced candidate only above the minimum sample and rate', () => {
    const candidate = buildAutomationFailureRecommendationCandidate(sample);

    expect(candidate).toMatchObject({
      baseline: {
        terminalLiveRuns: 10,
        failedRuns: 4,
        failureRate: 0.4,
      },
      segment: {
        automationId: sample.automationId,
        recipeKey: sample.recipeKey,
      },
    });
    expect(candidate?.confidence).toBeGreaterThanOrEqual(0.65);
    expect(candidate?.evidence).toHaveLength(3);
    expect(AUTOMATION_FAILURE_POLICY.appliesAutomatically).toBe(false);
  });

  it.each([
    [{ ...sample, succeededRuns: 2, failedRuns: 1 }],
    [{ ...sample, succeededRuns: 18, failedRuns: 2 }],
    [{ ...sample, succeededRuns: 5, failedRuns: 0 }],
  ])('does not invent a recommendation for insufficient evidence', (input) => {
    expect(buildAutomationFailureRecommendationCandidate(input)).toBeNull();
  });
});
