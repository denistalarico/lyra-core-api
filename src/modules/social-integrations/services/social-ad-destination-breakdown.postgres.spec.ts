import { randomUUID } from 'node:crypto';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import { SocialAdMetricDailyEntity } from '../entities/social-ad-metric-daily.entity';
import { SocialAdDestinationBreakdownReadService } from './social-ad-destination-breakdown.read.service';
import { describePostgresIntegration } from '../../../testing/postgres-integration';

/**
 * The destination breakdown against a real PostgreSQL.
 *
 * Every claim this read makes is a database guarantee and cannot be checked
 * against a mock. Whether the account and campaign rows for the same days are
 * excluded depends on a `WHERE` clause; whether a day resolves to the
 * destination in force *then* rather than now depends on a `LATERAL` ordering;
 * and whether an ad set observed at 21:00 São Paulo time lands on the right day
 * depends on the zone conversion happening before the cast. A fixture-driven
 * unit test would pass under every one of those being wrong.
 *
 * All of it runs inside one transaction that is rolled back, on
 * `lyra_agency_test` behind the official guard.
 */
const run = describePostgresIntegration();

run('Destination breakdown against PostgreSQL', () => {
  let service: SocialAdDestinationBreakdownReadService;

  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const workspaceId = randomUUID();
  const otherWorkspaceId = randomUUID();
  const connectionId = randomUUID();
  const otherConnectionId = randomUUID();

  const query = <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
    AgencyDataSource.query<T[]>(sql, params);

  const createAdSet = async (
    externalId: string,
    where: { tenant?: string; workspace?: string; connection?: string } = {},
    level = 'adset',
  ): Promise<string> => {
    const rows = await query<{ id: string }>(
      `INSERT INTO "social_ad_entities"
         ("tenant_id", "workspace_id", "connection_id", "provider",
          "entity_level", "external_id")
       VALUES ($1, $2, $3, 'meta_ads', $5, $4)
       RETURNING "id"`,
      [
        where.tenant ?? tenantId,
        where.workspace ?? workspaceId,
        where.connection ?? connectionId,
        externalId,
        level,
      ],
    );

    return rows[0].id;
  };

  const observe = (
    adEntityId: string,
    destinationType: string,
    observedAt: string,
  ) =>
    query(
      `INSERT INTO "social_ad_destination_observations"
         ("tenant_id", "workspace_id", "connection_id", "provider",
          "ad_entity_id", "destination_type", "destination_raw", "observed_at")
       VALUES ($1, $2, $3, 'meta_ads', $4, $5, $6, $7::timestamptz)`,
      [
        tenantId,
        workspaceId,
        connectionId,
        adEntityId,
        destinationType,
        destinationType.toUpperCase(),
        observedAt,
      ],
    );

  const insertFact = (input: {
    externalId: string;
    metricDate: string;
    spend?: string;
    leads?: string;
    impressions?: string;
    entityLevel?: string;
    isPartial?: boolean;
    tenant?: string;
    workspace?: string;
    connection?: string;
  }) =>
    query(
      `INSERT INTO "social_ad_metrics_daily"
         ("tenant_id", "workspace_id", "connection_id", "provider", "source",
          "entity_level", "entity_external_id", "campaign_external_id",
          "metric_date", "account_timezone", "currency",
          "attribution_setting", "spend", "impressions", "clicks",
          "link_clicks", "leads", "conversions", "conversion_value",
          "video_views", "is_partial")
       VALUES ($1, $2, $3, 'meta_ads', 'paid', $4, $5, 'campaign-parent', $6,
               'America/Sao_Paulo', 'BRL', 'account_default', $7, $8, 10, 5,
               $9, 0, 0, 0, $10)`,
      [
        input.tenant ?? tenantId,
        input.workspace ?? workspaceId,
        input.connection ?? connectionId,
        input.entityLevel ?? 'adset',
        input.externalId,
        input.metricDate,
        input.spend ?? '0.000000',
        input.impressions ?? '100',
        input.leads ?? '0',
        input.isPartial ?? false,
      ],
    );

  const breakdown = (since: string, until: string, expectedDays = 31) =>
    service.breakdown({
      tenantId,
      workspaceId,
      connectionId,
      since,
      until,
      timezone: 'America/Sao_Paulo',
      expectedDays,
    });

  const bucketFor = async (
    destination: string,
    since = '2026-08-01',
    until = '2026-08-31',
  ) => {
    const result = await breakdown(since, until);

    return result.buckets.find((item) => item.destination === destination);
  };

  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();

    await AgencyDataSource.query('BEGIN');

    for (const [id, tenant, workspace] of [
      [connectionId, tenantId, workspaceId],
      [otherConnectionId, otherTenantId, otherWorkspaceId],
    ]) {
      await query(
        `INSERT INTO "social_ad_account_connections"
           ("id", "tenant_id", "workspace_id", "provider", "external_account_id")
         VALUES ($1, $2, $3, 'meta_ads', $4)`,
        [id, tenant, workspace, `act_${randomUUID()}`],
      );
    }

    service = new SocialAdDestinationBreakdownReadService(
      AgencyDataSource.getRepository(SocialAdMetricDailyEntity),
    );
  });

  afterAll(async () => {
    if (AgencyDataSource.isInitialized) {
      await AgencyDataSource.query('ROLLBACK');
      await AgencyDataSource.destroy();
    }
  });

  describe('the grain', () => {
    /**
     * The filter that separates a breakdown from a number three times too big.
     *
     * The account row, every campaign row and every ad set row describe the same
     * money at different grains. A query without `entity_level = 'adset'` sums
     * all three and reports a plausible, wrong total.
     */
    it('reads ad-set rows only, never the account or campaign rows', async () => {
      const external = `adset-grain-${randomUUID()}`;
      const adSet = await createAdSet(external);
      await observe(adSet, 'whatsapp', '2026-08-01T10:00:00-03:00');

      await insertFact({
        externalId: external,
        metricDate: '2026-08-05',
        spend: '60.000000',
      });
      // The same money, one grain up and two grains up. Both must be ignored.
      await insertFact({
        externalId: 'campaign-parent',
        metricDate: '2026-08-05',
        spend: '60.000000',
        entityLevel: 'campaign',
      });
      await insertFact({
        externalId: 'act_1',
        metricDate: '2026-08-05',
        spend: '60.000000',
        entityLevel: 'account',
      });

      const whatsapp = await bucketFor('whatsapp');

      expect(whatsapp?.spend).toBe('60.000000');
    });

    /**
     * Nothing is apportioned: each ad set's own money under its own destination.
     *
     * Two ad sets of one campaign pointing at different destinations is the case
     * the whole feature exists for, and the case a campaign-level split gets
     * wrong.
     */
    it('splits two ad sets of one campaign without dividing anything', async () => {
      const whatsappExternal = `adset-wa-${randomUUID()}`;
      const directExternal = `adset-ig-${randomUUID()}`;
      const whatsappAdSet = await createAdSet(whatsappExternal);
      const directAdSet = await createAdSet(directExternal);

      await observe(whatsappAdSet, 'whatsapp', '2026-09-01T10:00:00-03:00');
      await observe(
        directAdSet,
        'instagram_direct',
        '2026-09-01T10:00:00-03:00',
      );

      await insertFact({
        externalId: whatsappExternal,
        metricDate: '2026-09-10',
        spend: '70.000000',
        leads: '7',
      });
      await insertFact({
        externalId: directExternal,
        metricDate: '2026-09-10',
        spend: '30.000000',
        leads: '3',
      });

      const result = await breakdown('2026-09-10', '2026-09-10', 1);
      const byDestination = new Map(
        result.buckets.map((item) => [item.destination, item]),
      );

      expect(byDestination.get('whatsapp')?.spend).toBe('70.000000');
      expect(byDestination.get('whatsapp')?.providerLeads).toBe('7');
      expect(byDestination.get('instagram_direct')?.spend).toBe('30.000000');
      expect(byDestination.get('instagram_direct')?.providerLeads).toBe('3');
    });

    /**
     * Meta object ids are unique per type, not across types.
     *
     * A campaign and an ad set can share an id, and the entity join must not
     * match the campaign row into an ad-set bucket.
     */
    it('does not join a campaign entity sharing an ad set id', async () => {
      const shared = `120244000000000${Math.floor(Math.random() * 900 + 100)}`;
      const adSet = await createAdSet(shared);
      await createAdSet(shared, {}, 'campaign');
      await observe(adSet, 'messenger', '2026-10-01T10:00:00-03:00');

      await insertFact({
        externalId: shared,
        metricDate: '2026-10-05',
        spend: '25.000000',
      });

      const result = await breakdown('2026-10-05', '2026-10-05', 1);
      const messenger = result.buckets.find(
        (item) => item.destination === 'messenger',
      );

      // One row joined once, not twice by the campaign entity of the same id.
      expect(messenger?.spend).toBe('25.000000');
      expect(messenger?.factDays).toBe(1);
    });
  });

  describe('temporal resolution', () => {
    /**
     * The destination of the day, never the destination of today.
     *
     * An ad set switched from WhatsApp to Instagram Direct in the middle of the
     * window must report each half under what was observed at the time. Reading
     * `social_ad_entities.destination_type` would relabel both halves.
     */
    it('uses the destination in force on each day', async () => {
      const external = `adset-switch-${randomUUID()}`;
      const adSet = await createAdSet(external);

      await observe(adSet, 'whatsapp', '2026-11-01T10:00:00-03:00');
      await observe(adSet, 'instagram_direct', '2026-11-10T10:00:00-03:00');

      await insertFact({
        externalId: external,
        metricDate: '2026-11-05',
        spend: '50.000000',
      });
      await insertFact({
        externalId: external,
        metricDate: '2026-11-15',
        spend: '80.000000',
      });

      const result = await breakdown('2026-11-01', '2026-11-30', 30);
      const byDestination = new Map(
        result.buckets.map((item) => [item.destination, item]),
      );

      expect(byDestination.get('whatsapp')?.spend).toBe('50.000000');
      expect(byDestination.get('instagram_direct')?.spend).toBe('80.000000');
    });

    /**
     * Before the first observation there is no destination, and none is invented.
     *
     * Back-projecting the first observation over prior days is the single most
     * tempting error here: it would attribute months of spend to a destination
     * confirmed once, at the end.
     */
    it('reports spend before the first observation as unknown', async () => {
      const external = `adset-pre-${randomUUID()}`;
      const adSet = await createAdSet(external);

      await observe(adSet, 'whatsapp', '2026-12-20T10:00:00-03:00');

      await insertFact({
        externalId: external,
        metricDate: '2026-12-05',
        spend: '40.000000',
      });
      await insertFact({
        externalId: external,
        metricDate: '2026-12-25',
        spend: '60.000000',
      });

      const result = await breakdown('2026-12-01', '2026-12-31', 31);
      const byDestination = new Map(
        result.buckets.map((item) => [item.destination, item]),
      );

      expect(byDestination.get('unknown')?.spend).toBe('40.000000');
      expect(byDestination.get('whatsapp')?.spend).toBe('60.000000');
    });

    /**
     * And it says *why* it is unknown.
     *
     * Spend from days predating the evidence resolves itself as the sync catches
     * up; spend whose provider string maps to nothing needs a code change. The
     * two arrive in one bucket and are told apart by this field.
     */
    it('separates pre-observation spend from unmapped spend', async () => {
      const early = `adset-early-${randomUUID()}`;
      const unmapped = `adset-unmapped-${randomUUID()}`;
      const earlyAdSet = await createAdSet(early);
      const unmappedAdSet = await createAdSet(unmapped);

      await observe(earlyAdSet, 'whatsapp', '2027-01-20T10:00:00-03:00');
      // Observed, and the provider string mapped to the canonical `unknown`.
      await observe(unmappedAdSet, 'unknown', '2027-01-01T10:00:00-03:00');

      await insertFact({
        externalId: early,
        metricDate: '2027-01-05',
        spend: '40.000000',
      });
      await insertFact({
        externalId: unmapped,
        metricDate: '2027-01-05',
        spend: '15.000000',
      });

      const result = await breakdown('2027-01-01', '2027-01-31', 31);
      const unknown = result.buckets.find(
        (item) => item.destination === 'unknown',
      );

      expect(unknown?.spend).toBe('55.000000');
      // Only the pre-observation half.
      expect(unknown?.temporalUnknownSpend).toBe('40.000000');
    });

    /**
     * The zone conversion happens before the cast to a day.
     *
     * An observation at 21:00 São Paulo time is the 14th there and the 15th in
     * UTC. Comparing the raw instant would make it take effect a day late, and
     * a day of spend would land in the previous destination.
     */
    it('cuts observation days in the ad account zone', async () => {
      const external = `adset-tz-${randomUUID()}`;
      const adSet = await createAdSet(external);

      // 2027-02-14 21:00 São Paulo = 2027-02-15 00:00 UTC.
      await observe(adSet, 'whatsapp', '2027-02-14T21:00:00-03:00');

      await insertFact({
        externalId: external,
        metricDate: '2027-02-14',
        spend: '33.000000',
      });

      const result = await breakdown('2027-02-14', '2027-02-14', 1);
      const byDestination = new Map(
        result.buckets.map((item) => [item.destination, item]),
      );

      // The 14th is covered, because the observation belongs to the 14th locally.
      expect(byDestination.get('whatsapp')?.spend).toBe('33.000000');
      expect(byDestination.get('unknown')).toBeUndefined();
    });
  });

  describe('what it refuses to produce', () => {
    it('never returns a period reach per destination', async () => {
      const external = `adset-reach-${randomUUID()}`;
      const adSet = await createAdSet(external);
      await observe(adSet, 'whatsapp', '2027-03-01T10:00:00-03:00');

      await insertFact({
        externalId: external,
        metricDate: '2027-03-05',
        spend: '10.000000',
      });
      await insertFact({
        externalId: external,
        metricDate: '2027-03-06',
        spend: '10.000000',
      });

      const whatsapp = await bucketFor('whatsapp', '2027-03-01', '2027-03-31');

      expect(whatsapp?.reach).toBeNull();
    });

    /** No ratio is stored or returned; the consumer forms them from the sums. */
    it('returns no ratio column at all', async () => {
      const external = `adset-ratio-${randomUUID()}`;
      const adSet = await createAdSet(external);
      await observe(adSet, 'whatsapp', '2027-04-01T10:00:00-03:00');
      await insertFact({
        externalId: external,
        metricDate: '2027-04-05',
        spend: '10.000000',
        leads: '2',
      });

      const whatsapp = await bucketFor('whatsapp', '2027-04-01', '2027-04-30');

      for (const ratio of ['cpl', 'cpc', 'cpm', 'ctr', 'roas', 'cpa']) {
        expect(whatsapp).not.toHaveProperty(ratio);
      }
    });
  });

  describe('scope', () => {
    /** Another tenant's ad-set facts are invisible, not merely filtered late. */
    it('never reads another tenant or connection', async () => {
      const external = `adset-scope-${randomUUID()}`;
      await createAdSet(external, {
        tenant: otherTenantId,
        workspace: otherWorkspaceId,
        connection: otherConnectionId,
      });

      await insertFact({
        externalId: external,
        metricDate: '2027-05-05',
        spend: '999.000000',
        tenant: otherTenantId,
        workspace: otherWorkspaceId,
        connection: otherConnectionId,
      });

      const result = await breakdown('2027-05-01', '2027-05-31', 31);

      expect(result.buckets).toEqual([]);
      expect(result.hasAdsetFacts).toBe(false);
    });
  });

  describe('coverage', () => {
    /**
     * §26 and §27: an empty breakdown must not read as a period of no spend.
     *
     * A connection certified before ad set existed holds no ad-set rows for its
     * old windows, and only this flag separates "not ingested yet" from "no
     * delivery".
     */
    it('reports no ad-set facts as uningested rather than empty', async () => {
      const result = await breakdown('2028-01-01', '2028-01-31', 31);

      expect(result.hasAdsetFacts).toBe(false);
      expect(result.coveredDays).toBe(0);
      expect(result.expectedDays).toBe(31);
      expect(result.buckets).toEqual([]);
    });

    /** Distinct days, not the sum of the buckets' own day counts. */
    it('counts a day once when two destinations share it', async () => {
      const first = `adset-cov-a-${randomUUID()}`;
      const second = `adset-cov-b-${randomUUID()}`;
      const firstAdSet = await createAdSet(first);
      const secondAdSet = await createAdSet(second);

      await observe(firstAdSet, 'whatsapp', '2028-02-01T10:00:00-03:00');
      await observe(secondAdSet, 'website', '2028-02-01T10:00:00-03:00');

      await insertFact({
        externalId: first,
        metricDate: '2028-02-10',
        spend: '10.000000',
      });
      await insertFact({
        externalId: second,
        metricDate: '2028-02-10',
        spend: '10.000000',
      });

      const result = await breakdown('2028-02-01', '2028-02-28', 28);

      expect(result.buckets).toHaveLength(2);
      // Two buckets, one day.
      expect(result.coveredDays).toBe(1);
    });

    /** A day still landing propagates to the bucket that holds it. */
    it('marks a bucket partial when one of its days is still open', async () => {
      const external = `adset-partial-${randomUUID()}`;
      const adSet = await createAdSet(external);
      await observe(adSet, 'whatsapp', '2028-03-01T10:00:00-03:00');

      await insertFact({
        externalId: external,
        metricDate: '2028-03-10',
        spend: '10.000000',
      });
      await insertFact({
        externalId: external,
        metricDate: '2028-03-11',
        spend: '5.000000',
        isPartial: true,
      });

      const whatsapp = await bucketFor('whatsapp', '2028-03-01', '2028-03-31');

      expect(whatsapp?.factDays).toBe(2);
      expect(whatsapp?.partialDays).toBe(1);
    });

    /** Days outside the window contribute to nothing. */
    it('bounds every total by the requested window', async () => {
      const external = `adset-bounds-${randomUUID()}`;
      const adSet = await createAdSet(external);
      await observe(adSet, 'whatsapp', '2028-04-01T10:00:00-03:00');

      await insertFact({
        externalId: external,
        metricDate: '2028-04-10',
        spend: '10.000000',
      });
      await insertFact({
        externalId: external,
        metricDate: '2028-05-10',
        spend: '999.000000',
      });

      const whatsapp = await bucketFor('whatsapp', '2028-04-01', '2028-04-30');

      expect(whatsapp?.spend).toBe('10.000000');
    });
  });

  describe('arithmetic', () => {
    /**
     * Sums are exact decimal, folded in `BigInt`.
     *
     * Three days of a third of a cent is the shape that drifts under a double
     * and is exactly what a `numeric(18,6)` column preserves.
     */
    it('sums cents exactly across days', async () => {
      const external = `adset-cents-${randomUUID()}`;
      const adSet = await createAdSet(external);
      await observe(adSet, 'whatsapp', '2028-06-01T10:00:00-03:00');

      for (const day of ['2028-06-10', '2028-06-11', '2028-06-12']) {
        await insertFact({
          externalId: external,
          metricDate: day,
          spend: '0.100000',
          impressions: '1',
        });
      }

      const whatsapp = await bucketFor('whatsapp', '2028-06-01', '2028-06-30');

      expect(whatsapp?.spend).toBe('0.300000');
      expect(whatsapp?.impressions).toBe('3');
    });

    /**
     * The two halves of `unknown` are folded, and the fold crosses column types.
     *
     * `unknown` is the only destination that arrives as two grouped rows — one
     * observed, one not — so it is the only one whose merge path runs at all.
     * That path touches every metric, and `conversions` is `numeric` while the
     * counts beside it are `bigint`: folding it as an integer throws on the
     * `0.000000` Postgres returns. Caught here rather than in production because
     * a single-row bucket never merges.
     */
    it('folds both halves of unknown across integer and decimal columns', async () => {
      const early = `adset-fold-a-${randomUUID()}`;
      const unmapped = `adset-fold-b-${randomUUID()}`;
      const earlyAdSet = await createAdSet(early);
      const unmappedAdSet = await createAdSet(unmapped);

      await observe(earlyAdSet, 'whatsapp', '2028-07-20T10:00:00-03:00');
      await observe(unmappedAdSet, 'unknown', '2028-07-01T10:00:00-03:00');

      await insertFact({
        externalId: early,
        metricDate: '2028-07-05',
        spend: '10.000000',
        impressions: '100',
        leads: '2',
      });
      await insertFact({
        externalId: unmapped,
        metricDate: '2028-07-06',
        spend: '5.000000',
        impressions: '50',
        leads: '3',
      });

      const unknown = await bucketFor('unknown', '2028-07-01', '2028-07-31');

      expect(unknown?.spend).toBe('15.000000');
      expect(unknown?.impressions).toBe('150');
      expect(unknown?.providerLeads).toBe('5');
      // The decimal column that used to throw.
      expect(unknown?.conversions).toBe('0.000000');
      expect(unknown?.factDays).toBe(2);
    });
  });
});
