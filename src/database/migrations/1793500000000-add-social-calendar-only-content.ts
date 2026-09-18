import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A Calendar quick-add still needs a content item for the immutable
 * publication snapshot, but it is operational scheduling rather than a row
 * in the editorial plan. Keep that distinction as persisted state instead of
 * overloading an editable content-type catalog value.
 */
export class AddSocialCalendarOnlyContent1793500000000
  implements MigrationInterface
{
  name = 'AddSocialCalendarOnlyContent1793500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_content_items"
        ADD COLUMN IF NOT EXISTS "calendar_only" boolean NOT NULL DEFAULT false
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_content_items"
        DROP COLUMN IF EXISTS "calendar_only"
    `);
  }
}
