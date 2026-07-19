import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInboxDecisionReviewOutcomes1784500000000 implements MigrationInterface {
  name = 'AddInboxDecisionReviewOutcomes1784500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "inbox_agent_decisions"
        ADD COLUMN IF NOT EXISTS "review_outcome" varchar(40),
        ADD COLUMN IF NOT EXISTS "reviewed_action_keys" jsonb NOT NULL DEFAULT '[]'::jsonb
    `);
    await queryRunner.query(`
      ALTER TABLE "inbox_agent_decisions"
        ADD CONSTRAINT "chk_inbox_agent_decisions_review_outcome"
        CHECK (
          "review_outcome" IS NULL OR "review_outcome" IN (
            'analysis_approved',
            'actions_partially_approved',
            'actions_applied',
            'decision_rejected'
          )
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "inbox_agent_decisions"
        DROP CONSTRAINT IF EXISTS "chk_inbox_agent_decisions_review_outcome",
        DROP COLUMN IF EXISTS "reviewed_action_keys",
        DROP COLUMN IF EXISTS "review_outcome"
    `);
  }
}
