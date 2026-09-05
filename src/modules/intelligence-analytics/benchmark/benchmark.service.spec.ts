import type { DataSource } from 'typeorm';
import type { BenchmarkCohort } from '../../../common/intelligence';
import { BenchmarkService } from './benchmark.service';

/**
 * The benchmark's refusals, which are most of its behaviour.
 *
 * Every path that returns `available: false` is tested for the same two
 * properties: no percentiles, and a reason that says which rule fired. A
 * response that returned a distribution alongside a false flag would be read by
 * a UI as data, and the flag would be a comment.
 */
describe('BenchmarkService', () => {
  const originalEnv = { ...process.env };

  const cohort = (
    overrides: Partial<BenchmarkCohort> = {},
  ): BenchmarkCohort => ({
    businessModeKey: 'agency_services',
    provider: 'meta',
    destination: 'whatsapp',
    currency: 'BRL',
    ...overrides,
  });

  /** Rows shaped like the contributor-distribution query returns them. */
  type ContributorRow = { value: string; covered_days: string };

  const dataSourceReturning = (rows: ContributorRow[]) => {
    const query = jest.fn().mockResolvedValue(rows);

    return { dataSource: { query } as unknown as DataSource, query };
  };

  /** The SQL and parameters of the nth call, typed rather than `any`. */
  const callArgs = (query: jest.Mock, index = 0) =>
    query.mock.calls[index] as [string, unknown[]];

  const service = (rows: ContributorRow[] = []) =>
    new BenchmarkService(dataSourceReturning(rows).dataSource);

  const contributors = (count: number, value = 1000) =>
    Array.from({ length: count }, (_, index) => ({
      value: String(value + index),
      covered_days: '30',
    }));

  const now = new Date('2026-09-05T12:00:00Z');

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.LEADFLOW_PRODUCT_TELEMETRY_ENABLED = 'true';
    delete process.env.LEADFLOW_PRODUCT_TELEMETRY_K_ANONYMITY;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('gate', () => {
    /**
     * The production state today. Fail-closed, and it must not read data to
     * decide that — with the gate off no contribution is being collected, so a
     * distribution would describe a frozen past under a current window's label.
     */
    it('refuses when the platform gate is off, without querying', async () => {
      process.env.LEADFLOW_PRODUCT_TELEMETRY_ENABLED = 'false';
      const { dataSource, query } = dataSourceReturning(contributors(10));
      const result = await new BenchmarkService(dataSource).getBenchmark({
        metricKey: 'paid_impressions',
        cohort: cohort({ currency: null }),
        windowKey: 'trailing_30_completed_days_v1',
        now,
      });

      expect(result.available).toBe(false);
      expect(result.reason).toBe('gate_disabled');
      expect(result.percentiles).toBeNull();
      expect(result.dataQuality.gateEnabled).toBe(false);
      expect(query).not.toHaveBeenCalled();
    });

    it('treats an unset gate as off', async () => {
      delete process.env.LEADFLOW_PRODUCT_TELEMETRY_ENABLED;

      const result = await service(contributors(10)).getBenchmark({
        metricKey: 'paid_impressions',
        cohort: cohort({ currency: null }),
        windowKey: 'trailing_30_completed_days_v1',
        now,
      });

      expect(result.reason).toBe('gate_disabled');
    });
  });

  describe('k-anonymity', () => {
    it('refuses below the threshold and reveals no distribution', async () => {
      const result = await service(contributors(4)).getBenchmark({
        metricKey: 'paid_impressions',
        cohort: cohort({ currency: null }),
        windowKey: 'trailing_30_completed_days_v1',
        now,
      });

      expect(result.available).toBe(false);
      expect(result.reason).toBe('insufficient_anonymous_sample');
      expect(result.percentiles).toBeNull();
      expect(result.sampleSize).toBe(4);
    });

    /** Exactly k is enough — the threshold is a floor, not a strict bound. */
    it('publishes at exactly k', async () => {
      const result = await service(contributors(5)).getBenchmark({
        metricKey: 'paid_impressions',
        cohort: cohort({ currency: null }),
        windowKey: 'trailing_30_completed_days_v1',
        now,
      });

      expect(result.available).toBe(true);
      expect(result.sampleSize).toBe(5);
      expect(result.percentiles).not.toBeNull();
    });

    it('honours a raised threshold from configuration', async () => {
      process.env.LEADFLOW_PRODUCT_TELEMETRY_K_ANONYMITY = '10';

      const result = await service(contributors(5)).getBenchmark({
        metricKey: 'paid_impressions',
        cohort: cohort({ currency: null }),
        windowKey: 'trailing_30_completed_days_v1',
        now,
      });

      expect(result.available).toBe(false);
      expect(result.reason).toBe('insufficient_anonymous_sample');
    });

    /** A threshold below the floor cannot be configured downward. */
    it('never falls below the hard minimum of five', async () => {
      process.env.LEADFLOW_PRODUCT_TELEMETRY_K_ANONYMITY = '1';

      const result = await service(contributors(3)).getBenchmark({
        metricKey: 'paid_impressions',
        cohort: cohort({ currency: null }),
        windowKey: 'trailing_30_completed_days_v1',
        now,
      });

      expect(result.available).toBe(false);
    });

    /**
     * The sample counts contexts, not rows.
     *
     * The SQL groups by `scope_pseudonym`, so one row here is one contributor
     * regardless of how many facts produced it. A single enormous advertiser
     * arrives as one row and cannot satisfy k alone.
     */
    it('counts contributing contexts, so one huge contributor is still one', async () => {
      const result = await service([
        { value: '999999999999', covered_days: '30' },
      ]).getBenchmark({
        metricKey: 'paid_impressions',
        cohort: cohort({ currency: null }),
        windowKey: 'trailing_30_completed_days_v1',
        now,
      });

      expect(result.sampleSize).toBe(1);
      expect(result.available).toBe(false);
      expect(result.reason).toBe('insufficient_anonymous_sample');
    });
  });

  describe('cohort eligibility', () => {
    it('refuses a tenant-custom business mode', async () => {
      const result = await service(contributors(10)).getBenchmark({
        metricKey: 'paid_impressions',
        cohort: cohort({ businessModeKey: 'meu_modo', currency: null }),
        windowKey: 'trailing_30_completed_days_v1',
        now,
      });

      expect(result.available).toBe(false);
      expect(result.reason).toBe('ineligible_cohort');
      expect(result.dataQuality.businessModeEligible).toBe(false);
      expect(result.percentiles).toBeNull();
    });

    /**
     * Ineligibility is decided before the gate, so the message is about the
     * cohort rather than about deployment configuration — otherwise a caller
     * asking an impossible question would be told to enable a feature that
     * would not help.
     */
    it('reports an ineligible cohort even with the gate off', async () => {
      process.env.LEADFLOW_PRODUCT_TELEMETRY_ENABLED = 'false';

      const result = await service().getBenchmark({
        metricKey: 'paid_impressions',
        cohort: cohort({ businessModeKey: 'custom', currency: null }),
        windowKey: 'trailing_30_completed_days_v1',
        now,
      });

      expect(result.reason).toBe('ineligible_cohort');
    });
  });

  describe('currency', () => {
    /** No FX: a monetary benchmark without a currency axis is refused. */
    it('requires a currency for monetary metrics', async () => {
      const result = await service(contributors(10)).getBenchmark({
        metricKey: 'paid_spend_minor_units',
        cohort: cohort({ currency: null }),
        windowKey: 'trailing_30_completed_days_v1',
        now,
      });

      expect(result.available).toBe(false);
      expect(result.reason).toBe('currency_required');
      expect(result.dataQuality.currencyCompatible).toBe(false);
    });

    it('separates cohorts by currency in the query key', async () => {
      const { dataSource, query } = dataSourceReturning(contributors(6));
      const benchmark = new BenchmarkService(dataSource);

      await benchmark.getBenchmark({
        metricKey: 'paid_spend_minor_units',
        cohort: cohort({ currency: 'BRL' }),
        windowKey: 'trailing_30_completed_days_v1',
        now,
      });
      await benchmark.getBenchmark({
        metricKey: 'paid_spend_minor_units',
        cohort: cohort({ currency: 'USD' }),
        windowKey: 'trailing_30_completed_days_v1',
        now,
      });

      const [, firstParams] = callArgs(query, 0);
      const [, secondParams] = callArgs(query, 1);

      expect(firstParams[1]).toContain('c=BRL');
      expect(secondParams[1]).toContain('c=USD');
      expect(firstParams[1]).not.toEqual(secondParams[1]);
    });

    it('reports spend in minor units', async () => {
      const result = await service(contributors(6)).getBenchmark({
        metricKey: 'paid_spend_minor_units',
        cohort: cohort({ currency: 'BRL' }),
        windowKey: 'trailing_30_completed_days_v1',
        now,
      });

      expect(result.unit).toBe('currency_minor_units');
      expect(result.dataQuality.limitations.join(' ')).toMatch(/No FX/i);
    });
  });

  describe('percentiles and quality', () => {
    it('computes p25, median and p75 over contributor values', async () => {
      const result = await service([
        { value: '10', covered_days: '30' },
        { value: '20', covered_days: '30' },
        { value: '30', covered_days: '30' },
        { value: '40', covered_days: '30' },
        { value: '50', covered_days: '30' },
      ]).getBenchmark({
        metricKey: 'paid_clicks',
        cohort: cohort({ currency: null }),
        windowKey: 'trailing_30_completed_days_v1',
        now,
      });

      expect(result.percentiles).toEqual({ p25: 20, median: 30, p75: 40 });
    });

    /** No silent winsorization: the extreme value stays in the sample. */
    it('does not remove outliers', async () => {
      const result = await service([
        { value: '10', covered_days: '30' },
        { value: '20', covered_days: '30' },
        { value: '30', covered_days: '30' },
        { value: '40', covered_days: '30' },
        { value: '100000000', covered_days: '30' },
      ]).getBenchmark({
        metricKey: 'paid_clicks',
        cohort: cohort({ currency: null }),
        windowKey: 'trailing_30_completed_days_v1',
        now,
      });

      expect(result.percentiles?.median).toBe(30);
      expect(result.sampleSize).toBe(5);
    });

    /**
     * Quality is operational, never a statistical claim (§22).
     */
    it('never presents itself as a statistical confidence interval', async () => {
      const result = await service(contributors(6)).getBenchmark({
        metricKey: 'paid_clicks',
        cohort: cohort({ currency: null }),
        windowKey: 'trailing_30_completed_days_v1',
        now,
      });

      expect(['low', 'moderate', 'good']).toContain(result.quality.tier);
      expect(result.quality.notes.join(' ')).toMatch(
        /not a statistical confidence/i,
      );

      // Affirmative statistical claims only. The disclaimer above necessarily
      // contains the words "confidence interval" to deny them, so a blanket
      // search for the phrase would fail on the very text that makes the
      // response honest — the thing to forbid is a *number* presented as
      // significance.
      const serialized = JSON.stringify(result);

      expect(serialized).not.toMatch(/\b9[05]%/);
      expect(serialized).not.toMatch(/p-value|pValue/i);
      expect(serialized).not.toMatch(
        /margin of error|standard error|significan/i,
      );
    });

    it('reports mean coverage and lowers the tier for thin coverage', async () => {
      const result = await service(
        Array.from({ length: 12 }, () => ({ value: '100', covered_days: '9' })),
      ).getBenchmark({
        metricKey: 'paid_clicks',
        cohort: cohort({ currency: null }),
        windowKey: 'trailing_30_completed_days_v1',
        now,
      });

      expect(result.quality.meanCoverage).toBeCloseTo(0.3, 5);
      expect(result.quality.tier).toBe('low');
      expect(result.quality.notes.join(' ')).toMatch(/under half the window/i);
    });
  });

  describe('privacy', () => {
    /**
     * The response carries no identity of any kind.
     *
     * Asserted over the serialized response rather than field by field, because
     * the risk is a field nobody thought to check — the read model is only safe
     * if *nothing* identifying can appear.
     */
    it('never exposes contributor identifiers', async () => {
      const result = await service(contributors(8)).getBenchmark({
        metricKey: 'paid_clicks',
        cohort: cohort({ currency: null }),
        windowKey: 'trailing_30_completed_days_v1',
        now,
      });

      const serialized = JSON.stringify(result);

      for (const forbidden of [
        'tenantId',
        'tenant_id',
        'workspaceId',
        'agencyClientId',
        'scopePseudonym',
        'scope_pseudonym',
        'pseudonym',
        'accountId',
        'campaignId',
        'adsetId',
        'adId',
        'conversationId',
        'contactId',
        'userId',
      ]) {
        expect(serialized).not.toContain(forbidden);
      }
    });

    /**
     * The query is parameterised by a serialized cohort key and nothing a
     * caller supplies freely — no tenant predicate exists to add.
     */
    it('never filters by tenant', async () => {
      const { dataSource, query } = dataSourceReturning(contributors(6));

      await new BenchmarkService(dataSource).getBenchmark({
        metricKey: 'paid_clicks',
        cohort: cohort({ currency: null }),
        windowKey: 'trailing_30_completed_days_v1',
        now,
      });

      const [sql] = callArgs(query);

      expect(sql).not.toMatch(/tenant_id/);
      expect(sql).not.toMatch(/workspace_id/);
      expect(sql).not.toMatch(/agency_client_id/);
      expect(sql).toMatch(/leadflow_product_telemetry_daily/);
    });

    /**
     * The read path touches only the anonymous fact table — never operational
     * tables across tenants.
     */
    it('reads no operational table', async () => {
      const { dataSource, query } = dataSourceReturning(contributors(6));

      await new BenchmarkService(dataSource).getBenchmark({
        metricKey: 'paid_clicks',
        cohort: cohort({ currency: null }),
        windowKey: 'trailing_30_completed_days_v1',
        now,
      });

      const [sql] = callArgs(query);

      for (const table of [
        'social_ad_metrics_daily',
        'social_ad_entities',
        'inbox_conversations',
        'inbox_attribution_observations',
        'crm_opportunities',
        'leadflow_telemetry_identity_links',
        'leadflow_telemetry_consents',
      ]) {
        expect(sql).not.toContain(table);
      }
    });
  });

  describe('provenance', () => {
    it('declares versions, source and temporal semantics', async () => {
      const result = await service(contributors(6)).getBenchmark({
        metricKey: 'paid_clicks',
        cohort: cohort({ currency: null }),
        windowKey: 'trailing_30_completed_days_v1',
        now,
      });

      expect(result.provenance).toMatchObject({
        metricKey: 'paid_clicks',
        metricSource: 'social_ad_metrics_daily.clicks',
        definitionVersion: 'i6.paid_clicks.v1',
        aggregationVersion: 'i6.aggregation.v1',
        contributionSource: 'leadflow_product_telemetry_daily',
        cohortEncodingVersion: 'v1',
        businessModeTemporalSemantics: 'prospective_contribution_snapshot',
      });
      expect(result.provenance.window.until).toBe('2026-09-04');
    });

    /** Provenance is present on refusals too, so a UI can explain them. */
    it('is present even when unavailable', async () => {
      const result = await service(contributors(2)).getBenchmark({
        metricKey: 'paid_clicks',
        cohort: cohort({ currency: null }),
        windowKey: 'trailing_30_completed_days_v1',
        now,
      });

      expect(result.provenance.aggregationVersion).toBe('i6.aggregation.v1');
      expect(result.dataQuality.consentRequired).toBe(true);
    });
  });

  describe('window', () => {
    it('queries only completed days', async () => {
      const { dataSource, query } = dataSourceReturning(contributors(6));

      await new BenchmarkService(dataSource).getBenchmark({
        metricKey: 'paid_clicks',
        cohort: cohort({ currency: null }),
        windowKey: 'trailing_30_completed_days_v1',
        now,
      });

      const [, params] = callArgs(query);

      expect(params[2]).toBe('2026-08-06');
      expect(params[3]).toBe('2026-09-04');
    });

    /** The §19 coverage floor reaches the query rather than being advisory. */
    it('applies the minimum contributor coverage', async () => {
      const { dataSource, query } = dataSourceReturning(contributors(6));

      await new BenchmarkService(dataSource).getBenchmark({
        metricKey: 'paid_clicks',
        cohort: cohort({ currency: null }),
        windowKey: 'trailing_30_completed_days_v1',
        now,
      });

      const [sql, params] = callArgs(query);

      expect(sql).toMatch(/HAVING COUNT\(\*\) >= \$5/);
      expect(params[4]).toBe(7);
    });
  });
});
