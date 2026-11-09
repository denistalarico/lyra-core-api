import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Agency-wide look of the approvals board: stage order, color, description. */
export class CreateSocialApprovalBoardPreferences1803200000000 implements MigrationInterface {
  name = 'CreateSocialApprovalBoardPreferences1803200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "social_approval_board_preferences" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "tenant_id" uuid NOT NULL,
      "workspace_id" uuid NOT NULL,
      "stage_order" jsonb NOT NULL DEFAULT '[]',
      "stages" jsonb NOT NULL DEFAULT '{}',
      "updated_by_user_id" uuid,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_approval_board_preferences" ON "social_approval_board_preferences" ("tenant_id", "workspace_id")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "social_approval_board_preferences"`,
    );
  }
}
