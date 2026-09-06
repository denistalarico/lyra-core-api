import { isCurrentRecommendationEvidence } from '../../../common/intelligence';
import {
  AUTOMATION_FAILURE_POLICY,
  AUTOMATION_FAILURE_POLICY_DEFINITION,
  buildAutomationFailureRecommendationCandidate,
  resolveAutomationFailurePolicy,
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

  /**
   * R2 changed how the evidence explains itself and nothing about what the
   * policy selects. These are the pre-R2 thresholds, restated as values rather
   * than read from the constant — reading the constant would let an edit to it
   * move the test and the code together and prove nothing.
   */
  describe('behaviour preserved across the evidence contract change', () => {
    it('keeps the published thresholds', () => {
      expect(AUTOMATION_FAILURE_POLICY).toMatchObject({
        key: 'automation_failure_pause_v1',
        minimumTerminalLiveRuns: 5,
        minimumFailedRuns: 2,
        minimumFailureRate: 0.3,
        appliesAutomatically: false,
      });
    });

    it.each([
      // Exactly at each boundary, which is where an accidental `<` vs `<=`
      // change would show and a coarser sample would not.
      // 5 terminal runs, 2 failed, 40% — every threshold met at its floor.
      [{ succeededRuns: 3, failedRuns: 2 }, true],
      // 5 terminal runs and 40%, but only 1 failure: minimumFailedRuns.
      [{ succeededRuns: 4, failedRuns: 1 }, false],
      // 50% and 2 failures, but 4 terminal runs: minimumTerminalLiveRuns.
      [{ succeededRuns: 2, failedRuns: 2 }, false],
      // 30% exactly — the rate check is `<`, so the floor itself passes.
      [{ succeededRuns: 7, failedRuns: 3 }, true],
      // 27.3%: just under the rate floor with the sample size satisfied.
      [{ succeededRuns: 8, failedRuns: 3 }, false],
    ])('selects %o exactly as before', (counts, expected) => {
      const candidate = buildAutomationFailureRecommendationCandidate({
        ...sample,
        ...counts,
      });

      expect(candidate !== null).toBe(expected);
    });

    it('keeps confidence and baseline untouched', () => {
      const candidate = buildAutomationFailureRecommendationCandidate(sample);

      // 0.65 + min(0.2, 5 * 0.02) + min(0.1, 0.4 * 0.1) = 0.79
      expect(candidate?.confidence).toBe(0.79);
      expect(candidate?.baseline).toEqual({
        terminalLiveRuns: 10,
        succeededRuns: 6,
        failedRuns: 4,
        failureRate: 0.4,
      });
    });

    it('keeps the three evidence refs, metrics and values', () => {
      const candidate = buildAutomationFailureRecommendationCandidate(sample);

      expect(
        candidate?.evidence.map(({ ref, metric, value, unit }) => ({
          ref,
          metric,
          value,
          unit,
        })),
      ).toEqual([
        {
          ref: `leadflow_automation_runs:${sample.automationId}:terminal_live`,
          metric: 'terminalLiveRuns',
          value: 10,
          unit: 'runs',
        },
        {
          ref: `leadflow_automation_runs:${sample.automationId}:failed`,
          metric: 'failedRuns',
          value: 4,
          unit: 'runs',
        },
        {
          ref: `leadflow_automation_runs:${sample.automationId}:failure_rate`,
          metric: 'failureRate',
          value: 0.4,
          unit: 'ratio',
        },
      ]);
    });
  });

  /**
   * R2.1 made the rules identifiable and left the decision alone. The
   * thresholds below are restated as literals for the same reason as above:
   * reading them from the definition would let an edit move the code and the
   * test together.
   */
  describe('policy identity', () => {
    it('declares an identity, a version and its effective parameters', () => {
      expect(AUTOMATION_FAILURE_POLICY_DEFINITION).toMatchObject({
        key: 'automation_failure_pause',
        version: 1,
        recommendationKind: 'pause_automation_high_failure_rate',
        generationKeyPrefix: 'automation_failure_pause_v1',
        parameters: {
          minimumTerminalLiveRuns: 5,
          minimumFailedRuns: 2,
          minimumFailureRate: 0.3,
          appliesAutomatically: false,
        },
      });
    });

    it('resolves the definition the evaluator uses', () => {
      expect(resolveAutomationFailurePolicy()).toBe(
        AUTOMATION_FAILURE_POLICY_DEFINITION,
      );
    });

    /**
     * The published envelope and the applied parameters must not be two
     * independently editable copies of the same numbers — that divergence is
     * precisely what would make the API report thresholds nothing enforced.
     */
    it('publishes exactly the thresholds it applies', () => {
      const { parameters } = AUTOMATION_FAILURE_POLICY_DEFINITION;

      expect(AUTOMATION_FAILURE_POLICY.minimumTerminalLiveRuns).toBe(
        parameters.minimumTerminalLiveRuns,
      );
      expect(AUTOMATION_FAILURE_POLICY.minimumFailedRuns).toBe(
        parameters.minimumFailedRuns,
      );
      expect(AUTOMATION_FAILURE_POLICY.minimumFailureRate).toBe(
        parameters.minimumFailureRate,
      );
    });

    /**
     * The published `key` is a response field a deployed client mirrors, so it
     * keeps the suffixed form even though the identity no longer does.
     */
    it('keeps the published key at its shipped literal', () => {
      expect(AUTOMATION_FAILURE_POLICY.key).toBe('automation_failure_pause_v1');
      expect(AUTOMATION_FAILURE_POLICY.appliesAutomatically).toBe(false);
    });

    it('stamps every candidate with the rules that selected it', () => {
      const candidate = buildAutomationFailureRecommendationCandidate(sample);

      expect(candidate?.policy).toEqual({
        key: 'automation_failure_pause',
        version: 1,
        parameters: {
          minimumTerminalLiveRuns: 5,
          minimumFailedRuns: 2,
          minimumFailureRate: 0.3,
          appliesAutomatically: false,
        },
      });
    });

    /**
     * A stamp that aliased the registry would let one in-memory edit rewrite
     * the recorded thresholds of every candidate built in the process.
     */
    it('gives each candidate its own copy of the parameters', () => {
      const first = buildAutomationFailureRecommendationCandidate(sample);
      const second = buildAutomationFailureRecommendationCandidate(sample);

      expect(first?.policy.parameters).not.toBe(
        AUTOMATION_FAILURE_POLICY_DEFINITION.parameters,
      );
      expect(first?.policy.parameters).not.toBe(second?.policy.parameters);

      first!.policy.parameters.minimumFailureRate = 0.9;

      expect(second?.policy.parameters.minimumFailureRate).toBe(0.3);
      expect(
        AUTOMATION_FAILURE_POLICY_DEFINITION.parameters.minimumFailureRate,
      ).toBe(0.3);
    });

    it('serialises the stamp to JSONB and back unchanged', () => {
      const candidate = buildAutomationFailureRecommendationCandidate(sample);

      expect(JSON.parse(JSON.stringify(candidate!.policy))).toEqual(
        candidate!.policy,
      );
    });
  });

  describe('evidence semantics', () => {
    /**
     * The claim this policy is entitled to make, and the three it is not.
     *
     * It counts rows in a table this platform wrote. Nothing is correlated
     * across domains, nothing is attributed to an ad, nothing is compared to an
     * anonymous cohort — and labelling it as any of those would be the exact
     * laundering the semantic kind exists to prevent.
     */
    it('states every item as a factual observation and nothing stronger', () => {
      const candidate = buildAutomationFailureRecommendationCandidate(sample);

      expect(candidate?.evidence).toHaveLength(3);

      for (const item of candidate!.evidence) {
        expect(item.semanticKind).toBe('factual_observation');
        expect(item.semanticKind).not.toBe('cohort_correlation');
        expect(item.semanticKind).not.toBe('observed_attribution');
        expect(item.semanticKind).not.toBe('benchmark_comparison');
      }
    });

    it('versions every item', () => {
      const candidate = buildAutomationFailureRecommendationCandidate(sample);

      for (const item of candidate!.evidence) {
        expect(item.schemaVersion).toBe(1);
        expect(isCurrentRecommendationEvidence(item)).toBe(true);
      }
    });

    /**
     * Honest provenance for a live read of a canonical local table: no sync to
     * declare, and `attributionBasis: null` because this domain has no
     * attribution model rather than because the field was forgotten.
     */
    it('describes provenance without inventing precision', () => {
      const candidate = buildAutomationFailureRecommendationCandidate(sample);

      for (const item of candidate!.evidence) {
        expect(item.provenance).toMatchObject({
          canonicalSource: 'leadflow_automation_runs',
          attributionBasis: null,
          ingestionMode: 'live',
        });
        // Nothing claimed about coverage: the read is canonical and complete,
        // so a coverage figure here would be decoration.
        expect(item.coverage).toBeUndefined();
        expect(item.limitations).toEqual([]);
      }
    });

    it('gives each item its own limitation array', () => {
      const candidate = buildAutomationFailureRecommendationCandidate(sample);
      const [first, second] = candidate!.evidence;

      first.limitations.push({ code: 'partial_source_coverage' });

      expect(second.limitations).toHaveLength(0);
    });

    it('marks the rate as a quotient and the counts as summable', () => {
      const candidate = buildAutomationFailureRecommendationCandidate(sample);
      const byMetric = new Map(
        candidate!.evidence.map((item) => [item.metric, item]),
      );

      expect(byMetric.get('terminalLiveRuns')?.additivity).toBe('sum');
      expect(byMetric.get('failedRuns')?.additivity).toBe('sum');
      // Not `sum`: averaging two periods' rates is not the combined rate unless
      // both periods had the same number of terminal runs.
      expect(byMetric.get('failureRate')?.additivity).toBe('average');
      expect(byMetric.get('failureRate')?.formula).toBe(
        'failed_runs / (succeeded_runs + failed_runs)',
      );
    });

    it('carries the caller window, and omits it rather than inventing one', () => {
      const withWindow = buildAutomationFailureRecommendationCandidate({
        ...sample,
        window: {
          from: '2026-08-01T00:00:00.000Z',
          to: '2026-08-31T00:00:00.000Z',
        },
      });

      for (const item of withWindow!.evidence) {
        expect(item.window).toEqual({
          from: '2026-08-01T00:00:00.000Z',
          to: '2026-08-31T00:00:00.000Z',
        });
      }

      const withoutWindow =
        buildAutomationFailureRecommendationCandidate(sample);

      for (const item of withoutWindow!.evidence) {
        expect(item.window).toBeUndefined();
      }
    });

    it('serialises to JSONB and back unchanged', () => {
      const candidate = buildAutomationFailureRecommendationCandidate({
        ...sample,
        window: {
          from: '2026-08-01T00:00:00.000Z',
          to: '2026-08-31T00:00:00.000Z',
        },
      });

      expect(JSON.parse(JSON.stringify(candidate!.evidence))).toEqual(
        candidate!.evidence,
      );
    });
  });
});
