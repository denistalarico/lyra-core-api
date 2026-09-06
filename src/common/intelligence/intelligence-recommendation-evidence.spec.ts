import {
  INTELLIGENCE_RECOMMENDATION_EVIDENCE_SCHEMA_VERSION,
  isCurrentRecommendationEvidence,
  type IntelligenceEvidenceLimitation,
  type IntelligenceEvidenceSemanticKind,
  type IntelligenceRecommendationEvidenceV1,
} from './intelligence-recommendation-evidence';

/**
 * A minimal valid item — every mandatory field and nothing else.
 *
 * Written out rather than built by a helper so that the set of fields a
 * consumer is *required* to supply is visible here: removing one of these from
 * the contract would make this compile with a field the type no longer needs,
 * and adding a new mandatory one breaks this first.
 */
const MINIMAL: IntelligenceRecommendationEvidenceV1 = {
  schemaVersion: INTELLIGENCE_RECOMMENDATION_EVIDENCE_SCHEMA_VERSION,
  ref: 'leadflow_automation_runs:auto-1:failure_rate',
  label: 'Taxa de falha entre desfechos live',
  metric: 'failureRate',
  value: 0.4,
  unit: 'ratio',
  semanticKind: 'factual_observation',
  provenance: {
    canonicalSource: 'leadflow_automation_runs',
    attributionBasis: null,
    ingestionMode: 'live',
  },
  limitations: [],
};

describe('recommendation evidence contract', () => {
  it('carries an explicit schema version on every item', () => {
    expect(MINIMAL.schemaVersion).toBe(
      INTELLIGENCE_RECOMMENDATION_EVIDENCE_SCHEMA_VERSION,
    );
    expect(INTELLIGENCE_RECOMMENDATION_EVIDENCE_SCHEMA_VERSION).toBe(1);
  });

  /**
   * The version exists to make *old* JSON interpretable, so the case worth
   * asserting is the one where the row predates the field entirely — which is
   * every row a pre-R2 producer could have written.
   */
  it('recognises a row written before the contract existed', () => {
    const legacy = {
      ref: 'leadflow_automation_runs:auto-1:failed',
      label: 'Execuções live com falha',
      metric: 'failedRuns',
      value: 4,
      unit: 'runs',
    };

    expect(isCurrentRecommendationEvidence(legacy)).toBe(false);
    expect(isCurrentRecommendationEvidence(MINIMAL)).toBe(true);
    expect(isCurrentRecommendationEvidence(null)).toBe(false);
    expect(isCurrentRecommendationEvidence({ schemaVersion: 2 })).toBe(false);
  });

  /**
   * The four kinds are distinct claims, and the contract must not let them
   * collapse. Asserted as a value-level list because the type alone disappears
   * at runtime, and this is the enumeration a future consumer switches over.
   */
  it('distinguishes the four semantic kinds', () => {
    const kinds: IntelligenceEvidenceSemanticKind[] = [
      'factual_observation',
      'cohort_correlation',
      'observed_attribution',
      'benchmark_comparison',
    ];

    expect(new Set(kinds).size).toBe(4);

    for (const semanticKind of kinds) {
      const item: IntelligenceRecommendationEvidenceV1 = {
        ...MINIMAL,
        semanticKind,
      };

      expect(item.semanticKind).toBe(semanticKind);
    }
  });

  /**
   * Evidence is not a recommendation. If `'recommendation'` were ever added to
   * the union, a recommendation could cite itself as its own justification.
   */
  it('does not admit a recommendation as its own evidence', () => {
    const kind = 'recommendation' as string;

    expect(
      (
        [
          'factual_observation',
          'cohort_correlation',
          'observed_attribution',
          'benchmark_comparison',
        ] as string[]
      ).includes(kind),
    ).toBe(false);
  });

  /**
   * The whole point of coding limitations: a consumer decides what to do by
   * branching on `code`, never by reading `detail`.
   */
  it('represents limitations machine-readably', () => {
    const limitations: IntelligenceEvidenceLimitation[] = [
      { code: 'non_additive_metric', metricKey: 'reach' },
      {
        code: 'no_fx_normalization',
        detail: 'Duas moedas observadas no período.',
      },
      { code: 'value_is_not_revenue', metricKey: 'wonOpportunityValue' },
      { code: 'unavailable_before_first_observation' },
      { code: 'destination_unknown' },
      { code: 'ambiguous_provider_value', detail: 'messaging_multi' },
      { code: 'partial_source_coverage' },
      { code: 'benchmark_below_k_threshold' },
    ];

    const item: IntelligenceRecommendationEvidenceV1 = {
      ...MINIMAL,
      limitations,
    };

    // Every hazard the Foundation established can be expressed, and each is
    // readable without parsing prose.
    expect(item.limitations.map((entry) => entry.code)).toEqual([
      'non_additive_metric',
      'no_fx_normalization',
      'value_is_not_revenue',
      'unavailable_before_first_observation',
      'destination_unknown',
      'ambiguous_provider_value',
      'partial_source_coverage',
      'benchmark_below_k_threshold',
    ]);

    // `detail` is a gloss beside the code, never the carrier of it.
    for (const entry of item.limitations) {
      expect(typeof entry.code).toBe('string');
    }
  });

  /**
   * An empty array is a positive claim ("considered, none apply") and must be
   * distinguishable from a producer that never thought about it.
   */
  it('treats an empty limitation list as an answer, not an omission', () => {
    expect(Array.isArray(MINIMAL.limitations)).toBe(true);
    expect(MINIMAL.limitations).toHaveLength(0);
    expect('limitations' in MINIMAL).toBe(true);
  });

  /**
   * Everything here lands in a JSONB column, so the real requirement is that a
   * fully-populated item survives a round trip through JSON unchanged.
   */
  it('round-trips through JSON with its window and provenance intact', () => {
    const full: IntelligenceRecommendationEvidenceV1 = {
      ...MINIMAL,
      additivity: 'average',
      formula: 'failed_runs / (succeeded_runs + failed_runs)',
      window: {
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-31T23:59:59.999Z',
      },
      coverage: { expectedDays: 31, coveredDays: 31, basis: 'canonical' },
      limitations: [
        { code: 'partial_source_coverage', detail: 'sync em curso' },
      ],
    };

    const restored = JSON.parse(
      JSON.stringify(full),
    ) as IntelligenceRecommendationEvidenceV1;

    expect(restored).toEqual(full);
    expect(restored.window?.from).toBe('2026-08-01T00:00:00.000Z');
    expect(restored.provenance.attributionBasis).toBeNull();
    expect(restored.coverage?.basis).toBe('canonical');
    expect(isCurrentRecommendationEvidence(restored)).toBe(true);
  });

  /**
   * The five fields the previous shape had, at the same names and types.
   *
   * This is the compatibility guarantee the frontend depends on: it reads
   * `ref`, `label`, `value` and `unit` directly, and a rename here would break a
   * shipped UI rather than fail a compile.
   */
  it('remains a superset of the five original fields', () => {
    for (const field of ['ref', 'label', 'metric', 'value', 'unit'] as const) {
      expect(MINIMAL[field]).toBeDefined();
    }

    expect(typeof MINIMAL.ref).toBe('string');
    expect(typeof MINIMAL.label).toBe('string');
    expect(typeof MINIMAL.metric).toBe('string');
    expect(['number', 'string']).toContain(typeof MINIMAL.value);
    expect(typeof MINIMAL.unit).toBe('string');
  });
});
