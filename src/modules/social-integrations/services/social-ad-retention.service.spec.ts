import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { SocialAdRetentionConfigService } from './social-ad-retention-config.service';
import { SocialAdRetentionScheduler } from './social-ad-retention.scheduler';
import { SocialAdRetentionService } from './social-ad-retention.service';

/**
 * The sweep's behaviour around the database, without one.
 *
 * What is asserted here is everything that is *not* the predicate: the switch,
 * the batch bound, the driver's return shape, the log's contents, and the
 * statement's blast radius. The predicate itself is proven against real
 * PostgreSQL in `social-ad-retention.postgres.spec.ts`, because a hand-rolled
 * fake would only prove the fake agrees with itself.
 */

type Query = { sql: string; params: unknown[] };

function fakeDataSource(rows: unknown[][] | (() => unknown[])) {
  const queries: Query[] = [];
  let call = 0;

  const dataSource = {
    query: jest.fn((sql: string, params: unknown[]) => {
      queries.push({ sql, params });

      const batch = typeof rows === 'function' ? rows() : (rows[call] ?? []);

      call += 1;

      // The driver's real shape for `DELETE ... RETURNING`.
      return Promise.resolve([batch, batch.length]);
    }),
  } as unknown as DataSource;

  return { dataSource, queries };
}

function deleted(count: number, runKind = 'daily', status = 'succeeded') {
  return Array.from({ length: count }, () => ({
    run_kind: runKind,
    status,
  }));
}

describe('SocialAdRetentionService', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  describe('the kill switch', () => {
    it('deletes nothing when retention is disabled', async () => {
      process.env.SOCIAL_ADS_RETENTION_ENABLED = 'false';

      const { dataSource, queries } = fakeDataSource([deleted(5)]);
      const service = new SocialAdRetentionService(
        dataSource,
        new SocialAdRetentionConfigService(),
      );

      const result = await service.sweep();

      expect(result.skipped).toBe('disabled');
      expect(result.deleted).toBe(0);
      // Not "deleted zero rows" — no statement was issued at all.
      expect(queries).toHaveLength(0);
    });

    it('is independent of the sync switch', async () => {
      // Pausing ingestion to investigate a provider incident must not also
      // authorize deletion, and turning sync on for the first time must not
      // silently authorize a first sweep.
      process.env.SOCIAL_ADS_SYNC_ENABLED = 'false';
      delete process.env.SOCIAL_ADS_RETENTION_ENABLED;

      const { dataSource } = fakeDataSource([deleted(1)]);
      const service = new SocialAdRetentionService(
        dataSource,
        new SocialAdRetentionConfigService(),
      );

      const result = await service.sweep();

      expect(result.skipped).toBeNull();
      expect(result.deleted).toBe(1);
    });

    it('defaults to enabled when the variable is absent', async () => {
      delete process.env.SOCIAL_ADS_RETENTION_ENABLED;

      const { dataSource } = fakeDataSource([[]]);
      const service = new SocialAdRetentionService(
        dataSource,
        new SocialAdRetentionConfigService(),
      );

      expect((await service.sweep()).skipped).toBeNull();
    });
  });

  describe('the batch bound', () => {
    it('passes the configured limit to the statement', async () => {
      process.env.SOCIAL_ADS_RETENTION_BATCH_SIZE = '250';

      const { dataSource, queries } = fakeDataSource([[]]);
      const service = new SocialAdRetentionService(
        dataSource,
        new SocialAdRetentionConfigService(),
      );

      await service.sweep();

      expect(queries[0].sql).toContain('LIMIT');
      expect(queries[0].params).toContain(250);
    });

    it('reports more work when the batch came back full', async () => {
      process.env.SOCIAL_ADS_RETENTION_BATCH_SIZE = '3';

      const { dataSource } = fakeDataSource([deleted(3)]);
      const service = new SocialAdRetentionService(
        dataSource,
        new SocialAdRetentionConfigService(),
      );

      expect((await service.sweep()).hadMore).toBe(true);
    });

    it('reports no more work when the batch came back short', async () => {
      process.env.SOCIAL_ADS_RETENTION_BATCH_SIZE = '3';

      const { dataSource } = fakeDataSource([deleted(1)]);
      const service = new SocialAdRetentionService(
        dataSource,
        new SocialAdRetentionConfigService(),
      );

      expect((await service.sweep()).hadMore).toBe(false);
    });

    it('never issues an unbounded delete', async () => {
      const { dataSource, queries } = fakeDataSource([[]]);
      const service = new SocialAdRetentionService(
        dataSource,
        new SocialAdRetentionConfigService(),
      );

      await service.sweep();

      expect(queries[0].sql).toMatch(/LIMIT \$\d+/);
    });
  });

  describe('the statement', () => {
    let queries: Query[];

    beforeEach(async () => {
      const fake = fakeDataSource([[]]);

      queries = fake.queries;

      await new SocialAdRetentionService(
        fake.dataSource,
        new SocialAdRetentionConfigService(),
      ).sweep();
    });

    it('touches only the run log', () => {
      const { sql } = queries[0];

      // The facts, the entities and the connections are not reachable from
      // this statement. `metrics_daily.sync_run_id` is ON DELETE SET NULL, so
      // the schema protects them too — this asserts the first of the two.
      expect(sql).toContain('DELETE FROM social_ad_sync_runs');
      expect(sql).not.toContain('social_ad_metrics_daily');
      expect(sql).not.toContain('social_ad_entities');
      expect(sql).not.toContain('social_ad_account_connections');
    });

    it('excludes backfill runs in the predicate itself', () => {
      expect(queries[0].sql).toContain('run_kind <> $2');
      expect(queries[0].params[1]).toBe('backfill');
    });

    it('excludes the non-terminal statuses', () => {
      expect(queries[0].sql).toContain('status <> ALL($3::text[])');
      expect(queries[0].params[2]).toEqual(['queued', 'processing']);
    });

    it('fails closed on a missing finish timestamp', () => {
      expect(queries[0].sql).toContain('finished_at IS NOT NULL');
    });

    it('measures age from terminalization, never from creation', () => {
      const { sql } = queries[0];

      // `created_at` measures when somebody asked, which is not when the row
      // became history — a run can sit queued for hours behind a chain.
      expect(sql).toContain('finished_at');
      expect(sql).not.toContain('created_at');
    });

    it('applies status precedence in one expression', () => {
      const { sql, params } = queries[0];

      // Status period, then kind period, then default — as a single COALESCE,
      // so the precedence cannot be applied inconsistently.
      expect(sql).toContain('COALESCE');
      expect(sql.indexOf('->> status')).toBeLessThan(
        sql.indexOf('->> run_kind'),
      );
      expect(JSON.parse(params[3] as string)).toMatchObject({
        dead_letter: 180,
      });
      expect(JSON.parse(params[4] as string)).toMatchObject({ intraday: 30 });
    });

    it('does not order the candidates', () => {
      // Every matching row is equally eligible, and with no index on
      // `finished_at` an ORDER BY forces a full scan plus an external merge
      // sort of every candidate before taking a thousand — measured at 200 000
      // rows as 152 ms against 39 ms unordered.
      expect(queries[0].sql).not.toContain('ORDER BY');
    });

    it('tolerates a concurrent sweep', () => {
      // Two instances take disjoint sets instead of one blocking on the other
      // and then deleting rows already gone.
      expect(queries[0].sql).toContain('FOR UPDATE SKIP LOCKED');
    });

    it('binds every policy value rather than interpolating it', () => {
      const { sql } = queries[0];

      // No status, kind, table or period is spliced into the string. The only
      // literals are the SQL keywords and the column names.
      expect(sql).not.toContain('dead_letter');
      expect(sql).not.toContain('intraday');
      // `interval '1 day'` is a fixed unit multiplied by a bound parameter —
      // the count itself is never spliced in.
      expect(sql).toContain("interval '1 day'");
      expect(sql).not.toMatch(/interval '(?!1 day')\d+/);
      expect(sql).not.toMatch(/\b(30|90|180)\b/);
    });
  });

  describe('counting what was deleted', () => {
    it('reads the driver row-count pair correctly', async () => {
      // TypeORM answers `DELETE ... RETURNING` with `[rows, rowCount]`. Reading
      // the pair as rows would report every sweep as having deleted two.
      const { dataSource } = fakeDataSource([deleted(7)]);
      const service = new SocialAdRetentionService(
        dataSource,
        new SocialAdRetentionConfigService(),
      );

      expect((await service.sweep()).deleted).toBe(7);
    });

    it('reports zero for a sweep that matched nothing', async () => {
      const { dataSource } = fakeDataSource([[]]);
      const service = new SocialAdRetentionService(
        dataSource,
        new SocialAdRetentionConfigService(),
      );

      expect((await service.sweep()).deleted).toBe(0);
    });

    it('groups the counts by kind and status', async () => {
      const { dataSource } = fakeDataSource([
        [
          ...deleted(2, 'intraday', 'succeeded'),
          ...deleted(1, 'daily', 'failed'),
        ],
      ]);
      const service = new SocialAdRetentionService(
        dataSource,
        new SocialAdRetentionConfigService(),
      );

      expect((await service.sweep()).byBucket).toEqual({
        'intraday:succeeded': 2,
        'daily:failed': 1,
      });
    });
  });

  describe('observability', () => {
    it('logs one line per sweep, not one per row', async () => {
      const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();

      const { dataSource } = fakeDataSource([deleted(500)]);
      const service = new SocialAdRetentionService(
        dataSource,
        new SocialAdRetentionConfigService(),
      );

      await service.sweep();

      expect(log).toHaveBeenCalledTimes(1);
    });

    it('says nothing when a sweep deleted nothing', async () => {
      // A daily "deleted 0 rows" for months is how a log stops being read.
      const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();

      const { dataSource } = fakeDataSource([[]]);

      await new SocialAdRetentionService(
        dataSource,
        new SocialAdRetentionConfigService(),
      ).sweep();

      expect(log).not.toHaveBeenCalled();
    });

    it('logs counts and never row identifiers', async () => {
      const entries: string[] = [];

      jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation((message: unknown) => {
          entries.push(String(message));
        });

      const { dataSource } = fakeDataSource([deleted(3, 'daily', 'failed')]);

      await new SocialAdRetentionService(
        dataSource,
        new SocialAdRetentionConfigService(),
      ).sweep();

      const line = entries.join('\n');

      expect(line).toContain('deleted');
      expect(line).toContain('daily:failed');
      // No ids, no windows, no error payloads, nothing near a credential.
      expect(line).not.toMatch(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
      );
      expect(line.toLowerCase()).not.toContain('token');
      expect(line).not.toContain('access');
    });
  });
});

describe('SocialAdRetentionScheduler', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  function schedulerWith(sweeps: { deleted: number; hadMore: boolean }[]) {
    let call = 0;
    const sweep = jest.fn(() => {
      const next = sweeps[call] ?? { deleted: 0, hadMore: false };

      call += 1;

      return Promise.resolve({
        ...next,
        byBucket: {},
        durationMs: 1,
        skipped: null,
      });
    });

    return {
      sweep,
      scheduler: new SocialAdRetentionScheduler({
        sweep,
      } as unknown as SocialAdRetentionService),
    };
  }

  it('stops as soon as a batch comes back short', async () => {
    const { sweep, scheduler } = schedulerWith([
      { deleted: 1000, hadMore: true },
      { deleted: 12, hadMore: false },
    ]);

    const result = await scheduler.run();

    expect(sweep).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ deleted: 1012, batches: 2 });
  });

  it('bounds one tick even with an unbounded backlog', async () => {
    // Drains over several nights rather than in one long-running sitting.
    const { sweep, scheduler } = schedulerWith(
      Array.from({ length: 50 }, () => ({ deleted: 1000, hadMore: true })),
    );

    const result = await scheduler.run();

    expect(sweep).toHaveBeenCalledTimes(5);
    expect(result.batches).toBe(5);
  });

  it('stops immediately when the switch is off', async () => {
    const sweep = jest.fn(() =>
      Promise.resolve({
        deleted: 0,
        hadMore: false,
        byBucket: {},
        durationMs: 0,
        skipped: 'disabled' as const,
      }),
    );

    const scheduler = new SocialAdRetentionScheduler({
      sweep,
    } as unknown as SocialAdRetentionService);

    expect(await scheduler.run()).toEqual({ deleted: 0, batches: 0 });
    expect(sweep).toHaveBeenCalledTimes(1);
  });

  it('never lets a sweep failure escape the tick', async () => {
    // Housekeeping must not take the process down or surface as an unhandled
    // rejection.
    const scheduler = new SocialAdRetentionScheduler({
      sweep: jest.fn(() => Promise.reject(new Error('boom'))),
    } as unknown as SocialAdRetentionService);

    await expect(scheduler.tick()).resolves.toBeUndefined();
  });

  it('logs only the error name, never a driver message', async () => {
    const entries: string[] = [];

    jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation((message: unknown) => {
        entries.push(String(message));
      });

    const scheduler = new SocialAdRetentionScheduler({
      sweep: jest.fn(() =>
        Promise.reject(new Error('DELETE FROM social_ad_sync_runs WHERE ...')),
      ),
    } as unknown as SocialAdRetentionService);

    await scheduler.tick();

    // A driver error's message can carry statement fragments.
    expect(entries.join('\n')).not.toContain('DELETE FROM');
    expect(entries.join('\n')).toContain('Error');
  });
});

describe('the retention path as a whole', () => {
  /**
   * Guarded by reading the sources, the way the analytics boundary spec is.
   *
   * The retention path is a *writer*, so it cannot be covered by that spec —
   * but it is the one component in this module whose job is deletion, and the
   * blast radius it is allowed is worth pinning down in the same way. A stray
   * import is easy to miss in review; an assertion is not.
   */
  const sources = [
    'social-ad-retention.service.ts',
    'social-ad-retention.scheduler.ts',
    'social-ad-retention-config.service.ts',
    '../sync/social-ad-retention.policy.ts',
  ];

  function readSource(file: string): string {
    return readFileSync(join(__dirname, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
  }

  it.each(sources)('%s reaches no credential or provider', (file) => {
    const source = readSource(file);

    for (const forbidden of [
      'MetaAdsGraphService',
      'SocialAdCredentialResolver',
      'SettingsCryptoService',
      'SocialInternalAccessService',
      'accessTokenEncrypted',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it.each(sources)('%s names no table but the run log', (file) => {
    const source = readSource(file);

    // The facts, the campaign mirror and the connections are unreachable from
    // this path by construction: the code does not mention them.
    expect(source).not.toContain('social_ad_metrics_daily');
    expect(source).not.toContain('social_ad_entities');
    expect(source).not.toContain('social_ad_account_connections');
    expect(source).not.toContain('SocialAdMetricDailyEntity');
  });

  it('exposes no HTTP surface', () => {
    // Retention is internal housekeeping. There is no endpoint to authorize,
    // rate-limit or scope, because there is no caller.
    for (const file of sources) {
      const source = readSource(file);

      expect(source).not.toContain('@Controller');
      expect(source).not.toContain('@Get(');
      expect(source).not.toContain('@Post(');
      expect(source).not.toContain('@Delete(');
    }
  });

  it('accepts no caller-supplied table, status or period', () => {
    const source = readSource('social-ad-retention.service.ts');

    // `sweep` takes an optional `now` and nothing else — no kind, no status, no
    // table, no limit override — so there is no input to whitelist.
    expect(source).toMatch(/sweep\(\s*input:\s*\{\s*now\?:\s*Date\s*\}/);
  });
});

describe('SocialAdRetentionConfigService', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it.each(['false', 'FALSE', '0', 'no', 'off', 'Off'])(
    'reads %s as disabled',
    (value) => {
      process.env.SOCIAL_ADS_RETENTION_ENABLED = value;

      expect(new SocialAdRetentionConfigService().enabled).toBe(false);
    },
  );

  it.each(['true', '', 'yes', 'anything'])(
    'reads %s as enabled, the safe default direction',
    (value) => {
      process.env.SOCIAL_ADS_RETENTION_ENABLED = value;

      expect(new SocialAdRetentionConfigService().enabled).toBe(true);
    },
  );

  it('defaults the batch size when unset', () => {
    delete process.env.SOCIAL_ADS_RETENTION_BATCH_SIZE;

    expect(new SocialAdRetentionConfigService().batchSize).toBe(1000);
  });

  it('clamps a batch size that is out of range', () => {
    process.env.SOCIAL_ADS_RETENTION_BATCH_SIZE = '999999';
    expect(new SocialAdRetentionConfigService().batchSize).toBe(10_000);

    process.env.SOCIAL_ADS_RETENTION_BATCH_SIZE = '0';
    expect(new SocialAdRetentionConfigService().batchSize).toBe(1);
  });

  it('falls back rather than rounding a non-integer', () => {
    process.env.SOCIAL_ADS_RETENTION_BATCH_SIZE = '10.5';

    expect(new SocialAdRetentionConfigService().batchSize).toBe(1000);
  });
});
