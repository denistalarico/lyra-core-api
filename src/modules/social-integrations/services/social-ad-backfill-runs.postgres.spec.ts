import { randomUUID } from 'node:crypto';
import type { Repository } from 'typeorm';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import type { ResolvedAdCredential } from '../credentials/resolved-ad-credential';
import type { SocialAdCredentialResolver } from '../credentials/social-ad-credential.resolver';
import { SocialAdSyncRunEntity } from '../entities/social-ad-sync-run.entity';
import { buildSyncIdempotencyKey } from '../sync/social-ad-sync-run.contract';
import type { SocialAdSyncConfigService } from './social-ad-sync-config.service';
import { SocialAdSyncRunService } from './social-ad-sync-run.service';
import { describePostgresIntegration } from '../../../testing/postgres-integration';

/**
 * The two new run kinds against a real PostgreSQL.
 *
 * Three claims here can only be tested against the database itself:
 *
 * - `run_kind` accepts `backfill` and `intraday`. S2.2 left that column an
 *   unconstrained `varchar(40)` deliberately, and this is what proves no
 *   migration is owed — a CHECK nobody remembered would surface as a write
 *   failure at four in the morning rather than in review.
 * - The in-flight unique index treats two intraday buckets of one day as two
 *   intents. It is a *partial* index over a key we compose in TypeScript, so
 *   whether the 09:00 and 12:00 passes collide is Postgres' answer, not ours.
 * - A chain's state can be read back out of the run log. The planner stores no
 *   flag, so if `listBackfillChunkOutcomes` did not return what was written, a
 *   completed backfill would restart itself.
 *
 * These commit, and clean up after themselves: everything hangs off one
 * connection row with a random id, and deleting it cascades to every run.
 */
const run = describePostgresIntegration();

run('Backfill and intraday runs against PostgreSQL', () => {
  const connectionId = randomUUID();
  const tenantId = randomUUID();
  const workspaceId = randomUUID();

  let repository: Repository<SocialAdSyncRunEntity>;
  let service: SocialAdSyncRunService;

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

  const base = {
    tenantId,
    workspaceId,
    agencyClientId: null,
    connectionId,
    provider: 'meta_ads',
    requestedById: null,
  };

  const clearQueue = () =>
    AgencyDataSource.query(
      `DELETE FROM social_ad_sync_runs WHERE connection_id = $1`,
      [connectionId],
    );

  const settle = (runId: string, status: string) =>
    AgencyDataSource.query(
      `UPDATE social_ad_sync_runs SET status = $2, finished_at = now() WHERE id = $1`,
      [runId, status],
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

    service = new SocialAdSyncRunService(
      repository,
      AgencyDataSource,
      {
        resolve: () => Promise.resolve(credential),
      } as unknown as SocialAdCredentialResolver,
      { enabled: true } as SocialAdSyncConfigService,
    );
  });

  afterAll(async () => {
    try {
      await AgencyDataSource.query(
        `DELETE FROM social_ad_account_connections WHERE id = $1`,
        [connectionId],
      );
    } finally {
      if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
    }
  });

  beforeEach(clearQueue);

  describe('run kinds', () => {
    it('stores a backfill chunk', async () => {
      const result = await service.enqueue({
        ...base,
        runKind: 'backfill',
        windowStart: '2026-05-29',
        windowEnd: '2026-06-04',
        entityLevels: ['account', 'campaign'],
      });

      const row = await repository.findOneByOrFail({ id: result.run.id });

      expect(row.runKind).toBe('backfill');
      expect(row.status).toBe('queued');
      expect(row.entityLevels).toEqual(['account', 'campaign']);
    });

    it('stores an intraday pass', async () => {
      const result = await service.enqueue({
        ...base,
        runKind: 'intraday',
        windowStart: '2026-08-27',
        windowEnd: '2026-08-27',
        entityLevels: ['account', 'campaign'],
        bucket: 'h09',
      });

      const row = await repository.findOneByOrFail({ id: result.run.id });

      expect(row.runKind).toBe('intraday');
      // A one-day window: `window_start <= window_end` is the only shape the
      // table's own CHECK cares about.
      expect(String(row.windowStart)).toContain('2026-08-27');
    });
  });

  describe('intraday buckets', () => {
    const intraday = (bucket: string) =>
      service.enqueue({
        ...base,
        runKind: 'intraday',
        windowStart: '2026-08-27',
        windowEnd: '2026-08-27',
        entityLevels: ['account', 'campaign'],
        bucket,
      });

    it('collapses a repeat of the same bucket into the run already in flight', async () => {
      const first = await intraday('h09');
      const second = await intraday('h09');

      expect(second.deduplicated).toBe(true);
      expect(second.run.id).toBe(first.run.id);
    });

    it('lets the next bucket through', async () => {
      const nine = await intraday('h09');
      const noon = await intraday('h12');

      // Same connection, same day, same window. Without the bucket in the key
      // these are one intent and an account gets one reading a day.
      expect(noon.deduplicated).toBe(false);
      expect(noon.run.id).not.toBe(nine.run.id);
    });

    it('answers a settled bucket without re-enqueueing it', async () => {
      const nine = await intraday('h09');
      await settle(nine.run.id, 'succeeded');

      const key = buildSyncIdempotencyKey({
        connectionId,
        runKind: 'intraday',
        windowStart: '2026-08-27',
        windowEnd: '2026-08-27',
        entityLevels: ['account', 'campaign'],
        bucket: 'h09',
      });

      expect(await service.hasSettledRun(connectionId, key)).toBe(true);

      // The next bucket is a different question, and it has not been answered.
      expect(
        await service.hasSettledRun(connectionId, key.replace(':h09', ':h12')),
      ).toBe(false);
    });

    it('keeps the key a run was written with', async () => {
      const nine = await intraday('h09');
      const row = await repository.findOneByOrFail({ id: nine.run.id });

      expect(row.idempotencyKey.endsWith(':h09')).toBe(true);
    });

    it('leaves a key with no bucket exactly as it was before this slice', () => {
      // Every daily run written before intraday existed carries the four-part
      // key. Appending a placeholder would make the scheduler's "has today's
      // run settled?" question stop matching yesterday's rows on deploy day.
      expect(
        buildSyncIdempotencyKey({
          connectionId,
          runKind: 'daily',
          windowStart: '2026-08-19',
          windowEnd: '2026-08-25',
          entityLevels: ['account', 'campaign', 'adset', 'ad'],
        }),
      ).toBe(
        `${connectionId}:daily:2026-08-19:2026-08-25:account+ad+adset+campaign`,
      );
    });
  });

  describe('reading a chain back out of the log', () => {
    const chunk = (until: string) =>
      service.enqueue({
        ...base,
        runKind: 'backfill',
        windowStart: until,
        windowEnd: until,
        entityLevels: ['account', 'campaign'],
      });

    it('returns every chunk with how it ended, newest first', async () => {
      const first = await chunk('2026-08-25');
      await settle(first.run.id, 'succeeded');

      const second = await chunk('2026-08-18');
      await settle(second.run.id, 'dead_letter');

      await chunk('2026-08-11');

      // The status travels with the day because the two are read differently:
      // the newest window end is the plan's anchor whatever became of it, but
      // only `succeeded` counts as a week that was actually fetched.
      expect(await service.listBackfillChunkOutcomes(connectionId)).toEqual([
        { until: '2026-08-25', status: 'succeeded' },
        { until: '2026-08-18', status: 'dead_letter' },
        { until: '2026-08-11', status: 'queued' },
      ]);
    });

    it('returns days as text, never re-expressed in the server timezone', async () => {
      const first = await chunk('2026-01-01');
      await settle(first.run.id, 'succeeded');

      // A `date` handed back as a `Date` would be rendered in whatever zone the
      // process runs in, and this value is compared against days computed in
      // the ad account's.
      const [outcome] = await service.listBackfillChunkOutcomes(connectionId);

      expect(outcome.until).toBe('2026-01-01');
    });

    it('ignores runs of other kinds', async () => {
      await service.enqueue({
        ...base,
        runKind: 'daily',
        windowStart: '2026-08-19',
        windowEnd: '2026-08-25',
      });

      expect(await service.listBackfillChunkOutcomes(connectionId)).toEqual([]);
    });

    it('does not treat a manual run of the same window as a chunk', async () => {
      // A manual sync writes the same facts and must not certify coverage:
      // otherwise "complete" would mean "some facts are present", which is
      // precisely what the run log exists to disprove.
      const first = await chunk('2026-08-25');
      await settle(first.run.id, 'dead_letter');

      await service.enqueue({
        ...base,
        runKind: 'manual',
        windowStart: '2026-08-19',
        windowEnd: '2026-08-25',
      });

      expect(await service.listBackfillChunkOutcomes(connectionId)).toEqual([
        { until: '2026-08-25', status: 'dead_letter' },
      ]);
    });

    it('returns every attempt at one window, oldest first', async () => {
      // A resumed chunk is a second run of the same window by construction, so
      // this is the shape the state resolution actually reads.
      const first = await chunk('2026-08-25');
      await settle(first.run.id, 'dead_letter');

      const second = await chunk('2026-08-25');
      await settle(second.run.id, 'succeeded');

      expect(await service.listBackfillChunkOutcomes(connectionId)).toEqual([
        { until: '2026-08-25', status: 'dead_letter' },
        { until: '2026-08-25', status: 'succeeded' },
      ]);
    });

    it('puts the anchor first by an order Postgres cannot vary', async () => {
      // `window_end DESC` alone is not a total order once a window has several
      // runs, and ties come back in whatever order the plan produces — which
      // changes with the table's physical layout. `created_at` then `id` settle
      // it, so `[0].until` is the anchor every time rather than usually.
      const older = await chunk('2026-08-18');
      await settle(older.run.id, 'succeeded');

      const anchorFirst = await chunk('2026-08-25');
      await settle(anchorFirst.run.id, 'dead_letter');

      const anchorRetry = await chunk('2026-08-25');
      await settle(anchorRetry.run.id, 'succeeded');

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const outcomes = await service.listBackfillChunkOutcomes(connectionId);

        expect(outcomes[0].until).toBe('2026-08-25');
        expect(outcomes.map((outcome) => outcome.status)).toEqual([
          'dead_letter',
          'succeeded',
          'succeeded',
        ]);
      }
    });
  });

  describe('one piece of the chain at a time', () => {
    it('sees a queued chunk', async () => {
      await service.enqueue({
        ...base,
        runKind: 'backfill',
        windowStart: '2026-08-19',
        windowEnd: '2026-08-25',
        entityLevels: ['account', 'campaign'],
      });

      expect(
        await service.hasInFlightRun(connectionId, ['entities', 'backfill']),
      ).toBe(true);
    });

    it('sees the hierarchy run the chain starts with', async () => {
      await service.enqueue({
        ...base,
        runKind: 'entities',
        windowStart: null,
        windowEnd: null,
      });

      expect(
        await service.hasInFlightRun(connectionId, ['entities', 'backfill']),
      ).toBe(true);
    });

    it('stops seeing a chunk once it settles', async () => {
      const chunk = await service.enqueue({
        ...base,
        runKind: 'backfill',
        windowStart: '2026-08-19',
        windowEnd: '2026-08-25',
        entityLevels: ['account', 'campaign'],
      });

      await settle(chunk.run.id, 'partial');

      // Terminal in any of its forms. A settled chunk is a chunk that has
      // handed over, whatever it managed to write.
      expect(
        await service.hasInFlightRun(connectionId, ['entities', 'backfill']),
      ).toBe(false);
    });

    it('does not count another cadence as the chain', async () => {
      await service.enqueue({
        ...base,
        runKind: 'daily',
        windowStart: '2026-08-19',
        windowEnd: '2026-08-25',
      });

      // A daily run in flight must not stall the backfill: the two compete for
      // the worker, not for each other's turn.
      expect(
        await service.hasInFlightRun(connectionId, ['entities', 'backfill']),
      ).toBe(false);
    });

    it('does not count another connection runs', async () => {
      const stranger = randomUUID();

      expect(
        await service.hasInFlightRun(stranger, ['entities', 'backfill']),
      ).toBe(false);
    });
  });
});
