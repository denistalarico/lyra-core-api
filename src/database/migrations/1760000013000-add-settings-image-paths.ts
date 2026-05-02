import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSettingsImagePaths1760000013000 implements MigrationInterface {
  name = 'AddSettingsImagePaths1760000013000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_profile"
      ADD COLUMN IF NOT EXISTS "avatar_url" text;
    `);

    await queryRunner.query(`
      ALTER TABLE "user_profile"
      ADD COLUMN IF NOT EXISTS "avatar_path" varchar(255);
    `);

    await queryRunner.query(`
      ALTER TABLE "workspace_settings_company"
      ADD COLUMN IF NOT EXISTS "logo_url" text;
    `);

    await queryRunner.query(`
      ALTER TABLE "workspace_settings_company"
      ADD COLUMN IF NOT EXISTS "logo_path" varchar(255);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "workspace_settings_company"
      DROP COLUMN IF EXISTS "logo_path";
    `);

    await queryRunner.query(`
      ALTER TABLE "workspace_settings_company"
      DROP COLUMN IF EXISTS "logo_url";
    `);

    await queryRunner.query(`
      ALTER TABLE "user_profile"
      DROP COLUMN IF EXISTS "avatar_path";
    `);
  }
}
