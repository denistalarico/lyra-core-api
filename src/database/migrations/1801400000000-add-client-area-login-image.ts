import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Persist the optional desktop split-screen image for the Client Area login. */
export class AddClientAreaLoginImage1801400000000 implements MigrationInterface {
  name = 'AddClientAreaLoginImage1801400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "client_area_settings" ADD COLUMN IF NOT EXISTS "login_image_url" text`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "client_area_settings" DROP COLUMN IF EXISTS "login_image_url"`,
    );
  }
}
