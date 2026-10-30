import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClientAreaProfilePreferences1801600000000
  implements MigrationInterface
{
  name = 'AddClientAreaProfilePreferences1801600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_profile"
      ADD COLUMN IF NOT EXISTS "phone" varchar(32)
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM "user_profile" WHERE length("phone") > 32) THEN
          RAISE EXCEPTION 'user_profile.phone contains values longer than 32 characters';
        END IF;
      END $$
    `);
    await queryRunner.query(`
      ALTER TABLE "user_profile"
      ALTER COLUMN "phone" TYPE varchar(32)
    `);
    await queryRunner.query(`
      ALTER TABLE "user_profile"
      ADD COLUMN IF NOT EXISTS "avatar_asset_key" varchar(255)
    `);
    await queryRunner.query(`
      ALTER TABLE "client_area_identity_preferences"
      ADD COLUMN IF NOT EXISTS "sidebar_collapsed" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "client_area_identity_preferences"
      DROP COLUMN IF EXISTS "sidebar_collapsed"
    `);
    await queryRunner.query(`
      ALTER TABLE "user_profile"
      ALTER COLUMN "phone" TYPE varchar(40)
    `);
    // `avatar_asset_key` predates R1 in the canonical entity and may already
    // exist in an installation; the repair above must not remove it on down.
  }
}
