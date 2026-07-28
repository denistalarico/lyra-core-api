import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPlatformAdminPreferenceFormats1787300000000 implements MigrationInterface {
  name = 'AddPlatformAdminPreferenceFormats1787300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "platform_internal_admins"
      ADD COLUMN IF NOT EXISTS "date_format" varchar(20)
      NOT NULL DEFAULT 'dd/MM/yyyy'
    `);
    await queryRunner.query(`
      ALTER TABLE "platform_internal_admins"
      ADD COLUMN IF NOT EXISTS "time_format" varchar(10)
      NOT NULL DEFAULT '24h'
    `);
    await queryRunner.query(`
      ALTER TABLE "platform_internal_admins"
      DROP CONSTRAINT IF EXISTS "ck_platform_internal_admins_time_format"
    `);
    await queryRunner.query(`
      ALTER TABLE "platform_internal_admins"
      ADD CONSTRAINT "ck_platform_internal_admins_time_format"
      CHECK ("time_format" IN ('12h', '24h'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "platform_internal_admins"
      DROP CONSTRAINT IF EXISTS "ck_platform_internal_admins_time_format"
    `);
    await queryRunner.query(`
      ALTER TABLE "platform_internal_admins"
      DROP COLUMN IF EXISTS "time_format"
    `);
    await queryRunner.query(`
      ALTER TABLE "platform_internal_admins"
      DROP COLUMN IF EXISTS "date_format"
    `);
  }
}
