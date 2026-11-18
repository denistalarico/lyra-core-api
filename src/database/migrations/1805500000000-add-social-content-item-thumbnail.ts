import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Standalone (calendar-only) posts (2026-11-18): once every destination is
 * published, the file is removed from storage and only a small thumbnail is
 * kept for the calendar and history. It lives on the content item because the
 * destination-creative link is removed with the file.
 *
 * ON DELETE SET NULL: losing the thumbnail never blocks deleting media.
 */
export class AddSocialContentItemThumbnail1805500000000 implements MigrationInterface {
  name = 'AddSocialContentItemThumbnail1805500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_content_items"
        ADD COLUMN IF NOT EXISTS "thumbnail_media_asset_id" uuid NULL
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
           WHERE conname = 'FK_social_content_items_thumbnail_media'
        ) THEN
          ALTER TABLE "social_content_items"
            ADD CONSTRAINT "FK_social_content_items_thumbnail_media"
            FOREIGN KEY ("thumbnail_media_asset_id")
            REFERENCES "media_assets" ("id") ON DELETE SET NULL;
        END IF;
      END $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_content_items"
        DROP CONSTRAINT IF EXISTS "FK_social_content_items_thumbnail_media"
    `);
    await queryRunner.query(`
      ALTER TABLE "social_content_items"
        DROP COLUMN IF EXISTS "thumbnail_media_asset_id"
    `);
  }
}
