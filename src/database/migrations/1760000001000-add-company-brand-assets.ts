// src/database/migrations/1760000001000-add-company-brand-assets.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCompanyBrandAssets1760000001000 implements MigrationInterface {
  name = 'AddCompanyBrandAssets1760000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "workspace_settings_company"
      ADD COLUMN IF NOT EXISTS "brand_logo_url" varchar(500);
    `);

    await queryRunner.query(`
      ALTER TABLE "workspace_settings_company"
      ADD COLUMN IF NOT EXISTS "brand_logo_asset_key" varchar(255);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "workspace_settings_company"
      DROP COLUMN IF EXISTS "brand_logo_asset_key";
    `);

    await queryRunner.query(`
      ALTER TABLE "workspace_settings_company"
      DROP COLUMN IF EXISTS "brand_logo_url";
    `);
  }
}
