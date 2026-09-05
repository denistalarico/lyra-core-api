import type { DataSource } from 'typeorm';
import { PaidMediaContributionService } from './paid-media-contribution.service';

/**
 * The write side of the privacy boundary.
 *
 * What matters here is what a contribution *contains*, because once a row is
 * written it is indistinguishable from every other contributor's. The tests are
 * therefore about exclusion as much as arithmetic.
 */
describe('PaidMediaContributionService', () => {
  const scope = {
    tenantId: '3fcf6e35-9881-4713-b704-795956eec0c8',
    workspaceId: 'b9c311c3-0000-0000-0000-000000000000',
    agencyClientId: null,
  };

  const row = (overrides: Record<string, unknown> = {}) => ({
    observed_on: '2026-09-04',
    currency: 'BRL',
    destination: 'whatsapp',
    spend: '6.64',
    impressions: '137',
    clicks: '5',
    link_clicks: '3',
    leads: '0',
    ...overrides,
  });

  const service = (rows: unknown[]) =>
    new PaidMediaContributionService({
      query: jest.fn().mockResolvedValue(rows),
    } as unknown as DataSource);

  const build = (rows: unknown[]) =>
    service(rows).buildContributions({
      scope,
      businessModeKey: 'agency_services',
      since: '2026-08-06',
      until: '2026-09-04',
    });

  it('emits one contribution per metric with an exact spend conversion', async () => {
    const contributions = await build([row()]);

    expect(contributions).toEqual([
      {
        observedOn: '2026-09-04',
        metricKey: 'paid_spend_minor_units',
        dimensionKey: 'v1|bm=agency_services|p=meta|d=whatsapp|c=BRL',
        metricValue: '664',
      },
      {
        observedOn: '2026-09-04',
        metricKey: 'paid_impressions',
        dimensionKey: 'v1|bm=agency_services|p=meta|d=whatsapp',
        metricValue: '137',
      },
      {
        observedOn: '2026-09-04',
        metricKey: 'paid_clicks',
        dimensionKey: 'v1|bm=agency_services|p=meta|d=whatsapp',
        metricValue: '5',
      },
      {
        observedOn: '2026-09-04',
        metricKey: 'paid_link_clicks',
        dimensionKey: 'v1|bm=agency_services|p=meta|d=whatsapp',
        metricValue: '3',
      },
      {
        observedOn: '2026-09-04',
        metricKey: 'paid_provider_leads',
        dimensionKey: 'v1|bm=agency_services|p=meta|d=whatsapp',
        metricValue: '0',
      },
    ]);
  });

  /**
   * Only the monetary metric carries a currency axis.
   *
   * Splitting counts by currency would fragment the sample against k for no
   * semantic gain — an impression is an impression in every currency.
   */
  it('adds the currency axis to monetary metrics only', async () => {
    const contributions = await build([row()]);
    const withCurrency = contributions.filter((entry) =>
      entry.dimensionKey.includes('c='),
    );

    expect(withCurrency).toHaveLength(1);
    expect(withCurrency[0].metricKey).toBe('paid_spend_minor_units');
  });

  /** A row with no currency still contributes its counts; only spend drops. */
  it('drops spend but keeps counts when the currency is unknown', async () => {
    const contributions = await build([row({ currency: null })]);

    expect(contributions.map((entry) => entry.metricKey)).toEqual([
      'paid_impressions',
      'paid_clicks',
      'paid_link_clicks',
      'paid_provider_leads',
    ]);
  });

  /**
   * A real zero is contributed, not skipped.
   *
   * `paid_provider_leads` is zero for every messaging-objective advertiser by
   * design. Skipping zeros would remove those contributors from the cohort
   * entirely and leave a benchmark describing only lead-form advertisers.
   */
  it('contributes zero as a value', async () => {
    const contributions = await build([row({ leads: '0', clicks: '0' })]);
    const leads = contributions.find(
      (entry) => entry.metricKey === 'paid_provider_leads',
    );

    expect(leads?.metricValue).toBe('0');
  });

  it('maps an unrecognised destination to unknown rather than dropping the row', async () => {
    const contributions = await build([
      row({ destination: 'SOME_NEW_META_DESTINATION' }),
    ]);

    expect(contributions[0].dimensionKey).toContain('d=unknown');
    expect(contributions).toHaveLength(5);
  });

  it('handles a null destination as unknown', async () => {
    const contributions = await build([row({ destination: null })]);

    expect(contributions[0].dimensionKey).toContain('d=unknown');
  });

  it('refuses a cohort whose business mode is not system-defined', async () => {
    await expect(
      service([row()]).buildContributions({
        scope,
        businessModeKey: 'meu_modo_custom',
        since: '2026-08-06',
        until: '2026-09-04',
      }),
    ).rejects.toThrow(/not eligible/);
  });

  it('normalises the currency code', async () => {
    const contributions = await build([row({ currency: ' brl ' })]);

    expect(contributions[0].dimensionKey).toContain('c=BRL');
  });

  it('converts spend beyond the safe integer range without loss', async () => {
    const contributions = await build([row({ spend: '99999999999999999.99' })]);

    expect(contributions[0].metricValue).toBe('9999999999999999999');
  });

  describe('the source query', () => {
    const capture = async (): Promise<{ sql: string; params: unknown[] }> => {
      const query = jest.fn().mockResolvedValue([]);
      const dataSource = { query } as unknown as DataSource;

      await new PaidMediaContributionService(dataSource).buildContributions({
        scope,
        businessModeKey: 'agency_services',
        since: '2026-08-06',
        until: '2026-09-04',
      });

      const [sql, params] = query.mock.calls[0] as [string, unknown[]];

      return { sql, params };
    };

    /**
     * Ad-set grain, not a sum across levels.
     *
     * The metrics table holds account, campaign and ad-set rows for the same
     * days; summing them triples every figure. Ad set is also the only level
     * carrying a destination.
     */
    it('reads ad-set rows only', async () => {
      const { sql } = await capture();

      expect(sql).toMatch(/metrics\.entity_level = 'adset'/);
    });

    /** Intraday rows would put a three-hour day into a distribution of full days. */
    it('excludes partial days', async () => {
      const { sql } = await capture();

      expect(sql).toMatch(/metrics\.is_partial = false/);
    });

    /**
     * The temporal destination rule from I4.1 — the day's destination, never
     * today's.
     */
    it('resolves the destination as of the metric date', async () => {
      const { sql } = await capture();

      expect(sql).toMatch(
        /observation\.observed_at::date <= metrics\.metric_date/,
      );
      expect(sql).toMatch(/ORDER BY observation\.observed_at DESC/);
    });

    /** The agency context is a NULL client id, never "any client". */
    it('scopes with IS NOT DISTINCT FROM for the agency context', async () => {
      const { sql, params } = await capture();

      expect(sql).toMatch(
        /metrics\.agency_client_id IS NOT DISTINCT FROM \$3::uuid/,
      );
      expect(params[2]).toBeNull();
    });

    /**
     * Nothing identifying is selected — the fact table has nowhere to put it,
     * and the query must not gather it in the first place.
     */
    it('selects no identifier of any kind', async () => {
      const { sql } = await capture();
      const selectClause = sql.slice(
        0,
        sql.indexOf('FROM social_ad_metrics_daily'),
      );

      for (const forbidden of [
        'entity_external_id',
        'campaign_external_id',
        'connection_id',
        'metrics.tenant_id',
        'metrics.workspace_id',
        'name',
        'raw',
      ]) {
        expect(selectClause).not.toContain(forbidden);
      }
    });
  });
});
