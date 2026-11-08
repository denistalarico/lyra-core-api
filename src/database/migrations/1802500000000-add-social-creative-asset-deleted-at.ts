import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSocialCreativeAssetDeletedAt1802500000000 implements MigrationInterface {
  name = 'AddSocialCreativeAssetDeletedAt1802500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "social_creative_assets" ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "social_creative_assets" DROP COLUMN IF EXISTS "deleted_at"`,
    );
  }
}
