import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Forms addon F3 (2026-11-17): capture script settings per form.
 * Plan: docs/sprints/forms-addon-implementation-plan-2026-11-17.md (§5.6).
 */
export class AddFormsCapture1804600000000 implements MigrationInterface {
  name = 'AddFormsCapture1804600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "forms" ADD COLUMN IF NOT EXISTS "capture" jsonb NOT NULL DEFAULT '{}'::jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "forms" DROP COLUMN IF EXISTS "capture"`,
    );
  }
}
