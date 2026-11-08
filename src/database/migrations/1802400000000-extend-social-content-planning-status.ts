import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds two terminal Planner states:
 * - `cancelled`: the operator dropped the item; it must not be published.
 * - `posted`: set by the publication runner when a publication goes live.
 */
export class ExtendSocialContentPlanningStatus1802400000000 implements MigrationInterface {
  name = 'ExtendSocialContentPlanningStatus1802400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_content_items"
        DROP CONSTRAINT IF EXISTS "CK_social_content_items_status"
    `);
    await queryRunner.query(`
      ALTER TABLE "social_content_items"
        ADD CONSTRAINT "CK_social_content_items_status"
        CHECK ("planning_status" IN ('idea', 'planned', 'copy_in_progress', 'copy_ready', 'creative_in_progress', 'creative_ready', 'ready', 'cancelled', 'posted'))
    `);
    // Items that already went live become `posted`.
    await queryRunner.query(`
      UPDATE "social_content_items" AS item
         SET "planning_status" = 'posted'
       WHERE item."deleted_at" IS NULL
         AND EXISTS (
           SELECT 1 FROM "social_publications" AS publication
            WHERE publication."content_item_id" = item."id"
              AND publication."status" = 'published'
         )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "social_content_items"
         SET "planning_status" = 'ready'
       WHERE "planning_status" IN ('cancelled', 'posted')
    `);
    await queryRunner.query(`
      ALTER TABLE "social_content_items"
        DROP CONSTRAINT IF EXISTS "CK_social_content_items_status"
    `);
    await queryRunner.query(`
      ALTER TABLE "social_content_items"
        ADD CONSTRAINT "CK_social_content_items_status"
        CHECK ("planning_status" IN ('idea', 'planned', 'copy_in_progress', 'copy_ready', 'creative_in_progress', 'creative_ready', 'ready'))
    `);
  }
}
