import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReconcileUserProfileSchema1801700000000 implements MigrationInterface {
  name = 'ReconcileUserProfileSchema1801700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_profile"
      ADD COLUMN IF NOT EXISTS "first_name" varchar(60) NOT NULL DEFAULT ''
    `);
    await queryRunner.query(`
      ALTER TABLE "user_profile"
      ADD COLUMN IF NOT EXISTS "last_name" varchar(60) NOT NULL DEFAULT ''
    `);
    await queryRunner.query(`
      ALTER TABLE "user_profile"
      ADD COLUMN IF NOT EXISTS "bio" varchar(280)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_profile"
      DROP COLUMN IF EXISTS "bio"
    `);
    await queryRunner.query(`
      ALTER TABLE "user_profile"
      DROP COLUMN IF EXISTS "last_name"
    `);
    await queryRunner.query(`
      ALTER TABLE "user_profile"
      DROP COLUMN IF EXISTS "first_name"
    `);
  }
}
