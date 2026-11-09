import { CreativeTrashPurgeWorker } from './creative-trash-purge.worker';

function harness(batches: { id: string }[][]) {
  const statements: { sql: string; params: unknown[] }[] = [];
  const dataSource = {
    query: jest.fn(async (sql: string, params: unknown[]) => {
      statements.push({ sql, params });
      return /UPDATE|DELETE/.test(sql) ? [] : (batches.shift() ?? []);
    }),
  };
  const mediaUpload = { purgeRetiredObject: jest.fn(async () => undefined) };
  return {
    worker: new CreativeTrashPurgeWorker(
      dataSource as never,
      mediaUpload as never,
    ),
    statements,
    mediaUpload,
  };
}

describe('CreativeTrashPurgeWorker', () => {
  it('expires files trashed more than 30 days ago', async () => {
    const h = harness([[]]);
    await h.worker.run(new Date('2026-12-31T00:00:00.000Z'));
    expect(h.statements[0].params).toEqual([
      new Date('2026-12-01T00:00:00.000Z'),
      new Date('2026-12-31T00:00:00.000Z'),
    ]);
  });

  it('purges every media with no owner left', async () => {
    const h = harness([[{ id: 'a' }, { id: 'b' }]]);
    await expect(h.worker.run()).resolves.toEqual({ purged: 2 });
    expect(h.mediaUpload.purgeRetiredObject).toHaveBeenCalledTimes(2);
  });

  it('stops at the first storage failure and leaves the rest for the next tick', async () => {
    const h = harness([[{ id: 'a' }, { id: 'b' }]]);
    h.mediaUpload.purgeRetiredObject.mockRejectedValueOnce(new Error('down'));
    await expect(h.worker.run()).resolves.toEqual({ purged: 0 });
    expect(h.mediaUpload.purgeRetiredObject).toHaveBeenCalledTimes(1);
  });
});
