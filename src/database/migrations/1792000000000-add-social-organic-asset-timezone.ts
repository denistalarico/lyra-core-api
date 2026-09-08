import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Adds the provider-confirmed IANA timezone required by Organic Analytics. */
export class AddSocialOrganicAssetTimezone1792000000000 implements MigrationInterface {
  name = 'AddSocialOrganicAssetTimezone1792000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_organic_assets"
      ADD COLUMN "asset_timezone" varchar(64)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_organic_assets"
      DROP COLUMN "asset_timezone"
    `);
  }
}
