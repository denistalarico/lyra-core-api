// src/database/migrations/1760000002000-alter-company-brand-logo-url-to-text.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlterCompanyBrandLogoUrlToText1760000002000 implements MigrationInterface {
  name = 'AlterCompanyBrandLogoUrlToText1760000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "workspace_settings_company"
      ALTER COLUMN "brand_logo_url" TYPE text;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "workspace_settings_company"
      ALTER COLUMN "brand_logo_url" TYPE varchar(500);
    `);
  }
}
