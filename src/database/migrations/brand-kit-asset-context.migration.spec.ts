import { getMetadataArgsStorage } from 'typeorm';
import { BrandKitAssetEntity } from '../../modules/brand-kit/entities';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { ExpandBrandKitAssetContext1794200000000 } from './1794200000000-expand-brand-kit-asset-context';

function collectSql(run: (queryRunner: never) => Promise<void>) {
  const sql: string[] = [];
  const queryRunner = {
    query: jest.fn((statement: string) => {
      sql.push(statement);
      return Promise.resolve();
    }),
  };
  return run(queryRunner as never).then(() => sql);
}

describe('Brand Kit asset context migration', () => {
  it('adds usage, backfills legacy rows and enforces the complete taxonomy', async () => {
    const sql = (await collectSql((runner) =>
      new ExpandBrandKitAssetContext1794200000000().up(runner),
    )).join('\n');

    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "usage" varchar(16)');
    expect(sql).toContain("WHEN \"kind\" = 'reference' THEN 'reference'");
    expect(sql).toContain("ELSE 'asset'");
    expect(sql).toContain('ALTER COLUMN "usage" SET NOT NULL');
    for (const kind of [
      'logo',
      'product',
      'person',
      'environment',
      'graphic_element',
      'texture',
      'background',
      'photo',
      'reference',
    ]) {
      expect(sql).toContain(`'${kind}'`);
    }
    expect(sql).toContain('CK_brand_kit_assets_kind_usage');
  });

  it('refuses a destructive rollback when any new category is already used', async () => {
    const statements = await collectSql((runner) =>
      new ExpandBrandKitAssetContext1794200000000().down(runner),
    );
    expect(statements[0]).toContain('RAISE EXCEPTION');
    expect(statements[0]).toContain("kind\" NOT IN ('logo', 'reference')");
    expect(statements.join('\n')).not.toMatch(/DELETE FROM|TRUNCATE/i);
    expect(statements.join('\n')).toContain('DROP COLUMN IF EXISTS "usage"');
  });

  it('matches the entity and registers only on the agency datasource', async () => {
    const columns = getMetadataArgsStorage()
      .columns.filter((column) => column.target === BrandKitAssetEntity)
      .map((column) => column.options.name ?? column.propertyName);
    expect(columns).toContain('usage');
    expect(AgencyDataSource.options.migrations).toContain(
      ExpandBrandKitAssetContext1794200000000,
    );
  });
});
