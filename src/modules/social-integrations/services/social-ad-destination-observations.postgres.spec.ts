import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import {
  DESTINATION_INTERVALS_SQL,
  summarizeDestinationCoverage,
} from '../analytics/social-ad-destination-timeline';
import { SocialAdDestinationObservationEntity } from '../entities/social-ad-destination-observation.entity';
import { SocialAdDestinationObserverService } from './social-ad-destination-observer.service';
import type { SocialAdEntityWriteScope } from './social-ad-entity-writer.service';
import { describePostgresIntegration } from '../../../testing/postgres-integration';

/**
 * Destination history against a real PostgreSQL.
 *
 * Everything interesting here is a database guarantee. Whether a retried run
 * appends a duplicate depends on a partial unique index; whether deleting a
 * sync run destroys the evidence depends on `ON DELETE SET NULL`; and whether
 * `whatsapp → instagram_direct → whatsapp` survives depends on the uniqueness
 * rule *not* being keyed on the destination. A mock cannot be wrong about any
 * of those in the way Postgres can.
 */
const run = describePostgresIntegration();

run('Destination observations against PostgreSQL', () => {
  let queryRunner: QueryRunner;
  let observer: SocialAdDestinationObserverService;

  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const workspaceId = randomUUID();
  const otherWorkspaceId = randomUUID();
  const clientId = randomUUID();
  const connectionId = randomUUID();
  const otherConnectionId = randomUUID();

  const scope = (
    overrides: Partial<SocialAdEntityWriteScope> = {},
  ): SocialAdEntityWriteScope => ({
    tenantId,
    workspaceId,
    agencyClientId: null,
    connectionId,
    provider: 'meta_ads',
    ...overrides,
  });

  const select = async <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await queryRunner.query(sql, params)) as T[];

  /** Creates an ad set in the mirror and returns its internal id. */
  const createAdSet = async (
    externalId: string,
    where: { tenant?: string; workspace?: string; connection?: string } = {},
  ): Promise<string> => {
    const rows = await select<{ id: string }>(
      `INSERT INTO "social_ad_entities"
         ("tenant_id", "workspace_id", "connection_id", "provider",
          "entity_level", "external_id")
       VALUES ($1, $2, $3, 'meta_ads', 'adset', $4)
       RETURNING "id"`,
      [
        where.tenant ?? tenantId,
        where.workspace ?? workspaceId,
        where.connection ?? connectionId,
        externalId,
      ],
    );

    return rows[0].id;
  };

  const createRun = async (): Promise<string> => {
    const rows = await select<{ id: string }>(
      `INSERT INTO "social_ad_sync_runs"
         ("tenant_id", "workspace_id", "connection_id", "provider",
          "run_kind", "idempotency_key")
       VALUES ($1, $2, $3, 'meta_ads', 'daily', $4)
       RETURNING "id"`,
      [tenantId, workspaceId, connectionId, `key-${randomUUID()}`],
    );

    return rows[0].id;
  };

  const historyOf = (adEntityId: string) =>
    select<{
      destination_type: string;
      destination_raw: string | null;
      observed_at: Date;
      sync_run_id: string | null;
    }>(
      `SELECT "destination_type", "destination_raw", "observed_at", "sync_run_id"
         FROM "social_ad_destination_observations"
        WHERE "ad_entity_id" = $1
        ORDER BY "observed_at" ASC`,
      [adEntityId],
    );

  const observe = (
    adEntityId: string,
    destinationType: string,
    destinationRaw: string | null,
    observedAt: string,
    syncRunId: string | null,
    overrideScope?: SocialAdEntityWriteScope,
  ) =>
    observer.record({
      scope: overrideScope ?? scope(),
      observations: [
        { adEntityId, destinationType, destinationRaw, hasEvidence: true },
      ],
      observedAt: new Date(observedAt),
      syncRunId,
    });

  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();

    queryRunner = AgencyDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    for (const [id, tenant, workspace] of [
      [connectionId, tenantId, workspaceId],
      [otherConnectionId, otherTenantId, otherWorkspaceId],
    ]) {
      await queryRunner.query(
        `INSERT INTO "social_ad_account_connections"
           ("id", "tenant_id", "workspace_id", "provider", "external_account_id")
         VALUES ($1, $2, $3, 'meta_ads', 'act_dry_run')`,
        [id, tenant, workspace],
      );
    }

    observer = new SocialAdDestinationObserverService(
      queryRunner.manager.getRepository(SocialAdDestinationObservationEntity),
    );
  });

  afterAll(async () => {
    if (queryRunner?.isTransactionActive)
      await queryRunner.rollbackTransaction();
    await queryRunner?.release();
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  describe('recording', () => {
    it('creates the first observation and does not repeat it', async () => {
      const adSet = await createAdSet('adset-first');

      const first = await observe(
        adSet,
        'whatsapp',
        'WHATSAPP',
        '2026-08-28T10:00:00Z',
        await createRun(),
      );
      const second = await observe(
        adSet,
        'whatsapp',
        'WHATSAPP',
        '2026-08-29T10:00:00Z',
        await createRun(),
      );

      expect(first).toBe(1);
      // A different run, the same answer: the history says nothing new.
      expect(second).toBe(0);
      expect(await historyOf(adSet)).toHaveLength(1);
    });

    it('preserves a whatsapp to instagram and back sequence', async () => {
      const adSet = await createAdSet('adset-cycle');

      await observe(
        adSet,
        'whatsapp',
        'WHATSAPP',
        '2026-08-01T10:00:00Z',
        await createRun(),
      );
      await observe(
        adSet,
        'instagram_direct',
        'INSTAGRAM_DIRECT',
        '2026-08-15T10:00:00Z',
        await createRun(),
      );
      await observe(
        adSet,
        'whatsapp',
        'WHATSAPP',
        '2026-09-01T10:00:00Z',
        await createRun(),
      );

      // The third leg is a real event. A UNIQUE(entity, destination) rule —
      // the tempting one — would have rejected it.
      expect(
        (await historyOf(adSet)).map((row) => row.destination_type),
      ).toEqual(['whatsapp', 'instagram_direct', 'whatsapp']);
    });

    it('never rewrites an earlier observation', async () => {
      const adSet = await createAdSet('adset-immutable');

      await observe(
        adSet,
        'whatsapp',
        'WHATSAPP',
        '2026-08-01T10:00:00Z',
        await createRun(),
      );
      const [before] = await historyOf(adSet);

      await observe(
        adSet,
        'messenger',
        'MESSENGER',
        '2026-08-20T10:00:00Z',
        await createRun(),
      );
      const [after] = await historyOf(adSet);

      expect(after.destination_type).toBe(before.destination_type);
      expect(after.observed_at).toEqual(before.observed_at);
    });

    it('records an explicit provider UNDEFINED', async () => {
      const adSet = await createAdSet('adset-undefined');

      await observe(
        adSet,
        'unknown',
        'UNDEFINED',
        '2026-08-28T10:00:00Z',
        await createRun(),
      );

      // An advertiser who configured no destination is a real observed state,
      // and the raw string is what distinguishes it from provider silence.
      expect(await historyOf(adSet)).toMatchObject([
        { destination_type: 'unknown', destination_raw: 'UNDEFINED' },
      ]);
    });

    it('records nothing when the provider did not answer', async () => {
      const adSet = await createAdSet('adset-silent');

      const written = await observer.record({
        scope: scope(),
        observations: [
          {
            adEntityId: adSet,
            destinationType: 'unknown',
            destinationRaw: null,
            hasEvidence: false,
          },
        ],
        observedAt: new Date('2026-08-28T10:00:00Z'),
        syncRunId: await createRun(),
      });

      // Silence must not close a known period.
      expect(written).toBe(0);
      expect(await historyOf(adSet)).toHaveLength(0);
    });
  });

  describe('idempotency', () => {
    it('does not duplicate when the same run is retried', async () => {
      const adSet = await createAdSet('adset-retry');
      const runId = await createRun();

      const first = await observe(
        adSet,
        'whatsapp',
        'WHATSAPP',
        '2026-08-28T10:00:00Z',
        runId,
      );
      // The same run executing again — a worker that crashed after writing.
      const retry = await observe(
        adSet,
        'whatsapp',
        'WHATSAPP',
        '2026-08-28T10:00:00Z',
        runId,
      );

      expect(first).toBe(1);
      expect(retry).toBe(0);
      expect(await historyOf(adSet)).toHaveLength(1);
    });

    /**
     * The concurrency case the read-then-write cannot cover on its own: two
     * workers on the same run both decide to append, and the unique index is
     * what makes the second one a no-op rather than a duplicate.
     */
    it('lets the constraint absorb a concurrent duplicate', async () => {
      const adSet = await createAdSet('adset-concurrent');
      const runId = await createRun();

      await queryRunner.query(
        `INSERT INTO "social_ad_destination_observations"
           ("tenant_id", "workspace_id", "connection_id", "ad_entity_id",
            "provider", "destination_type", "destination_raw", "observed_at",
            "sync_run_id")
         VALUES ($1, $2, $3, $4, 'meta_ads', 'whatsapp', 'WHATSAPP',
                 now(), $5)`,
        [tenantId, workspaceId, connectionId, adSet, runId],
      );

      /**
       * Inside a savepoint: the whole suite shares one transaction, and a
       * constraint violation aborts it. Without this the expected failure would
       * poison every test that runs afterwards.
       */
      await queryRunner.query('SAVEPOINT duplicate_attempt');

      await expect(
        queryRunner.query(
          `INSERT INTO "social_ad_destination_observations"
             ("tenant_id", "workspace_id", "connection_id", "ad_entity_id",
              "provider", "destination_type", "destination_raw", "observed_at",
              "sync_run_id")
           VALUES ($1, $2, $3, $4, 'meta_ads', 'whatsapp', 'WHATSAPP',
                   now(), $5)`,
          [tenantId, workspaceId, connectionId, adSet, runId],
        ),
      ).rejects.toThrow();

      await queryRunner.query('ROLLBACK TO SAVEPOINT duplicate_attempt');
    });

    it('still allows a manual sweep with no run to be recorded', async () => {
      const adSet = await createAdSet('adset-manual');

      // The unique index is partial on `sync_run_id IS NOT NULL`, so a manual
      // sweep is guarded by the change check instead of by the constraint.
      const written = await observe(
        adSet,
        'whatsapp',
        'WHATSAPP',
        '2026-08-28T10:00:00Z',
        null,
      );

      expect(written).toBe(1);
      expect(await historyOf(adSet)).toMatchObject([{ sync_run_id: null }]);
    });
  });

  describe('provenance', () => {
    /**
     * S2.9 deletes old runs as operational history. Losing the record of which
     * sweep saw a destination must never delete the evidence that it was seen.
     */
    it('survives the deletion of the sync run that made it', async () => {
      const adSet = await createAdSet('adset-run-deleted');
      const runId = await createRun();

      await observe(
        adSet,
        'whatsapp',
        'WHATSAPP',
        '2026-08-28T10:00:00Z',
        runId,
      );

      await queryRunner.query(
        `DELETE FROM "social_ad_sync_runs" WHERE "id" = $1`,
        [runId],
      );

      const history = await historyOf(adSet);

      expect(history).toHaveLength(1);
      expect(history[0].sync_run_id).toBeNull();
      expect(history[0].destination_type).toBe('whatsapp');
    });
  });

  describe('isolation', () => {
    it('keeps history scoped to its tenant, workspace and connection', async () => {
      const mine = await createAdSet('adset-scoped');
      const theirs = await createAdSet('adset-scoped', {
        tenant: otherTenantId,
        workspace: otherWorkspaceId,
        connection: otherConnectionId,
      });

      await observe(
        mine,
        'whatsapp',
        'WHATSAPP',
        '2026-08-28T10:00:00Z',
        await createRun(),
      );
      await observer.record({
        scope: scope({
          tenantId: otherTenantId,
          workspaceId: otherWorkspaceId,
          connectionId: otherConnectionId,
        }),
        observations: [
          {
            adEntityId: theirs,
            destinationType: 'messenger',
            destinationRaw: 'MESSENGER',
            hasEvidence: true,
          },
        ],
        observedAt: new Date('2026-08-28T10:00:00Z'),
        syncRunId: null,
      });

      // Same external id, two connections, two independent histories.
      expect(await historyOf(mine)).toMatchObject([
        { destination_type: 'whatsapp' },
      ]);
      expect(await historyOf(theirs)).toMatchObject([
        { destination_type: 'messenger' },
      ]);
    });

    it('carries the managed client onto the observation', async () => {
      const adSet = await createAdSet('adset-client');

      await observe(
        adSet,
        'instagram_direct',
        'INSTAGRAM_DIRECT',
        '2026-08-28T10:00:00Z',
        null,
        scope({ agencyClientId: clientId }),
      );

      const rows = await select<{ agency_client_id: string | null }>(
        `SELECT "agency_client_id" FROM "social_ad_destination_observations"
          WHERE "ad_entity_id" = $1`,
        [adSet],
      );

      expect(rows[0].agency_client_id).toBe(clientId);
    });
  });

  describe('the temporal query a future step will run', () => {
    /**
     * Last observation carried forward, and its honest boundary.
     *
     * The rule is: before the first observation the destination is unknown;
     * from an observation onward it is that destination until the next one.
     * What LOCF cannot do is locate the change — an observation on 15/09 after
     * one on 28/08 proves only that they differed somewhere in between.
     */
    const destinationOn = (adEntityId: string, onDate: string) =>
      select<{ destination_type: string | null; observed_at: Date | null }>(
        `SELECT observation."destination_type", observation."observed_at"
           FROM "social_ad_destination_observations" observation
          WHERE observation."ad_entity_id" = $1
            AND observation."observed_at" <= $2::timestamptz
          ORDER BY observation."observed_at" DESC
          LIMIT 1`,
        [adEntityId, onDate],
      );

    it('answers unknown for a period before the first observation', async () => {
      const adSet = await createAdSet('adset-temporal');

      await observe(
        adSet,
        'whatsapp',
        'WHATSAPP',
        '2026-08-15T10:00:00Z',
        await createRun(),
      );

      // July predates every observation. There is no evidence, and the query
      // returns none rather than reaching backwards for the current value.
      expect(await destinationOn(adSet, '2026-07-20T00:00:00Z')).toEqual([]);
    });

    it('carries the last observation forward between observations', async () => {
      const adSet = await createAdSet('adset-locf');

      await observe(
        adSet,
        'whatsapp',
        'WHATSAPP',
        '2026-08-01T10:00:00Z',
        await createRun(),
      );
      await observe(
        adSet,
        'instagram_direct',
        'INSTAGRAM_DIRECT',
        '2026-09-15T10:00:00Z',
        await createRun(),
      );

      expect(await destinationOn(adSet, '2026-08-20T00:00:00Z')).toMatchObject([
        { destination_type: 'whatsapp' },
      ]);
      expect(await destinationOn(adSet, '2026-09-20T00:00:00Z')).toMatchObject([
        { destination_type: 'instagram_direct' },
      ]);
    });

    /**
     * The uncertainty a reader must be able to declare: how stale the answer
     * is. A 45-day gap between observations means the boundary of a change
     * inside it is unknown to within 45 days.
     */
    it('exposes the gap that bounds the uncertainty', async () => {
      const adSet = await createAdSet('adset-uncertainty');

      await observe(
        adSet,
        'whatsapp',
        'WHATSAPP',
        '2026-08-01T10:00:00Z',
        await createRun(),
      );
      await observe(
        adSet,
        'instagram_direct',
        'INSTAGRAM_DIRECT',
        '2026-09-15T10:00:00Z',
        await createRun(),
      );

      const rows = await select<{ gap_days: string }>(
        `SELECT extract(day FROM (
                  observation."observed_at"
                  - lag(observation."observed_at")
                      OVER (ORDER BY observation."observed_at")
                ))::text AS gap_days
           FROM "social_ad_destination_observations" observation
          WHERE observation."ad_entity_id" = $1
          ORDER BY observation."observed_at"
          OFFSET 1`,
        [adSet],
      );

      // The change happened somewhere in these 45 days; nothing here claims to
      // know where.
      expect(rows[0].gap_days).toBe('45');
    });
  });

  describe('scope of the write', () => {
    it('writes nothing to the metrics table', async () => {
      const adSet = await createAdSet('adset-no-metrics');

      const before = await select<{ count: string }>(
        `SELECT count(*)::text AS count FROM "social_ad_metrics_daily"
          WHERE "connection_id" = $1`,
        [connectionId],
      );

      await observe(
        adSet,
        'whatsapp',
        'WHATSAPP',
        '2026-08-28T10:00:00Z',
        null,
      );

      const after = await select<{ count: string }>(
        `SELECT count(*)::text AS count FROM "social_ad_metrics_daily"
          WHERE "connection_id" = $1`,
        [connectionId],
      );

      expect(after[0].count).toBe(before[0].count);
    });
  });

  /**
   * The read side, against the same database that stores the evidence.
   *
   * The interval query is a window function over real rows, and its two
   * failure modes are invisible to a unit test: `LEAD()` partitioned wrongly
   * would leak one ad set's next observation into another's interval, and the
   * timezone conversion happens in Postgres, not in TypeScript.
   */
  describe('temporal resolution', () => {
    const intervalsFor = (timezone: string | null) =>
      select<{
        adEntityId: string;
        observedDestination: string;
        observedFrom: string;
        observedUntil: string | null;
      }>(DESTINATION_INTERVALS_SQL, [
        tenantId,
        workspaceId,
        connectionId,
        timezone,
      ]);

    it('closes each interval at the next observation', async () => {
      const adSet = await createAdSet(`adset-intervals-${randomUUID()}`);

      await observe(adSet, 'whatsapp', 'WHATSAPP', '2026-08-01T10:00:00Z', null);
      await observe(
        adSet,
        'instagram_direct',
        'INSTAGRAM_DIRECT',
        '2026-08-15T10:00:00Z',
        null,
      );

      const intervals = (await intervalsFor(null)).filter(
        (row) => row.adEntityId === adSet,
      );

      expect(intervals).toHaveLength(2);
      expect(intervals[0]).toMatchObject({
        observedDestination: 'whatsapp',
        observedFrom: '2026-08-01',
        observedUntil: '2026-08-15',
      });
      // The newest interval stays open: it is what we last saw, still.
      expect(intervals[1]).toMatchObject({
        observedDestination: 'instagram_direct',
        observedFrom: '2026-08-15',
        observedUntil: null,
      });
    });

    /**
     * The partition, asserted with two ad sets interleaved in time.
     *
     * A `LEAD()` without `PARTITION BY` would close the first ad set's interval
     * at the second ad set's observation — plausible-looking output, entirely
     * wrong, and impossible to see with a single-ad-set fixture.
     */
    it('never closes one ad set’s interval with another’s observation', async () => {
      const first = await createAdSet(`adset-a-${randomUUID()}`);
      const second = await createAdSet(`adset-b-${randomUUID()}`);

      await observe(first, 'whatsapp', 'WHATSAPP', '2026-08-01T10:00:00Z', null);
      await observe(
        second,
        'messenger',
        'MESSENGER',
        '2026-08-05T10:00:00Z',
        null,
      );

      const intervals = await intervalsFor(null);
      const firstIntervals = intervals.filter((row) => row.adEntityId === first);

      expect(firstIntervals).toHaveLength(1);
      expect(firstIntervals[0].observedUntil).toBeNull();
    });

    /**
     * The day boundary is the ad account's, not UTC.
     *
     * An observation at 00:30 UTC on the 11th is 21:30 on the 10th in São
     * Paulo. Cut in UTC it would open an interval a day late and misclassify a
     * day of spend.
     */
    it('cuts interval days in the account timezone', async () => {
      const adSet = await createAdSet(`adset-tz-${randomUUID()}`);

      await observe(adSet, 'whatsapp', 'WHATSAPP', '2026-08-11T00:30:00Z', null);

      const [utc] = (await intervalsFor(null)).filter(
        (row) => row.adEntityId === adSet,
      );
      const [local] = (await intervalsFor('America/Sao_Paulo')).filter(
        (row) => row.adEntityId === adSet,
      );

      expect(utc.observedFrom).toBe('2026-08-11');
      expect(local.observedFrom).toBe('2026-08-10');
    });

    /**
     * A return to a previous destination produces three intervals, not two.
     * The middle one must close — this is the case a uniqueness rule keyed on
     * `(entity, destination)` would have destroyed at write time.
     */
    it('resolves a return to a previous destination as its own interval', async () => {
      const adSet = await createAdSet(`adset-return-${randomUUID()}`);

      await observe(adSet, 'whatsapp', 'WHATSAPP', '2026-08-01T10:00:00Z', null);
      await observe(
        adSet,
        'instagram_direct',
        'INSTAGRAM_DIRECT',
        '2026-08-10T10:00:00Z',
        null,
      );
      await observe(adSet, 'whatsapp', 'WHATSAPP', '2026-08-20T10:00:00Z', null);

      const intervals = (await intervalsFor(null)).filter(
        (row) => row.adEntityId === adSet,
      );

      expect(intervals.map((row) => row.observedDestination)).toEqual([
        'whatsapp',
        'instagram_direct',
        'whatsapp',
      ]);
      expect(intervals[1].observedUntil).toBe('2026-08-20');
      expect(intervals[2].observedUntil).toBeNull();
    });

    it('returns nothing for a connection with no observations', async () => {
      const intervals = await select<{ adEntityId: string }>(
        DESTINATION_INTERVALS_SQL,
        [tenantId, workspaceId, otherConnectionId, null],
      );

      expect(intervals).toHaveLength(0);
    });

    /**
     * Coverage is computed from the intervals, so a window that opens before
     * the first observation reports the gap rather than hiding it.
     */
    it('reports the days no observation can speak for', async () => {
      const adSet = await createAdSet(`adset-coverage-${randomUUID()}`);

      await observe(adSet, 'whatsapp', 'WHATSAPP', '2026-08-03T10:00:00Z', null);

      const intervals = (await intervalsFor(null)).filter(
        (row) => row.adEntityId === adSet,
      );

      const coverage = summarizeDestinationCoverage({
        intervals: intervals.map((row) => ({
          adEntityId: row.adEntityId,
          observedDestination: row.observedDestination,
          observedRaw: null,
          observedFrom: row.observedFrom,
          observedUntil: row.observedUntil,
        })),
        days: ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04'],
        firstObservedAt: '2026-08-03T10:00:00.000Z',
        lastObservedAt: '2026-08-03T10:00:00.000Z',
      });

      expect(coverage.coveredDays).toBe(2);
      expect(coverage.unknownDays).toBe(2);
      expect(coverage.observationCadenceHours).toBe(24);
    });
  });
});
