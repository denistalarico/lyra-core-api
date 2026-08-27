/* eslint-disable @typescript-eslint/no-unsafe-assignment -- raw SQL rows are untyped by construction. */
import { randomUUID } from 'node:crypto';
import type { Repository } from 'typeorm';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import type { ResolvedAdCredential } from '../credentials/resolved-ad-credential';
import type { SocialAdCredentialResolver } from '../credentials/social-ad-credential.resolver';
import { SocialAdSyncRunEntity } from '../entities/social-ad-sync-run.entity';
import { buildSyncIdempotencyKey } from '../sync/social-ad-sync-run.contract';
import type { SocialAdSyncConfigService } from './social-ad-sync-config.service';
import {
  EMPTY_RUN_COUNTERS,
  SocialAdSyncRunService,
} from './social-ad-sync-run.service';
import { describePostgresIntegration } from '../../../testing/postgres-integration';

/**
 * The queue against a real PostgreSQL.
 *
 * The properties this file exists for cannot be observed through a mock, and
 * three of them cannot even be observed inside a single transaction:
 *
 * - `FOR UPDATE SKIP LOCKED` partitioning work between two workers is a
 *   statement about two *concurrent* transactions. One rolled-back transaction
 *   would have nothing to skip.
 * - The in-flight unique index is partial. Whether a second enqueue collides
 *   depends on the index's `WHERE` clause, which is Postgres', not ours.
 * - A guarded terminal update either matches a row or does not, and only the
 *   database can say which.
 *
 * So these tests commit, and clean up after themselves: everything hangs off
 * one connection row with a random id, and dropping that row cascades to every
 * run this file created.
 */
const run = describePostgresIntegration();

run('SocialAdSyncRunService against PostgreSQL', () => {
  const connectionId = randomUUID();
  const tenantId = randomUUID();
  const workspaceId = randomUUID();

  let repository: Repository<SocialAdSyncRunEntity>;
  let service: SocialAdSyncRunService;
  let other: SocialAdSyncRunService;

  const credential = {
    connectionId,
    tenantId,
    workspaceId,
    agencyClientId: null,
    provider: 'meta_ads',
    externalAccountId: 'act_dry_run',
    currency: 'BRL',
    timezone: 'America/Sao_Paulo',
  } as unknown as ResolvedAdCredential;

  /** A second instance stands in for a second process. */
  function build() {
    return new SocialAdSyncRunService(
      repository,
      AgencyDataSource,
      {
        resolve: () => Promise.resolve(credential),
      } as unknown as SocialAdCredentialResolver,
      { enabled: true } as SocialAdSyncConfigService,
    );
  }

  async function insertRun(overrides: Record<string, unknown> = {}) {
    const id = randomUUID();

    await AgencyDataSource.query(
      `INSERT INTO social_ad_sync_runs
         ("id", "tenant_id", "workspace_id", "connection_id", "provider",
          "run_kind", "status", "idempotency_key", "available_at", "attempts",
          "max_attempts", "locked_at", "locked_by", "window_start", "window_end")
       VALUES ($1, $2, $3, $4, 'meta_ads', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        id,
        tenantId,
        workspaceId,
        connectionId,
        overrides.runKind ?? 'manual',
        overrides.status ?? 'queued',
        overrides.idempotencyKey ?? `key-${id}`,
        overrides.availableAt ?? new Date(),
        overrides.attempts ?? 0,
        overrides.maxAttempts ?? 5,
        overrides.lockedAt ?? null,
        overrides.lockedBy ?? null,
        overrides.windowStart ?? '2026-07-18',
        overrides.windowEnd ?? '2026-07-22',
      ],
    );

    return id;
  }

  const rowOf = async (id: string) => {
    const rows: unknown[] = await AgencyDataSource.query(
      `SELECT "status", "attempts", "locked_by", "locked_at", "available_at",
              "started_at", "finished_at", "rows_written", "entities_written",
              "api_calls", "last_error", "failed_segments"
         FROM social_ad_sync_runs WHERE id = $1`,
      [id],
    );

    return rows[0] as {
      status: string;
      attempts: number;
      locked_by: string | null;
      locked_at: Date | null;
      available_at: Date;
      started_at: Date | null;
      finished_at: Date | null;
      rows_written: number;
      entities_written: number;
      api_calls: number;
      last_error: string | null;
      failed_segments: unknown[];
    };
  };

  /** Nothing else in the table may leak into a claim. */
  const clearQueue = () =>
    AgencyDataSource.query(
      `DELETE FROM social_ad_sync_runs WHERE connection_id = $1`,
      [connectionId],
    );

  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();

    repository = AgencyDataSource.getRepository(SocialAdSyncRunEntity);

    await AgencyDataSource.query(
      `INSERT INTO social_ad_account_connections
         ("id", "tenant_id", "workspace_id", "provider", "external_account_id")
       VALUES ($1, $2, $3, 'meta_ads', 'act_dry_run')`,
      [connectionId, tenantId, workspaceId],
    );

    service = build();
    other = build();
  });

  afterAll(async () => {
    try {
      // Cascades to every run this file created.
      await AgencyDataSource.query(
        `DELETE FROM social_ad_account_connections WHERE id = $1`,
        [connectionId],
      );
    } finally {
      if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
    }
  });

  beforeEach(clearQueue);

  describe('enqueue', () => {
    const intent = {
      tenantId,
      workspaceId,
      agencyClientId: null,
      connectionId,
      since: '2026-08-01',
      until: '2026-08-25',
      requestedById: null,
      now: new Date('2026-08-27T01:00:00.000Z'),
    };

    it('creates one run', async () => {
      const result = await service.request(intent);

      expect(result.deduplicated).toBe(false);
      expect(result.run.status).toBe('queued');
      expect(result.run.since).toBe('2026-08-01');
    });

    it('answers a second identical request with the first run', async () => {
      const first = await service.request(intent);
      const second = await other.request(intent);

      // The partial unique index is the arbiter, so this holds across
      // processes and not merely inside one.
      expect(second.deduplicated).toBe(true);
      expect(second.run.id).toBe(first.run.id);

      const [{ count }] = await AgencyDataSource.query(
        `SELECT count(*)::int AS count FROM social_ad_sync_runs WHERE connection_id = $1`,
        [connectionId],
      );

      expect(count).toBe(1);
    });

    it('collapses two simultaneous requests into one run', async () => {
      const results = await Promise.all([
        service.request(intent),
        other.request(intent),
      ]);

      // The double-click, raced. A check-then-insert would let both callers
      // find nothing and both insert.
      expect(new Set(results.map((result) => result.run.id)).size).toBe(1);
      expect(results.filter((result) => result.deduplicated)).toHaveLength(1);
    });

    it('lets the same window run again once the first one is over', async () => {
      const first = await service.request(intent);

      await AgencyDataSource.query(
        `UPDATE social_ad_sync_runs SET status = 'succeeded' WHERE id = $1`,
        [first.run.id],
      );

      const second = await service.request(intent);

      // The index covers `queued` and `processing` only: a re-run a week later
      // is a legitimate request, not a duplicate.
      expect(second.deduplicated).toBe(false);
      expect(second.run.id).not.toBe(first.run.id);
    });

    it('keeps a different window apart from this one', async () => {
      await service.request(intent);
      const other7 = await service.request({ ...intent, since: '2026-07-01' });

      expect(other7.deduplicated).toBe(false);
    });

    it('knows when an intent has already been attempted to a conclusion', async () => {
      const key = buildSyncIdempotencyKey({
        connectionId,
        runKind: 'daily',
        windowStart: '2026-08-19',
        windowEnd: '2026-08-25',
        entityLevels: ['account', 'campaign', 'adset', 'ad'],
      });

      expect(await service.hasSettledRun(connectionId, key)).toBe(false);

      await insertRun({ status: 'dead_letter', idempotencyKey: key });

      // Failure counts: a daily run that dead-lettered at 04:00 must not be
      // re-enqueued at 05:00 and every hour after.
      expect(await service.hasSettledRun(connectionId, key)).toBe(true);
    });
  });

  describe('claim', () => {
    it('takes the lock, spends an attempt and stamps the start', async () => {
      const id = await insertRun();

      const claimed = await service.claim({ workerId: 'host-a', limit: 5 });

      expect(claimed.map((row) => row.id)).toEqual([id]);

      const row = await rowOf(id);

      expect(row.status).toBe('processing');
      expect(row.attempts).toBe(1);
      expect(row.locked_by).toBe('host-a');
      expect(row.locked_at).not.toBeNull();
      expect(row.started_at).not.toBeNull();
    });

    it('never hands the same run to two workers', async () => {
      const ids = [
        await insertRun(),
        await insertRun(),
        await insertRun(),
        await insertRun(),
      ];

      const [mine, theirs] = await Promise.all([
        service.claim({ workerId: 'host-a', limit: 2 }),
        other.claim({ workerId: 'host-b', limit: 2 }),
      ]);

      const claimed = [...mine, ...theirs].map((row) => row.id);

      // Disjoint *and* complete: `SKIP LOCKED` partitions the work. Without it
      // the second transaction would block on the first one's rows and then
      // claim them anyway once it committed.
      expect(new Set(claimed).size).toBe(claimed.length);
      expect(claimed.sort()).toEqual([...ids].sort());
    });

    it('leaves a run that is not due yet', async () => {
      await insertRun({ availableAt: new Date(Date.now() + 60_000) });

      // `available_at` is the whole backoff mechanism; a claim that ignored it
      // would turn every rescheduled run into an immediate retry.
      expect(await service.claim({ workerId: 'host-a', limit: 5 })).toEqual([]);
    });

    it('leaves a run another worker is already processing', async () => {
      await insertRun({
        status: 'processing',
        lockedAt: new Date(),
        lockedBy: 'host-b',
      });

      expect(await service.claim({ workerId: 'host-a', limit: 5 })).toEqual([]);
    });

    it('does not sweep an expired lease into a claim', async () => {
      await insertRun({
        status: 'processing',
        attempts: 5,
        lockedAt: new Date(Date.now() - 60 * 60_000),
        lockedBy: 'host-dead',
      });

      // Recovery is a separate step on purpose: a claim that also picked up
      // expired rows would resurrect them without consulting `max_attempts`,
      // and a run that already failed five times would retry forever.
      expect(await service.claim({ workerId: 'host-a', limit: 5 })).toEqual([]);
    });
  });

  describe('recoverStale', () => {
    it('requeues a run whose worker died with attempts to spare', async () => {
      const id = await insertRun({
        status: 'processing',
        attempts: 2,
        lockedAt: new Date(Date.now() - 20 * 60_000),
        lockedBy: 'host-dead',
      });

      expect(await service.recoverStale()).toMatchObject({ requeued: 1 });

      const row = await rowOf(id);

      // Available immediately: the lease expiring is itself evidence that time
      // has passed.
      expect(row.status).toBe('queued');
      expect(row.locked_by).toBeNull();
      expect(row.last_error).toBe('lease_expired');
      expect(row.available_at.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('dead-letters a run that has spent its attempts', async () => {
      const id = await insertRun({
        status: 'processing',
        attempts: 5,
        maxAttempts: 5,
        lockedAt: new Date(Date.now() - 20 * 60_000),
        lockedBy: 'host-dead',
      });

      expect(await service.recoverStale()).toMatchObject({ deadLettered: 1 });

      const row = await rowOf(id);

      expect(row.status).toBe('dead_letter');
      expect(row.finished_at).not.toBeNull();
    });

    it('leaves a lease that is still good', async () => {
      const id = await insertRun({
        status: 'processing',
        lockedAt: new Date(),
        lockedBy: 'host-b',
      });

      expect(await service.recoverStale()).toEqual({
        requeued: 0,
        deadLettered: 0,
      });
      expect((await rowOf(id)).status).toBe('processing');
    });

    it('never touches a run that already finished', async () => {
      const id = await insertRun({
        status: 'succeeded',
        lockedAt: new Date(Date.now() - 60 * 60_000),
      });

      await service.recoverStale();

      expect((await rowOf(id)).status).toBe('succeeded');
    });
  });

  describe('finishing a run', () => {
    it('accumulates counters and releases the lock', async () => {
      const id = await insertRun();
      await service.claim({ workerId: 'host-a', limit: 1 });

      await service.markSucceeded({
        runId: id,
        lockedBy: 'host-a',
        counters: {
          rowsWritten: 10,
          rowsSkipped: 1,
          entitiesWritten: 12,
          apiCalls: 6,
        },
        failedSegments: [],
        lastError: null,
      });

      const row = await rowOf(id);

      expect(row.status).toBe('succeeded');
      expect(row.rows_written).toBe(10);
      expect(row.entities_written).toBe(12);
      expect(row.api_calls).toBe(6);
      expect(row.locked_by).toBeNull();
      expect(row.finished_at).not.toBeNull();
    });

    it('adds a retry to what the earlier attempt already did', async () => {
      const id = await insertRun();

      await service.claim({ workerId: 'host-a', limit: 1 });
      await service.reschedule({
        runId: id,
        lockedBy: 'host-a',
        counters: {
          rowsWritten: 0,
          rowsSkipped: 0,
          entitiesWritten: 12,
          apiCalls: 4,
        },
        failedSegments: [
          { segment: 'campaign_insights', errorCode: 'meta_rate_limited' },
        ],
        lastError: 'meta_rate_limited',
        availableAt: new Date(Date.now() - 1_000),
      });

      await service.claim({ workerId: 'host-a', limit: 1 });
      await service.markSucceeded({
        runId: id,
        lockedBy: 'host-a',
        counters: {
          rowsWritten: 5,
          rowsSkipped: 0,
          entitiesWritten: 0,
          apiCalls: 1,
        },
      });

      const row = await rowOf(id);

      // The question the column answers is "what did this run do", and the
      // hierarchy the first attempt wrote is part of that.
      expect(row.entities_written).toBe(12);
      expect(row.rows_written).toBe(5);
      expect(row.api_calls).toBe(5);
      expect(row.attempts).toBe(2);
    });

    it('keeps a rescheduled run unfinished', async () => {
      const id = await insertRun();
      await service.claim({ workerId: 'host-a', limit: 1 });

      const availableAt = new Date(Date.now() + 5 * 60_000);

      await service.reschedule({
        runId: id,
        lockedBy: 'host-a',
        counters: EMPTY_RUN_COUNTERS,
        failedSegments: [
          { segment: 'campaign_insights', errorCode: 'meta_rate_limited' },
        ],
        lastError: 'meta_rate_limited',
        availableAt,
      });

      const row = await rowOf(id);

      expect(row.status).toBe('queued');
      // A finish timestamp on a row that will run again would make the history
      // read as a completed attempt.
      expect(row.finished_at).toBeNull();
      expect(row.available_at.getTime()).toBeCloseTo(availableAt.getTime(), -3);
      expect(row.failed_segments).toEqual([
        { segment: 'campaign_insights', errorCode: 'meta_rate_limited' },
      ]);
    });

    it('refuses a result from a worker whose run was taken away', async () => {
      const id = await insertRun({
        status: 'processing',
        attempts: 1,
        lockedAt: new Date(Date.now() - 60 * 60_000),
        lockedBy: 'host-dead',
      });

      await service.recoverStale();
      await other.claim({ workerId: 'host-b', limit: 1 });

      // The paused process wakes up and reports success for an attempt that was
      // abandoned. Applying it would overwrite a live attempt with the result
      // of a dead one.
      const applied = await service.markSucceeded({
        runId: id,
        lockedBy: 'host-dead',
        counters: {
          rowsWritten: 999,
          rowsSkipped: 0,
          entitiesWritten: 0,
          apiCalls: 0,
        },
      });

      expect(applied).toBe(false);

      const row = await rowOf(id);

      expect(row.status).toBe('processing');
      expect(row.locked_by).toBe('host-b');
      expect(row.rows_written).toBe(0);
    });
  });

  describe('listRecent', () => {
    it('never lists another tenant runs', async () => {
      await insertRun({ status: 'succeeded' });

      expect(
        await service.listRecent({
          tenantId: randomUUID(),
          workspaceId,
          agencyClientId: null,
          connectionId,
        }),
      ).toEqual([]);
    });

    it('lists this connection newest first, sanitized', async () => {
      await insertRun({ status: 'succeeded' });
      await insertRun({ status: 'failed' });

      const items = await service.listRecent({
        tenantId,
        workspaceId,
        agencyClientId: null,
        connectionId,
      });

      expect(items).toHaveLength(2);
      expect(items[0]).not.toHaveProperty('lockedBy');
      expect(items[0]).toHaveProperty('segments');
    });
  });
});
