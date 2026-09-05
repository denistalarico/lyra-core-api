import {
  isBenchmarkEligibleBusinessMode,
  serializeBenchmarkCohortKey,
  BENCHMARK_COHORT_MAX_LENGTH,
} from '../../../common/intelligence';
import { LeadFlowBusinessMode } from '../../leadflow-settings/enums/leadflow-business-mode.enum';
import { BENCHMARK_SYSTEM_BUSINESS_MODES } from './benchmark-business-mode-vocabulary';

/**
 * The half of the eligibility rule that the shared contract cannot check.
 *
 * `common/intelligence` may not name a business mode — the catalog is
 * tenant-extensible, so a list there would be wrong for any tenant that added a
 * template. This module may see both the enum and the contract, so this is where
 * the two are held together.
 */
describe('benchmark business mode vocabulary', () => {
  it('is exactly the system-defined enum', () => {
    expect([...BENCHMARK_SYSTEM_BUSINESS_MODES].sort()).toEqual(
      Object.values(LeadFlowBusinessMode).sort(),
    );
  });

  it('accepts every system mode', () => {
    for (const mode of Object.values(LeadFlowBusinessMode)) {
      expect(
        isBenchmarkEligibleBusinessMode(mode, BENCHMARK_SYSTEM_BUSINESS_MODES),
      ).toBe(true);
    }
  });

  /**
   * The §4 rule, stated against real keys.
   *
   * A tenant-custom template lives in `leadflow_business_mode_templates` with a
   * non-null `tenant_id`, and its key can be anything — including a key that
   * *looks* official. Eligibility is membership in the enum, never a name match
   * or a similarity heuristic, and there is nothing in the vocabulary module
   * that could grow into one.
   */
  it('rejects custom, unknown and unconfigured modes', () => {
    for (const ineligible of [
      'clinicas_custom',
      'agency_services_v2',
      'AGENCY_SERVICES',
      'not_in_catalog',
      '',
    ]) {
      expect(
        isBenchmarkEligibleBusinessMode(
          ineligible,
          BENCHMARK_SYSTEM_BUSINESS_MODES,
        ),
      ).toBe(false);
    }

    expect(
      isBenchmarkEligibleBusinessMode(null, BENCHMARK_SYSTEM_BUSINESS_MODES),
    ).toBe(false);
    expect(
      isBenchmarkEligibleBusinessMode(
        undefined,
        BENCHMARK_SYSTEM_BUSINESS_MODES,
      ),
    ).toBe(false);
  });

  /**
   * Every real mode still fits the storage column.
   *
   * The contract's own spec proves the mechanism with synthetic keys; this
   * proves it for the keys actually shipped, against the longest destination.
   */
  it('keeps every real cohort key inside varchar(80)', () => {
    for (const mode of Object.values(LeadFlowBusinessMode)) {
      const key = serializeBenchmarkCohortKey(
        {
          businessModeKey: mode,
          provider: 'meta',
          destination: 'instagram_direct',
          currency: 'BRL',
        },
        BENCHMARK_SYSTEM_BUSINESS_MODES,
      );

      expect(key.length).toBeLessThanOrEqual(BENCHMARK_COHORT_MAX_LENGTH);
    }
  });
});
