import type { QueryRunner } from 'typeorm';
import { ExpandTaskChecklistItemTitle1786100000000 } from './1786100000000-expand-task-checklist-item-title';

describe('ExpandTaskChecklistItemTitle1786100000000', () => {
  it('expands the checklist title column to text', async () => {
    const query = jest
      .fn<Promise<unknown>, [string]>()
      .mockResolvedValue(undefined);
    const migration = new ExpandTaskChecklistItemTitle1786100000000();

    await migration.up({ query } as unknown as QueryRunner);

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('ALTER COLUMN "title" TYPE text');
  });

  it('truncates oversized values before restoring the previous column type', async () => {
    const query = jest
      .fn<Promise<unknown>, [string]>()
      .mockResolvedValue(undefined);
    const migration = new ExpandTaskChecklistItemTitle1786100000000();

    await migration.down({ query } as unknown as QueryRunner);

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toContain('LEFT("title", 220)');
    expect(query.mock.calls[1][0]).toContain(
      'ALTER COLUMN "title" TYPE character varying(220)',
    );
  });
});
