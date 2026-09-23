import type { MigrationInterface, QueryRunner } from 'typeorm';

/** AP2: views are audit data, never approval decisions or state transitions. */
export class AddSocialApprovalViewedAudit1795800000000
  implements MigrationInterface
{
  name = 'AddSocialApprovalViewedAudit1795800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "social_approval_requests" ADD COLUMN IF NOT EXISTS "internal_first_viewed_at" timestamptz',
    );
    await queryRunner.query(
      'ALTER TABLE "social_approval_requests" ADD COLUMN IF NOT EXISTS "internal_last_viewed_at" timestamptz',
    );
    await queryRunner.query(
      'ALTER TABLE "social_approval_requests" ADD COLUMN IF NOT EXISTS "internal_viewed_by_user_id" uuid',
    );
    await queryRunner.query(
      'ALTER TABLE "social_approval_requests" ADD COLUMN IF NOT EXISTS "client_viewed_by_user_id" uuid',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "social_approval_requests" DROP COLUMN IF EXISTS "client_viewed_by_user_id"',
    );
    await queryRunner.query(
      'ALTER TABLE "social_approval_requests" DROP COLUMN IF EXISTS "internal_viewed_by_user_id"',
    );
    await queryRunner.query(
      'ALTER TABLE "social_approval_requests" DROP COLUMN IF EXISTS "internal_last_viewed_at"',
    );
    await queryRunner.query(
      'ALTER TABLE "social_approval_requests" DROP COLUMN IF EXISTS "internal_first_viewed_at"',
    );
  }
}
