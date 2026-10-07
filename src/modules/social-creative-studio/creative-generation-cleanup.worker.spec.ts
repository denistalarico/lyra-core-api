import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { MediaAssetUploadService } from '../../common/media-assets';
import { CreativeGenerationCleanupWorker } from './creative-generation-cleanup.worker';
import { CreativeGenerationConfigService } from './creative-generation-config';

const ENV = [
  'CREATIVE_GENERATION_CLEANUP_ENABLED',
  'CREATIVE_GENERATION_CLEANUP_DRY_RUN',
  'CREATIVE_GENERATION_TEMP_RETENTION_DAYS',
  'CREATIVE_GENERATION_CLEANUP_BATCH_SIZE',
];

describe('CreativeGenerationCleanupWorker (CS3.6.1)', () => {
  const config = new CreativeGenerationConfigService();
  let query: jest.Mock;
  let purge: jest.Mock;
  let logs: string[];
  /** Rows the tombstone statement claims, one array per call. */
  let fresh: { id: string; reason: string }[][];

  function worker() {
    return new CreativeGenerationCleanupWorker(
      { query } as unknown as DataSource,
      { purgeTombstonedTemporary: purge } as unknown as MediaAssetUploadService,
      config,
    );
  }

  beforeEach(() => {
    fresh = [];
    logs = [];
    query = jest.fn(async (sql: string) => {
      if (sql.includes('GROUP BY eligible.reason'))
        return [{ reason: 'expired', count: 3 }];
      if (sql.includes('deleted_at IS NOT NULL')) return [{ count: 1 }];
      if (sql.includes('RETURNING target.id, claimed.reason'))
        return [fresh.shift() ?? [], 0];
      return [[], 0]; // stale reclaim: nothing
    });
    purge = jest.fn().mockResolvedValue(true);
    jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(
        (message: unknown) => void logs.push(String(message)),
      );
    jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(
        (message: unknown) => void logs.push(String(message)),
      );
  });

  afterEach(() => {
    for (const name of ENV) delete process.env[name];
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  describe('config', () => {
    it('defaults to off, dry run, 7 days, 100 per batch', () => {
      expect(config.cleanupEnabled).toBe(false);
      expect(config.cleanupDryRun).toBe(true);
      expect(config.tempRetentionDays).toBe(7);
      expect(config.cleanupBatchSize).toBe(100);
    });

    it('enables only on an explicit yes and deletes only on an explicit no', () => {
      for (const [raw, enabled] of [
        ['true', true],
        ['1', true],
        [' YES ', true],
        ['on', true],
        ['tru', false],
        ['', false],
      ] as const) {
        process.env.CREATIVE_GENERATION_CLEANUP_ENABLED = raw;
        expect(config.cleanupEnabled).toBe(enabled);
      }
      for (const [raw, dryRun] of [
        ['false', false],
        ['0', false],
        ['off', false],
        ['flase', true],
        ['', true],
      ] as const) {
        process.env.CREATIVE_GENERATION_CLEANUP_DRY_RUN = raw;
        expect(config.cleanupDryRun).toBe(dryRun);
      }
    });

    it('bounds retention to 1..90 days and batches to 1..500', () => {
      process.env.CREATIVE_GENERATION_TEMP_RETENTION_DAYS = '0';
      expect(config.tempRetentionDays).toBe(1);
      process.env.CREATIVE_GENERATION_TEMP_RETENTION_DAYS = '365';
      expect(config.tempRetentionDays).toBe(90);
      process.env.CREATIVE_GENERATION_TEMP_RETENTION_DAYS = '7.5';
      expect(config.tempRetentionDays).toBe(7);
      process.env.CREATIVE_GENERATION_CLEANUP_BATCH_SIZE = '10000';
      expect(config.cleanupBatchSize).toBe(500);
    });
  });

  it('disabled: the tick touches nothing', async () => {
    await worker().tick();
    expect(query).not.toHaveBeenCalled();
    expect(purge).not.toHaveBeenCalled();
  });

  it('dry run: reads only, never writes or calls storage', async () => {
    process.env.CREATIVE_GENERATION_CLEANUP_ENABLED = 'true';

    const [report] = await worker().run(new Date('2026-10-20T00:00:00Z'));

    expect(report).toMatchObject({
      mode: 'dry_run',
      eligible: { promoted: 0, expired: 3, orphan: 0 },
      pendingPurge: 1,
    });
    for (const [sql] of query.mock.calls as [string][])
      expect(sql.trim()).toMatch(/^SELECT/);
    expect(purge).not.toHaveBeenCalled();
    // The cutoff is `now` minus the retention.
    const [, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params[1]).toEqual(new Date('2026-10-13T00:00:00Z'));
    expect(logs.join('\n')).toContain('"mode":"dry_run"');
  });

  it('delete: stops at the first storage failure and defers the rest', async () => {
    process.env.CREATIVE_GENERATION_CLEANUP_ENABLED = 'true';
    process.env.CREATIVE_GENERATION_CLEANUP_DRY_RUN = 'false';
    fresh = [
      [
        { id: 'a', reason: 'expired' },
        { id: 'b', reason: 'promoted' },
        { id: 'c', reason: 'orphan' },
      ],
    ];
    purge
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(
        Object.assign(new Error('x'), { name: 'TimeoutError' }),
      );

    const results = await worker().run();

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      eligible: { expired: 1, promoted: 1, orphan: 1 },
      purged: 1,
      failed: 1,
      deferred: 1,
    });
    expect(purge.mock.calls.map(([id]) => id as string)).toEqual(['a', 'b']);
    const output = logs.join('\n');
    expect(output).toContain('media=b error=TimeoutError deferred=1');
    expect(output).not.toMatch(/media-assets\/|prompt/);
  });

  it('delete: keeps batching while batches fill, up to the tick budget', async () => {
    process.env.CREATIVE_GENERATION_CLEANUP_ENABLED = 'true';
    process.env.CREATIVE_GENERATION_CLEANUP_DRY_RUN = 'false';
    process.env.CREATIVE_GENERATION_CLEANUP_BATCH_SIZE = '1';
    fresh = Array.from({ length: 9 }, (_, i) => [
      { id: `m${i}`, reason: 'expired' },
    ]);

    const results = await worker().run();

    expect(results).toHaveLength(5);
    expect(purge).toHaveBeenCalledTimes(5);
  });

  it('a hung storage delete fails after the timeout instead of hanging the tick', async () => {
    jest.useFakeTimers();
    process.env.CREATIVE_GENERATION_CLEANUP_ENABLED = 'true';
    process.env.CREATIVE_GENERATION_CLEANUP_DRY_RUN = 'false';
    fresh = [[{ id: 'a', reason: 'expired' }]];
    purge.mockReturnValue(new Promise(() => undefined));

    const pending = worker().sweep();
    await jest.advanceTimersByTimeAsync(30_000);

    await expect(pending).resolves.toMatchObject({ failed: 1, purged: 0 });
  });
});
