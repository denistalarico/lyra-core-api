import type { MigrationInterface, QueryRunner } from 'typeorm';

/** A second confirmation now activates the complete Boost hierarchy. */
export class ActivateConfirmedSocialBoosts1794000000000
  implements MigrationInterface
{
  name = 'ActivateConfirmedSocialBoosts1794000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_boost_requests"
        DROP CONSTRAINT IF EXISTS "CK_social_boost_requests_status"
    `);
    await queryRunner.query(`
      ALTER TABLE "social_boost_requests"
        ADD CONSTRAINT "CK_social_boost_requests_status"
        CHECK ("status" IN ('pending_confirmation', 'executing', 'created_active', 'created_paused', 'blocked', 'failed', 'expired'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_boost_requests"
        DROP CONSTRAINT IF EXISTS "CK_social_boost_requests_status"
    `);
    await queryRunner.query(`
      ALTER TABLE "social_boost_requests"
        ADD CONSTRAINT "CK_social_boost_requests_status"
        CHECK ("status" IN ('pending_confirmation', 'executing', 'created_paused', 'blocked', 'failed', 'expired'))
    `);
  }
}
