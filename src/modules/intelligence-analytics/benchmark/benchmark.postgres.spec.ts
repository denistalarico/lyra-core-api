import { randomUUID } from 'crypto';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import { deleteFixtureTenant } from '../../../testing/fixture-tenant';
import { describePostgresIntegration } from '../../../testing/postgres-integration';
import { BenchmarkService } from './benchmark.service';

const run = describePostgresIntegration();

/**
 * The benchmark against real rows, with a real k-anonymous sample.
 *
 * This suite exists because production cannot demonstrate the happy path and
 * must not be made to. There is one tenant, no platform consent, no identity
 * link and no fact row — three independent fail-closed gates — and fabricating
 * a fifth contributor there would mean manufacturing consent that nobody gave.
 * So the only place the *available* branch can be proven is here, against
 * `lyra_agency_test`, with contexts that exist solely inside this file.
 *
 * What a mock cannot prove and this can: that `GROUP BY scope_pseudonym`
 * really makes a contributor the unit of the distribution rather than a row,
 * that the `HAVING` coverage floor really excludes a thin contributor, that
 * `bigint` sums survive the driver, and that two currencies really land in two
 * cohorts.
 *
 * ## Cleanup
 *
 * `leadflow_product_telemetry_daily` has no `tenant_id` — the pseudonym is the
 * only handle it has — so `deleteFixtureTenant` cannot reach it. This spec
 * deletes its own facts by the pseudonyms it generated, which is the same shape
 * `eraseContribution` uses in production.
 */
run('Benchmark against PostgreSQL', () => {
  const tenantId = randomUUID();

  /** Every pseudonym this spec creates, so it can remove its own facts. */
  const pseudonyms = new Set<string>();

  const originalEnv = { ...process.env };
  const now = new Date('2026-09-05T12:00:00Z');
  const service = () => new BenchmarkService(AgencyDataSource);

  const COHORT = 'v1|bm=agency_services|p=meta|d=whatsapp';
  const SPEND_COHORT_BRL = 'v1|bm=agency_services|p=meta|d=whatsapp|c=BRL';
  const SPEND_COHORT_USD = 'v1|bm=agency_services|p=meta|d=whatsapp|c=USD';

  /**
   * One contributor's worth of daily facts.
   *
   * `days` controls coverage, which is what the quality floor tests vary. Days
   * are laid down ending on the window's last completed day so they always fall
   * inside it.
   */
  const contribute = async (input: {
    metricKey: string;
    dimensionKey: string;
    dailyValue: number;
    days: number;
    pseudonym?: string;
  }) => {
    const pseudonym = input.pseudonym ?? randomUUID();
    pseudonyms.add(pseudonym);

    for (let offset = 0; offset < input.days; offset += 1) {
      const day = new Date(Date.UTC(2026, 8, 4));
      day.setUTCDate(day.getUTCDate() - offset);

      await AgencyDataSource.query(
        `INSERT INTO leadflow_product_telemetry_daily
           (id, scope_pseudonym, observed_on, metric_key, dimension_key,
            metric_value, sample_size, source_period_from, source_period_to)
         -- The period bounds are strictly ordered by CK_lf_product_telemetry_period,
         -- so a zero-width period is rejected. A day-wide one is also what a real
         -- collection writes.
         VALUES ($1, $2, $3::date, $4, $5, $6, 1,
                 $3::timestamptz, $3::timestamptz + interval '1 day')`,
        [
          randomUUID(),
          pseudonym,
          day.toISOString().slice(0, 10),
          input.metricKey,
          input.dimensionKey,
          String(input.dailyValue),
        ],
      );
    }

    return pseudonym;
  };

  const reset = async () => {
    if (pseudonyms.size) {
      await AgencyDataSource.query(
        `DELETE FROM leadflow_product_telemetry_daily
          WHERE scope_pseudonym = ANY($1::uuid[])`,
        [[...pseudonyms]],
      );
      pseudonyms.clear();
    }

    await deleteFixtureTenant(AgencyDataSource, tenantId, [
      'leadflow_telemetry_consents',
      'leadflow_telemetry_audit_events',
      'leadflow_telemetry_identity_links',
    ]);
  };

  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
    await reset();
  });

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.LEADFLOW_PRODUCT_TELEMETRY_ENABLED = 'true';
    delete process.env.LEADFLOW_PRODUCT_TELEMETRY_K_ANONYMITY;
  });

  afterEach(async () => {
    process.env = originalEnv;
    await reset();
  });

  afterAll(async () => {
    await reset();
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  const benchmark = (
    metricKey: 'paid_impressions' | 'paid_spend_minor_units',
    currency: string | null = null,
  ) =>
    service().getBenchmark({
      metricKey,
      cohort: {
        businessModeKey: 'agency_services',
        provider: 'meta',
        destination: 'whatsapp',
        currency,
      },
      windowKey: 'trailing_30_completed_days_v1',
      now,
    });

  /**
   * The happy path, and the reason this file exists.
   *
   * Five contexts, each contributing 30 days. The distribution is over the five
   * window totals — 3000, 6000, 9000, 12000, 15000 — so the percentiles are
   * predictable and any change in weighting would move them visibly.
   */
  it('publishes percentiles at exactly k contributing contexts', async () => {
    for (let index = 1; index <= 5; index += 1) {
      await contribute({
        metricKey: 'paid_impressions',
        dimensionKey: COHORT,
        dailyValue: index * 100,
        days: 30,
      });
    }

    const result = await benchmark('paid_impressions');

    expect(result.available).toBe(true);
    expect(result.sampleSize).toBe(5);
    expect(result.percentiles).toEqual({
      p25: 6000,
      median: 9000,
      p75: 12000,
    });
    expect(result.quality.meanCoverage).toBeCloseTo(1, 5);
  });

  /** k−1 must reveal nothing, on real rows and not just in a mock. */
  it('refuses at k-1', async () => {
    for (let index = 1; index <= 4; index += 1) {
      await contribute({
        metricKey: 'paid_impressions',
        dimensionKey: COHORT,
        dailyValue: index * 100,
        days: 30,
      });
    }

    const result = await benchmark('paid_impressions');

    expect(result.available).toBe(false);
    expect(result.reason).toBe('insufficient_anonymous_sample');
    expect(result.percentiles).toBeNull();
    expect(result.sampleSize).toBe(4);
  });

  /**
   * §11 and §13, proven against the database rather than asserted.
   *
   * One contributor with 30 days of enormous values is still one contributor.
   * If the grouping were by row, this single context would satisfy k on its own
   * and its private numbers would be published as a "benchmark" — the precise
   * failure the pseudonym grouping exists to prevent.
   */
  it('cannot let one huge contributor satisfy k alone', async () => {
    await contribute({
      metricKey: 'paid_impressions',
      dimensionKey: COHORT,
      dailyValue: 1_000_000,
      days: 30,
    });

    const result = await benchmark('paid_impressions');

    expect(result.sampleSize).toBe(1);
    expect(result.available).toBe(false);
    expect(result.percentiles).toBeNull();
  });

  /**
   * Per-context weighting: many days do not buy extra weight.
   *
   * Five contributors of 30 days each and one of 8 days produce a six-member
   * distribution, not a 158-member one. The median lands between the third and
   * fourth *contributor*, which is only true if the inner aggregation happened.
   */
  it('weights each context once regardless of its row count', async () => {
    for (const value of [100, 200, 300, 400, 500]) {
      await contribute({
        metricKey: 'paid_impressions',
        dimensionKey: COHORT,
        dailyValue: value,
        days: 30,
      });
    }
    await contribute({
      metricKey: 'paid_impressions',
      dimensionKey: COHORT,
      dailyValue: 1,
      days: 8,
    });

    const result = await benchmark('paid_impressions');

    expect(result.sampleSize).toBe(6);
    // Window totals: 8, 3000, 6000, 9000, 12000, 15000.
    expect(result.percentiles?.median).toBe(7500);
  });

  /** The §19 coverage floor, on real rows. */
  it('excludes a contributor below the minimum coverage', async () => {
    for (let index = 1; index <= 5; index += 1) {
      await contribute({
        metricKey: 'paid_impressions',
        dimensionKey: COHORT,
        dailyValue: 100,
        days: 30,
      });
    }
    await contribute({
      metricKey: 'paid_impressions',
      dimensionKey: COHORT,
      dailyValue: 999_999,
      days: 3,
    });

    const result = await benchmark('paid_impressions');

    expect(result.sampleSize).toBe(5);
    expect(result.percentiles?.p75).toBe(3000);
  });

  /**
   * Currency separation with no FX.
   *
   * Five BRL contributors and five USD ones share every other axis. Each
   * currency must produce its own distribution; a single mixed one would be
   * arithmetic over incomparable units.
   */
  it('keeps currencies in separate cohorts', async () => {
    for (let index = 1; index <= 5; index += 1) {
      await contribute({
        metricKey: 'paid_spend_minor_units',
        dimensionKey: SPEND_COHORT_BRL,
        dailyValue: 1000,
        days: 30,
      });
      await contribute({
        metricKey: 'paid_spend_minor_units',
        dimensionKey: SPEND_COHORT_USD,
        dailyValue: 50,
        days: 30,
      });
    }

    const brl = await benchmark('paid_spend_minor_units', 'BRL');
    const usd = await benchmark('paid_spend_minor_units', 'USD');

    expect(brl.sampleSize).toBe(5);
    expect(usd.sampleSize).toBe(5);
    expect(brl.percentiles?.median).toBe(30_000);
    expect(usd.percentiles?.median).toBe(1_500);
    expect(brl.unit).toBe('currency_minor_units');
  });

  /** A different cohort's rows must not leak into this one. */
  it('isolates one cohort from another', async () => {
    for (let index = 1; index <= 5; index += 1) {
      await contribute({
        metricKey: 'paid_impressions',
        dimensionKey: COHORT,
        dailyValue: 100,
        days: 30,
      });
      await contribute({
        metricKey: 'paid_impressions',
        dimensionKey: 'v1|bm=real_estate|p=meta|d=website',
        dailyValue: 9_999,
        days: 30,
      });
    }

    const result = await benchmark('paid_impressions');

    expect(result.sampleSize).toBe(5);
    expect(result.percentiles?.median).toBe(3000);
  });

  /** Days outside the window are not counted, even for the same contributor. */
  it('ignores rows outside the window', async () => {
    for (let index = 1; index <= 5; index += 1) {
      const pseudonym = await contribute({
        metricKey: 'paid_impressions',
        dimensionKey: COHORT,
        dailyValue: 100,
        days: 30,
      });

      // A day well before the window opens.
      await AgencyDataSource.query(
        `INSERT INTO leadflow_product_telemetry_daily
           (id, scope_pseudonym, observed_on, metric_key, dimension_key,
            metric_value, sample_size, source_period_from, source_period_to)
         VALUES ($1, $2, '2026-01-01'::date, 'paid_impressions', $3,
                 '999999', 1, '2026-01-01'::timestamptz,
                 '2026-01-02'::timestamptz)`,
        [randomUUID(), pseudonym, COHORT],
      );
    }

    const result = await benchmark('paid_impressions');

    expect(result.percentiles?.median).toBe(3000);
  });

  /**
   * Erasure propagates without the benchmark knowing anything about consent.
   *
   * Deleting one contributor's facts — what `eraseContribution` does — drops the
   * sample below k and the benchmark stops publishing. Nothing had to notify it.
   */
  it('stops including a contributor whose facts were erased', async () => {
    const erased: string[] = [];

    for (let index = 1; index <= 5; index += 1) {
      erased.push(
        await contribute({
          metricKey: 'paid_impressions',
          dimensionKey: COHORT,
          dailyValue: 100,
          days: 30,
        }),
      );
    }

    expect((await benchmark('paid_impressions')).available).toBe(true);

    await AgencyDataSource.query(
      `DELETE FROM leadflow_product_telemetry_daily WHERE scope_pseudonym = $1`,
      [erased[0]],
    );

    const afterErasure = await benchmark('paid_impressions');

    expect(afterErasure.available).toBe(false);
    expect(afterErasure.sampleSize).toBe(4);
    expect(afterErasure.percentiles).toBeNull();
  });

  /**
   * A business mode change relabels nothing that was already written.
   *
   * The old cohort keeps the rows collected under it and the new cohort starts
   * empty — the prospective-snapshot semantics, visible as data rather than
   * asserted in prose.
   */
  it('does not retroactively relabel contributions after a mode change', async () => {
    const pseudonym = randomUUID();

    await contribute({
      metricKey: 'paid_impressions',
      dimensionKey: COHORT,
      dailyValue: 100,
      days: 10,
      pseudonym,
    });
    await contribute({
      metricKey: 'paid_impressions',
      dimensionKey: 'v1|bm=real_estate|p=meta|d=whatsapp',
      dailyValue: 200,
      days: 10,
      pseudonym,
    });

    const [oldCohort] = await AgencyDataSource.query<Array<{ total: string }>>(
      `SELECT SUM(metric_value)::text AS total
         FROM leadflow_product_telemetry_daily
        WHERE scope_pseudonym = $1 AND dimension_key = $2`,
      [pseudonym, COHORT],
    );

    expect(oldCohort.total).toBe('1000');
  });

  /** With the gate off nothing is published, whatever the data says. */
  it('publishes nothing when the gate is off', async () => {
    for (let index = 1; index <= 5; index += 1) {
      await contribute({
        metricKey: 'paid_impressions',
        dimensionKey: COHORT,
        dailyValue: 100,
        days: 30,
      });
    }

    process.env.LEADFLOW_PRODUCT_TELEMETRY_ENABLED = 'false';

    const result = await benchmark('paid_impressions');

    expect(result.available).toBe(false);
    expect(result.reason).toBe('gate_disabled');
    expect(result.percentiles).toBeNull();
  });

  /** `bigint` sums survive the driver rather than arriving as a rounded float. */
  it('sums large values without precision loss', async () => {
    for (let index = 1; index <= 5; index += 1) {
      await contribute({
        metricKey: 'paid_impressions',
        dimensionKey: COHORT,
        dailyValue: 1_000_000_000,
        days: 30,
      });
    }

    const result = await benchmark('paid_impressions');

    expect(result.percentiles?.median).toBe(30_000_000_000);
  });
});
