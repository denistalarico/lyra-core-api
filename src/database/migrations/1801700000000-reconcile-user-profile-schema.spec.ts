import type { QueryRunner } from 'typeorm';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { ReconcileUserProfileSchema1801700000000 } from './1801700000000-reconcile-user-profile-schema';

describe('ReconcileUserProfileSchema1801700000000', () => {
  it('adds every canonical profile column missing from the original schema', async () => {
    const query = jest
      .fn<Promise<unknown>, [string]>()
      .mockResolvedValue(undefined);
    const migration = new ReconcileUserProfileSchema1801700000000();

    await migration.up({ query } as unknown as QueryRunner);

    expect(query).toHaveBeenCalledTimes(3);
    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(
        /ADD COLUMN IF NOT EXISTS "first_name" varchar\(60\) NOT NULL DEFAULT ''/,
      ),
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(
        /ADD COLUMN IF NOT EXISTS "last_name" varchar\(60\) NOT NULL DEFAULT ''/,
      ),
    );
    expect(query).toHaveBeenNthCalledWith(
      3,
      expect.stringMatching(/ADD COLUMN IF NOT EXISTS "bio" varchar\(280\)/),
    );
  });

  it('is registered in the Agency data source', () => {
    expect(AgencyDataSource.options.migrations).toEqual(
      expect.arrayContaining([ReconcileUserProfileSchema1801700000000]),
    );
  });
});
