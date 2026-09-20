import { describePostgresIntegration } from '../../testing/postgres-integration';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { ExpandBrandKitAssetContext1794200000000 } from './1794200000000-expand-brand-kit-asset-context';

const run = describePostgresIntegration();

run('Brand Kit asset context migration against PostgreSQL', () => {
  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
  });

  afterAll(async () => {
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  it('preserves legacy rows, validates new categories and safely rolls back in an isolated schema', async () => {
    const queryRunner = AgencyDataSource.createQueryRunner();
    const schema = `cs2a_brandkit_${process.pid}_${Date.now()}`;
    const migration = new ExpandBrandKitAssetContext1794200000000();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await queryRunner.query(`CREATE SCHEMA "${schema}"`);
      await queryRunner.query(`SET LOCAL search_path TO "${schema}", public`);
      await queryRunner.query(`
        CREATE TABLE "brand_kit_assets" (
          "id" text PRIMARY KEY,
          "kind" varchar(24) NOT NULL,
          "variant" varchar(24),
          "theme" varchar(16),
          CONSTRAINT "CK_brand_kit_assets_kind"
            CHECK ("kind" IN ('logo', 'reference')),
          CONSTRAINT "CK_brand_kit_assets_reference_shape"
            CHECK ("kind" <> 'reference' OR
                   ("variant" IS NULL AND "theme" IS NULL))
        )
      `);
      await queryRunner.query(`
        INSERT INTO "brand_kit_assets" ("id", "kind", "variant", "theme")
        VALUES ('legacy-logo', 'logo', 'horizontal', 'dark'),
               ('legacy-reference', 'reference', NULL, NULL)
      `);

      await migration.up(queryRunner);
      const legacyRows = await queryRunner.query(`
        SELECT "id", "kind", "usage" FROM "brand_kit_assets" ORDER BY "id"
      `);
      expect(legacyRows).toEqual([
        { id: 'legacy-logo', kind: 'logo', usage: 'asset' },
        { id: 'legacy-reference', kind: 'reference', usage: 'reference' },
      ]);

      for (const [index, kind] of [
        'product',
        'person',
        'environment',
        'graphic_element',
        'texture',
        'background',
        'photo',
      ].entries()) {
        await queryRunner.query(
          `INSERT INTO "brand_kit_assets" ("id", "kind", "usage") VALUES ($1, $2, 'asset')`,
          [`new-${index}`, kind],
        );
      }
      await queryRunner.query(
        `INSERT INTO "brand_kit_assets" ("id", "kind", "usage") VALUES ('new-reference', 'reference', 'reference')`,
      );

      await queryRunner.query('SAVEPOINT invalid_kind');
      await expect(
        queryRunner.query(
          `INSERT INTO "brand_kit_assets" ("id", "kind", "usage") VALUES ('invalid-kind', 'invalid', 'asset')`,
        ),
      ).rejects.toThrow();
      await queryRunner.query('ROLLBACK TO SAVEPOINT invalid_kind');

      await queryRunner.query('SAVEPOINT invalid_usage');
      await expect(
        queryRunner.query(
          `INSERT INTO "brand_kit_assets" ("id", "kind", "usage") VALUES ('invalid-usage', 'product', 'reference')`,
        ),
      ).rejects.toThrow();
      await queryRunner.query('ROLLBACK TO SAVEPOINT invalid_usage');

      await queryRunner.query('SAVEPOINT unsafe_down');
      await expect(migration.down(queryRunner)).rejects.toThrow(
        /Cannot roll back Brand Kit taxonomy/,
      );
      await queryRunner.query('ROLLBACK TO SAVEPOINT unsafe_down');

      await queryRunner.query(
        `DELETE FROM "brand_kit_assets" WHERE "id" LIKE 'new-%'`,
      );
      await migration.down(queryRunner);
      const afterDown = await queryRunner.query(`
        SELECT "id", "kind" FROM "brand_kit_assets" ORDER BY "id"
      `);
      expect(afterDown).toEqual([
        { id: 'legacy-logo', kind: 'logo' },
        { id: 'legacy-reference', kind: 'reference' },
      ]);

      await migration.up(queryRunner);
      const afterSecondUp = await queryRunner.query(`
        SELECT "id", "kind", "usage" FROM "brand_kit_assets" ORDER BY "id"
      `);
      expect(afterSecondUp).toEqual([
        { id: 'legacy-logo', kind: 'logo', usage: 'asset' },
        { id: 'legacy-reference', kind: 'reference', usage: 'reference' },
      ]);
    } finally {
      await queryRunner.rollbackTransaction();
      await queryRunner.release();
    }
  });
});
