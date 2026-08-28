import { randomUUID } from 'node:crypto';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import { describePostgresIntegration } from '../../../testing/postgres-integration';
import type { SocialAdSyncRunStatus } from '../entities/social-ad-sync-run.entity';
import {
  decideRetention,
  type SocialAdRetentionCandidate,
} from '../sync/social-ad-retention.policy';
import { SocialAdRetentionConfigService } from './social-ad-retention-config.service';
import { SocialAdRetentionService } from './social-ad-retention.service';

/**
 * Retention against a real PostgreSQL.
 *
 * Four claims can only be settled here, and each is the kind that fails
 * silently in production because the evidence is what was deleted:
 *
 * - **The SQL predicate matches the pure policy.** Both are run over the same
 *   fixtures and compared row by row. They are two expressions of one rule —
 *   a `COALESCE` over jsonb and a TypeScript function — and nothing but this
 *   stops them drifting.
 * - **A completed backfill survives.** The planner derives the entire chain
 *   from these rows, so a sweep that removed them would make a connection
 *   whose history was fetched months ago re-fetch ninety days.
 * - **The facts are untouched.** `metrics_daily.sync_run_id` is
 *   `ON DELETE SET NULL`; whether Postgres honours that with a real row is not
 *   something a mock can answer.
 * - **The sweep is bounded and idempotent** against the real driver's return
 *   shape.
 *
 * Everything hangs off connection rows with random ids and is deleted in
 * `afterAll`. There is no TRUNCATE anywhere in this file.
 */
const run = describePostgresIntegration();

run('Social ad sync run retention against PostgreSQL', () => {
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const workspaceA = randomUUID();
  const workspaceB = randomUUID();
  const connectionA = randomUUID();
  const connectionB = randomUUID();

  const NOW = new Date('2026-08-28T12:00:00.000Z');

  let service: SocialAdRetentionService;

  function ageInDays(days: number): Date {
    return new Date(NOW.getTime() - days * 86_400_000);
  }

  type RunFixture = {
    runKind: string;
    status: SocialAdSyncRunStatus;
    finishedAt: Date | null;
    connectionId?: string;
    tenantId?: string;
    workspaceId?: string;
  };

  async function insertRun(fixture: RunFixture): Promise<string> {
    const id = randomUUID();

    await AgencyDataSource.query(
      `INSERT INTO social_ad_sync_runs
         ("id", "tenant_id", "workspace_id", "connection_id", "provider",
          "run_kind", "status", "idempotency_key", "finished_at", "window_end")
       VALUES ($1, $2, $3, $4, 'meta_ads', $5, $6, $7, $8, $9)`,
      [
        id,
        fixture.tenantId ?? tenantA,
        fixture.workspaceId ?? workspaceA,
        fixture.connectionId ?? connectionA,
        fixture.runKind,
        fixture.status,
        `retention-${id}`,
        fixture.finishedAt,
        // A window only matters to the backfill fixtures, where the planner
        // reads it back; harmless elsewhere.
        fixture.runKind === 'backfill' ? '2026-06-04' : null,
      ],
    );

    return id;
  }

  const clearRuns = () =>
    AgencyDataSource.query(
      `DELETE FROM social_ad_sync_runs WHERE connection_id = ANY($1::uuid[])`,
      [[connectionA, connectionB]],
    );

  const survivingIds = async (): Promise<string[]> => {
    const rows = await AgencyDataSource.query<{ id: string }[]>(
      `SELECT id FROM social_ad_sync_runs
        WHERE connection_id = ANY($1::uuid[]) ORDER BY id`,
      [[connectionA, connectionB]],
    );

    return rows.map((row) => row.id);
  };

  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();

    for (const [id, tenantId, workspaceId] of [
      [connectionA, tenantA, workspaceA],
      [connectionB, tenantB, workspaceB],
    ]) {
      await AgencyDataSource.query(
        `INSERT INTO social_ad_account_connections
           ("id", "tenant_id", "workspace_id", "provider", "external_account_id")
         VALUES ($1, $2, $3, 'meta_ads', $4)`,
        [id, tenantId, workspaceId, `act_retention_${id.slice(0, 8)}`],
      );
    }

    service = new SocialAdRetentionService(
      AgencyDataSource,
      new SocialAdRetentionConfigService(),
    );
  });

  afterAll(async () => {
    try {
      await AgencyDataSource.query(
        `DELETE FROM social_ad_account_connections WHERE id = ANY($1::uuid[])`,
        [[connectionA, connectionB]],
      );
    } finally {
      if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
    }
  });

  beforeEach(async () => {
    delete process.env.SOCIAL_ADS_RETENTION_ENABLED;
    delete process.env.SOCIAL_ADS_RETENTION_BATCH_SIZE;

    await clearRuns();
  });

  describe('the boundaries, in the database', () => {
    const cases: {
      label: string;
      fixture: RunFixture;
      eligible: boolean;
    }[] = [
      {
        label: 'succeeded intraday at 31 days',
        fixture: {
          runKind: 'intraday',
          status: 'succeeded',
          finishedAt: ageInDays(31),
        },
        eligible: true,
      },
      {
        label: 'succeeded intraday at 29 days',
        fixture: {
          runKind: 'intraday',
          status: 'succeeded',
          finishedAt: ageInDays(29),
        },
        eligible: false,
      },
      {
        label: 'succeeded daily at 91 days',
        fixture: {
          runKind: 'daily',
          status: 'succeeded',
          finishedAt: ageInDays(91),
        },
        eligible: true,
      },
      {
        label: 'succeeded daily at 89 days',
        fixture: {
          runKind: 'daily',
          status: 'succeeded',
          finishedAt: ageInDays(89),
        },
        eligible: false,
      },
      {
        label: 'succeeded manual at 91 days',
        fixture: {
          runKind: 'manual',
          status: 'succeeded',
          finishedAt: ageInDays(91),
        },
        eligible: true,
      },
      {
        label: 'succeeded manual at 89 days',
        fixture: {
          runKind: 'manual',
          status: 'succeeded',
          finishedAt: ageInDays(89),
        },
        eligible: false,
      },
      {
        label: 'succeeded entities at 91 days',
        fixture: {
          runKind: 'entities',
          status: 'succeeded',
          finishedAt: ageInDays(91),
        },
        eligible: true,
      },
      {
        label: 'succeeded entities at 89 days',
        fixture: {
          runKind: 'entities',
          status: 'succeeded',
          finishedAt: ageInDays(89),
        },
        eligible: false,
      },
      {
        label: 'partial at 181 days',
        fixture: {
          runKind: 'daily',
          status: 'partial',
          finishedAt: ageInDays(181),
        },
        eligible: true,
      },
      {
        label: 'partial at 179 days',
        fixture: {
          runKind: 'daily',
          status: 'partial',
          finishedAt: ageInDays(179),
        },
        eligible: false,
      },
      {
        label: 'failed at 181 days',
        fixture: {
          runKind: 'daily',
          status: 'failed',
          finishedAt: ageInDays(181),
        },
        eligible: true,
      },
      {
        label: 'failed at 179 days',
        fixture: {
          runKind: 'daily',
          status: 'failed',
          finishedAt: ageInDays(179),
        },
        eligible: false,
      },
      {
        label: 'dead_letter at 181 days',
        fixture: {
          runKind: 'daily',
          status: 'dead_letter',
          finishedAt: ageInDays(181),
        },
        eligible: true,
      },
      {
        label: 'dead_letter at 179 days',
        fixture: {
          runKind: 'daily',
          status: 'dead_letter',
          finishedAt: ageInDays(179),
        },
        eligible: false,
      },
      {
        label: 'cancelled at 181 days',
        fixture: {
          runKind: 'daily',
          status: 'cancelled',
          finishedAt: ageInDays(181),
        },
        eligible: true,
      },
      {
        label: 'queued from a year ago',
        fixture: {
          runKind: 'daily',
          status: 'queued',
          finishedAt: null,
        },
        eligible: false,
      },
      {
        label: 'processing from a year ago',
        fixture: {
          runKind: 'daily',
          status: 'processing',
          finishedAt: ageInDays(365),
        },
        eligible: false,
      },
      {
        label: 'terminal but with no finish timestamp',
        fixture: {
          runKind: 'daily',
          status: 'succeeded',
          finishedAt: null,
        },
        eligible: false,
      },
      {
        label: 'dead-lettered intraday at 90 days (status beats kind)',
        fixture: {
          runKind: 'intraday',
          status: 'dead_letter',
          finishedAt: ageInDays(90),
        },
        eligible: false,
      },
      {
        label: 'dead-lettered intraday at 181 days',
        fixture: {
          runKind: 'intraday',
          status: 'dead_letter',
          finishedAt: ageInDays(181),
        },
        eligible: true,
      },
      {
        label: 'succeeded backfill from ten years ago',
        fixture: {
          runKind: 'backfill',
          status: 'succeeded',
          finishedAt: ageInDays(3650),
        },
        eligible: false,
      },
      {
        label: 'dead-lettered backfill from ten years ago',
        fixture: {
          runKind: 'backfill',
          status: 'dead_letter',
          finishedAt: ageInDays(3650),
        },
        eligible: false,
      },
    ];

    it.each(cases)('$label', async ({ fixture, eligible }) => {
      const id = await insertRun(fixture);

      await service.sweep({ now: NOW });

      const survived = (await survivingIds()).includes(id);

      expect(survived).toBe(!eligible);
    });

    it('agrees with the pure policy on every fixture at once', async () => {
      // The SQL and `decideRetention` are two expressions of one rule. Running
      // both over the same rows is what keeps them from drifting apart.
      const ids = new Map<string, SocialAdRetentionCandidate>();

      for (const { fixture } of cases) {
        ids.set(await insertRun(fixture), {
          runKind: fixture.runKind,
          status: fixture.status,
          finishedAt: fixture.finishedAt,
        });
      }

      await service.sweep({ now: NOW });

      const survivors = new Set(await survivingIds());

      for (const [id, candidate] of ids) {
        expect(survivors.has(id)).toBe(decideRetention(candidate, NOW).retain);
      }
    });
  });

  describe('the initial backfill', () => {
    /**
     * Thirteen succeeded chunks, all older than every retention period.
     *
     * This is the test the whole exemption exists for. The chain stores no
     * flag: `SocialAdBackfillPlanner` reads exactly these rows to answer "does
     * this connection need history?", so if the sweep took them, a connection
     * backfilled last year would report `not_started` and re-fetch ninety days
     * — and a reconnect would do it again.
     */
    async function seedCompleteBackfill(): Promise<string[]> {
      const ids: string[] = [];

      for (let index = 0; index < 13; index += 1) {
        ids.push(
          await insertRun({
            runKind: 'backfill',
            status: 'succeeded',
            finishedAt: ageInDays(400 + index),
          }),
        );
      }

      return ids;
    }

    it('keeps all thirteen chunks, however old', async () => {
      const ids = await seedCompleteBackfill();

      await service.sweep({ now: NOW });

      const survivors = new Set(await survivingIds());

      for (const id of ids) expect(survivors.has(id)).toBe(true);
    });

    it('leaves the chain exactly as the planner reads it', async () => {
      await seedCompleteBackfill();

      const before = await readChain();

      await service.sweep({ now: NOW });

      // Same anchor, same count, same statuses: the planner cannot tell a
      // sweep happened, which is the only acceptable outcome.
      expect(await readChain()).toEqual(before);
    });

    it('keeps a stalled chunk, so the stall stays visible', async () => {
      // Deleting the failure would not make the chunk covered — it would make
      // it `not_started`, turning a visible stall into a silent hole.
      const id = await insertRun({
        runKind: 'backfill',
        status: 'dead_letter',
        finishedAt: ageInDays(400),
      });

      await service.sweep({ now: NOW });

      expect(await survivingIds()).toContain(id);
    });

    /** The planner's own query, as the planner writes it. */
    async function readChain() {
      return AgencyDataSource.query(
        `SELECT to_char(window_end, 'YYYY-MM-DD') AS until, status
           FROM social_ad_sync_runs
          WHERE connection_id = $1
            AND run_kind = 'backfill'
            AND window_end IS NOT NULL
          ORDER BY window_end DESC, created_at ASC, id ASC`,
        [connectionA],
      );
    }
  });

  describe('what the sweep must never reach', () => {
    it('leaves the facts in place and only clears their provenance', async () => {
      // `ON DELETE SET NULL`, not cascade. A fact is the product; the run that
      // wrote it is a log entry.
      const runId = await insertRun({
        runKind: 'daily',
        status: 'succeeded',
        finishedAt: ageInDays(400),
      });
      const factId = randomUUID();

      await AgencyDataSource.query(
        `INSERT INTO social_ad_metrics_daily
           ("id", "tenant_id", "workspace_id", "connection_id", "provider",
            "entity_level", "entity_external_id", "metric_date",
            "account_timezone", "sync_run_id")
         VALUES ($1, $2, $3, $4, 'meta_ads', 'account', 'act_retention',
                 '2026-01-15', 'America/Sao_Paulo', $5)`,
        [factId, tenantA, workspaceA, connectionA, runId],
      );

      try {
        await service.sweep({ now: NOW });

        const [fact] = await AgencyDataSource.query<
          { id: string; sync_run_id: string | null }[]
        >(`SELECT id, sync_run_id FROM social_ad_metrics_daily WHERE id = $1`, [
          factId,
        ]);

        expect(fact).toBeDefined();
        expect(fact.sync_run_id).toBeNull();
      } finally {
        await AgencyDataSource.query(
          `DELETE FROM social_ad_metrics_daily WHERE id = $1`,
          [factId],
        );
      }
    });

    it('leaves entities untouched, archived ones included', async () => {
      const entityId = randomUUID();

      await AgencyDataSource.query(
        `INSERT INTO social_ad_entities
           ("id", "tenant_id", "workspace_id", "connection_id", "provider",
            "entity_level", "external_id", "name", "archived_at")
         VALUES ($1, $2, $3, $4, 'meta_ads', 'campaign', 'camp_retention',
                 'Arquivada', now())`,
        [entityId, tenantA, workspaceA, connectionA],
      );

      try {
        await insertRun({
          runKind: 'daily',
          status: 'succeeded',
          finishedAt: ageInDays(400),
        });

        await service.sweep({ now: NOW });

        const rows = await AgencyDataSource.query<{ id: string }[]>(
          `SELECT id FROM social_ad_entities WHERE id = $1`,
          [entityId],
        );

        expect(rows).toHaveLength(1);
      } finally {
        await AgencyDataSource.query(
          `DELETE FROM social_ad_entities WHERE id = $1`,
          [entityId],
        );
      }
    });

    it('leaves connections untouched', async () => {
      await insertRun({
        runKind: 'daily',
        status: 'succeeded',
        finishedAt: ageInDays(400),
      });

      await service.sweep({ now: NOW });

      const rows = await AgencyDataSource.query<{ id: string }[]>(
        `SELECT id FROM social_ad_account_connections WHERE id = ANY($1::uuid[])`,
        [[connectionA, connectionB]],
      );

      expect(rows).toHaveLength(2);
    });
  });

  describe('freshness after a sweep', () => {
    /**
     * The endpoint must survive the disappearance of old operational runs.
     *
     * `latestSuccessfulDailyRun` and `latestSuccessfulIntradayRun` are read
     * straight off this table, so they legitimately become null once the runs
     * that produced them age out — but the metric dates come from the facts and
     * must not move, and the backfill block must still report `complete`.
     */
    it('keeps the backfill complete and the metric dates intact', async () => {
      for (let index = 0; index < 13; index += 1) {
        await insertRun({
          runKind: 'backfill',
          status: 'succeeded',
          finishedAt: ageInDays(400 + index),
        });
      }

      await insertRun({
        runKind: 'daily',
        status: 'succeeded',
        finishedAt: ageInDays(400),
      });

      const factId = randomUUID();

      await AgencyDataSource.query(
        `INSERT INTO social_ad_metrics_daily
           ("id", "tenant_id", "workspace_id", "connection_id", "provider",
            "entity_level", "entity_external_id", "metric_date",
            "account_timezone")
         VALUES ($1, $2, $3, $4, 'meta_ads', 'account', 'act_retention',
                 '2026-08-20', 'America/Sao_Paulo')`,
        [factId, tenantA, workspaceA, connectionA],
      );

      try {
        await service.sweep({ now: NOW });

        const [chain] = await AgencyDataSource.query<{ chunks: string }[]>(
          `SELECT count(*)::text AS chunks FROM social_ad_sync_runs
            WHERE connection_id = $1 AND run_kind = 'backfill'
              AND status = 'succeeded'`,
          [connectionA],
        );

        expect(chain.chunks).toBe('13');

        const [metrics] = await AgencyDataSource.query<
          { latest: string | null }[]
        >(
          `SELECT to_char(MAX(metric_date), 'YYYY-MM-DD') AS latest
             FROM social_ad_metrics_daily WHERE connection_id = $1`,
          [connectionA],
        );

        // Still read from the facts, not from the runs.
        expect(metrics.latest).toBe('2026-08-20');

        // The operational run is gone, which the freshness view reports as a
        // null latest daily run rather than as an error.
        const [daily] = await AgencyDataSource.query<
          { finished_at: string | null }[]
        >(
          `SELECT MAX(finished_at) AS finished_at FROM social_ad_sync_runs
            WHERE connection_id = $1 AND run_kind = 'daily'
              AND status = 'succeeded'`,
          [connectionA],
        );

        expect(daily.finished_at).toBeNull();
      } finally {
        await AgencyDataSource.query(
          `DELETE FROM social_ad_metrics_daily WHERE id = $1`,
          [factId],
        );
      }
    });
  });

  describe('batching, idempotency and scope', () => {
    it('deletes at most one batch per call', async () => {
      process.env.SOCIAL_ADS_RETENTION_BATCH_SIZE = '2';

      for (let index = 0; index < 5; index += 1) {
        await insertRun({
          runKind: 'daily',
          status: 'succeeded',
          finishedAt: ageInDays(200 + index),
        });
      }

      const first = await service.sweep({ now: NOW });

      expect(first.deleted).toBe(2);
      expect(first.hadMore).toBe(true);
      expect(await survivingIds()).toHaveLength(3);
    });

    it('deletes nothing on a second sweep', async () => {
      await insertRun({
        runKind: 'daily',
        status: 'succeeded',
        finishedAt: ageInDays(400),
      });

      const first = await service.sweep({ now: NOW });
      const second = await service.sweep({ now: NOW });

      expect(first.deleted).toBe(1);
      expect(second.deleted).toBe(0);
      expect(second.hadMore).toBe(false);
    });

    it('deletes nothing at all when the switch is off', async () => {
      process.env.SOCIAL_ADS_RETENTION_ENABLED = 'false';

      const id = await insertRun({
        runKind: 'daily',
        status: 'succeeded',
        finishedAt: ageInDays(400),
      });

      const result = await service.sweep({ now: NOW });

      expect(result.skipped).toBe('disabled');
      expect(await survivingIds()).toContain(id);
    });

    it('sweeps several tenants and connections in one batch', async () => {
      // Housekeeping is global: there is no request and no tenant scope. What
      // matters is that the rule reads only kind, status and age — none of
      // which is tenant-specific — and that no FK is left inconsistent.
      const oldA = await insertRun({
        runKind: 'daily',
        status: 'succeeded',
        finishedAt: ageInDays(400),
      });
      const oldB = await insertRun({
        runKind: 'daily',
        status: 'succeeded',
        finishedAt: ageInDays(400),
        connectionId: connectionB,
        tenantId: tenantB,
        workspaceId: workspaceB,
      });
      const freshB = await insertRun({
        runKind: 'daily',
        status: 'succeeded',
        finishedAt: ageInDays(1),
        connectionId: connectionB,
        tenantId: tenantB,
        workspaceId: workspaceB,
      });

      const result = await service.sweep({ now: NOW });

      expect(result.deleted).toBe(2);

      const survivors = await survivingIds();

      expect(survivors).toContain(freshB);
      expect(survivors).not.toContain(oldA);
      expect(survivors).not.toContain(oldB);
    });

    it('reports what it deleted, grouped by kind and status', async () => {
      await insertRun({
        runKind: 'intraday',
        status: 'succeeded',
        finishedAt: ageInDays(60),
      });
      await insertRun({
        runKind: 'daily',
        status: 'failed',
        finishedAt: ageInDays(200),
      });

      const result = await service.sweep({ now: NOW });

      expect(result.byBucket).toEqual({
        'intraday:succeeded': 1,
        'daily:failed': 1,
      });
    });
  });
});
