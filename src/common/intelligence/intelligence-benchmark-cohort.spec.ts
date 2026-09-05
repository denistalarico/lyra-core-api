import {
  BENCHMARK_COHORT_MAX_LENGTH,
  BENCHMARK_COHORT_VERSION,
  BENCHMARK_ELIGIBLE_DESTINATIONS,
  isBenchmarkEligibleBusinessMode,
  parseBenchmarkCohortKey,
  serializeBenchmarkCohortKey,
  type BenchmarkCohort,
  type BenchmarkDestination,
} from './intelligence-benchmark-cohort';

/**
 * The serializer that lets four cohort axes live in one varchar(80).
 *
 * Two properties carry the design and both are tested exhaustively rather than
 * by example: every legal cohort must round-trip, and every legal cohort must
 * fit. A failure of the first produces cohorts that silently never match; a
 * failure of the second is a PostgreSQL truncation that corrupts the axis
 * without an error.
 */
/**
 * A system vocabulary, supplied the way a real caller supplies it.
 *
 * Synthetic keys rather than the real twelve, and that is required rather than
 * stylistic: `intelligence-contract.boundary.spec` forbids any file in this
 * folder — specs included — from enumerating business-mode keys, because the
 * catalog is tenant-extensible and a list written here would be wrong for some
 * tenant. That rule is exactly why the vocabulary became a parameter, so the
 * spec honours it by testing the *mechanism* with keys it invents.
 *
 * The longest key is sized to the longest real one so the varchar(80) ceiling
 * is still tested against a realistic worst case. `leadflow-analytics` holds the
 * spec that checks the real vocabulary against the enum.
 */
const SYSTEM_MODES: ReadonlySet<string> = new Set([
  'mode_alpha',
  'mode_beta',
  'mode_gamma',
  // Same length as the longest shipped key, so the length assertion below is
  // exercised against the real worst case rather than a short synthetic one.
  'mode_with_a_realistically_long_key',
]);

describe('benchmark cohort key', () => {
  const cohort = (
    overrides: Partial<BenchmarkCohort> = {},
  ): BenchmarkCohort => ({
    businessModeKey: 'mode_alpha',
    provider: 'meta',
    destination: 'whatsapp',
    currency: 'BRL',
    ...overrides,
  });

  describe('serialization', () => {
    it('produces the documented versioned shape', () => {
      expect(serializeBenchmarkCohortKey(cohort(), SYSTEM_MODES)).toBe(
        'v1|bm=mode_alpha|p=meta|d=whatsapp|c=BRL',
      );
    });

    it('omits the currency axis entirely for count metrics', () => {
      expect(
        serializeBenchmarkCohortKey(cohort({ currency: null }), SYSTEM_MODES),
      ).toBe('v1|bm=mode_alpha|p=meta|d=whatsapp');
    });

    it('is deterministic', () => {
      const key = serializeBenchmarkCohortKey(cohort(), SYSTEM_MODES);

      for (let i = 0; i < 10; i += 1) {
        expect(serializeBenchmarkCohortKey(cohort(), SYSTEM_MODES)).toBe(key);
      }
    });

    it('always carries the version prefix', () => {
      expect(
        serializeBenchmarkCohortKey(cohort(), SYSTEM_MODES).startsWith(
          `${BENCHMARK_COHORT_VERSION}|`,
        ),
      ).toBe(true);
    });
  });

  /**
   * Every legal combination, not a sample.
   *
   * every mode × 11 destinations × 2 currency states, all of which must
   * fit the column and survive a round trip. Testing a handful would leave the
   * longest combination — the one that actually risks truncation — untested.
   */
  describe('exhaustive properties', () => {
    const allCohorts: BenchmarkCohort[] = [];

    for (const businessModeKey of SYSTEM_MODES) {
      for (const destination of BENCHMARK_ELIGIBLE_DESTINATIONS) {
        for (const currency of ['BRL', null]) {
          allCohorts.push({
            businessModeKey,
            provider: 'meta',
            destination: destination as BenchmarkDestination,
            currency,
          });
        }
      }
    }

    it('fits every legal cohort inside the storage column', () => {
      for (const candidate of allCohorts) {
        expect(
          serializeBenchmarkCohortKey(candidate, SYSTEM_MODES).length,
        ).toBeLessThanOrEqual(BENCHMARK_COHORT_MAX_LENGTH);
      }
    });

    it('round-trips every legal cohort', () => {
      for (const candidate of allCohorts) {
        expect(
          parseBenchmarkCohortKey(
            serializeBenchmarkCohortKey(candidate, SYSTEM_MODES),
            SYSTEM_MODES,
          ),
        ).toEqual(candidate);
      }
    });

    it('maps distinct cohorts to distinct keys', () => {
      const keys = new Set(
        allCohorts.map((entry) =>
          serializeBenchmarkCohortKey(entry, SYSTEM_MODES),
        ),
      );

      expect(keys.size).toBe(allCohorts.length);
    });
  });

  describe('rejection', () => {
    /**
     * A tenant-custom mode. The §4 rule, enforced at the encoding layer so an
     * ineligible cohort cannot be written in the first place.
     */
    it('refuses a business mode outside the system catalog', () => {
      expect(() =>
        serializeBenchmarkCohortKey(
          cohort({ businessModeKey: 'meu_modo_custom' }),
          SYSTEM_MODES,
        ),
      ).toThrow(/not eligible/);
    });

    it('refuses an unknown provider', () => {
      expect(() =>
        serializeBenchmarkCohortKey(
          cohort({ provider: 'tiktok' }),
          SYSTEM_MODES,
        ),
      ).toThrow(/not a benchmark provider/);
    });

    it('refuses a destination outside the canonical set', () => {
      expect(() =>
        serializeBenchmarkCohortKey(
          cohort({ destination: 'carrier_pigeon' as BenchmarkDestination }),
          SYSTEM_MODES,
        ),
      ).toThrow(/not a canonical/);
    });

    it('refuses a malformed currency', () => {
      expect(() =>
        serializeBenchmarkCohortKey(cohort({ currency: 'brl' }), SYSTEM_MODES),
      ).toThrow();
      expect(() =>
        serializeBenchmarkCohortKey(
          cohort({ currency: 'REAIS' }),
          SYSTEM_MODES,
        ),
      ).toThrow();
    });

    /**
     * The differencing surface, closed at the vocabulary.
     *
     * A caller who could inject an arbitrary axis value could construct a cohort
     * matching exactly one contributor and read that contributor's numbers out
     * of something labelled a benchmark.
     */
    it('refuses an injected separator or arbitrary axis', () => {
      expect(() =>
        serializeBenchmarkCohortKey(
          cohort({ businessModeKey: 'mode_alpha|x=1' }),
          SYSTEM_MODES,
        ),
      ).toThrow();
    });
  });

  describe('parsing', () => {
    it('returns null for a different encoding version', () => {
      expect(
        parseBenchmarkCohortKey(
          'v2|bm=mode_alpha|p=meta|d=whatsapp|c=BRL',
          SYSTEM_MODES,
        ),
      ).toBeNull();
    });

    it('returns null rather than throwing for malformed input', () => {
      expect(parseBenchmarkCohortKey('', SYSTEM_MODES)).toBeNull();
      expect(parseBenchmarkCohortKey('garbage', SYSTEM_MODES)).toBeNull();
      expect(
        parseBenchmarkCohortKey('v1|bm=mode_alpha', SYSTEM_MODES),
      ).toBeNull();
      expect(
        parseBenchmarkCohortKey('v1|bm=|p=meta|d=whatsapp|c=BRL', SYSTEM_MODES),
      ).toBeNull();
    });

    /** A repeated axis denotes nothing; last-one-wins would let two strings mean one cohort. */
    it('returns null for a duplicated axis', () => {
      expect(
        parseBenchmarkCohortKey(
          'v1|bm=mode_alpha|bm=mode_beta|p=meta|d=whatsapp',
          SYSTEM_MODES,
        ),
      ).toBeNull();
    });

    it('returns null for an ineligible cohort that is syntactically valid', () => {
      expect(
        parseBenchmarkCohortKey(
          'v1|bm=custom_mode|p=meta|d=whatsapp|c=BRL',
          SYSTEM_MODES,
        ),
      ).toBeNull();
    });

    it('returns null for an unexpected extra axis', () => {
      expect(
        parseBenchmarkCohortKey(
          'v1|bm=mode_alpha|p=meta|d=whatsapp|c=BRL|x=1',
          SYSTEM_MODES,
        ),
      ).toBeNull();
    });
  });

  /**
   * The window must never reach the storage dimension (§3).
   *
   * Contributions are daily; encoding a window would duplicate every row per
   * window definition and let two windows disagree about one day.
   */
  it('never encodes a window', () => {
    const key = serializeBenchmarkCohortKey(cohort(), SYSTEM_MODES);

    expect(key).not.toMatch(/trailing/);
    expect(key).not.toMatch(/w=/);
    expect(key).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  describe('business mode eligibility', () => {
    it('accepts every system-defined mode', () => {
      for (const mode of SYSTEM_MODES) {
        expect(isBenchmarkEligibleBusinessMode(mode, SYSTEM_MODES)).toBe(true);
      }
    });

    /** Custom, unknown and unconfigured are three ways of being ineligible. */
    it('rejects custom, unknown and unconfigured', () => {
      expect(isBenchmarkEligibleBusinessMode('meu_modo', SYSTEM_MODES)).toBe(
        false,
      );
      expect(
        isBenchmarkEligibleBusinessMode('not_in_catalog', SYSTEM_MODES),
      ).toBe(false);
      expect(isBenchmarkEligibleBusinessMode(null, SYSTEM_MODES)).toBe(false);
      expect(isBenchmarkEligibleBusinessMode(undefined, SYSTEM_MODES)).toBe(
        false,
      );
      expect(isBenchmarkEligibleBusinessMode('', SYSTEM_MODES)).toBe(false);
    });
  });
});
