import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPlatformAdminProfileFields1787700000000 implements MigrationInterface {
  name = 'AddPlatformAdminProfileFields1787700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "platform_admin_identities"
      ADD COLUMN "phone" varchar(40),
      ADD COLUMN "job_title" varchar(80),
      ADD COLUMN "avatar_url" text
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "platform_admin_identities"
      DROP COLUMN "avatar_url",
      DROP COLUMN "job_title",
      DROP COLUMN "phone"
    `);
  }
}
