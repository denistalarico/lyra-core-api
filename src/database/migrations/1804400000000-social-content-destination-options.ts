import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-destination publishing options (Planner refinements, 2026-11-16).
 *
 * The item keeps one shared caption; a destination may override it (a network
 * with a shorter limit, e.g. X) and carry fields only its network has
 * (YouTube title, privacy, audience). Empty object = inherit everything.
 */
export class SocialContentDestinationOptions1804400000000 implements MigrationInterface {
  name = 'SocialContentDestinationOptions1804400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_content_destinations"
        ADD COLUMN IF NOT EXISTS "options" jsonb NOT NULL DEFAULT '{}'::jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_content_destinations" DROP COLUMN IF EXISTS "options"
    `);
  }
}
