import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CS3.6.1 — indexes for the temporary-output cleanup. No column, constraint
 * or state: "binary expired" is already representable (tombstone
 * `media_assets.deleted_at`, then `outputs.media_asset_id` SET NULL).
 *
 *   IDX_media_assets_temporary_generation
 *     The sweep reads only `temporary:creative_generation` rows, oldest first.
 *     Without it every hourly tick scans the whole `media_assets` table, which
 *     grows forever with durable media. Partial: purged rows are hard-deleted,
 *     so the index only ever holds live temporaries + pending tombstones
 *     (bounded by the retention window), however much durable media exists.
 *
 *   IDX_..._media on the four RESTRICT referencing columns that had none
 *     The eligibility predicate checks each owner with NOT EXISTS, and every
 *     DELETE of a media row runs a FK check per referencing column. Unindexed,
 *     both are sequential scans of growing tables per deleted row.
 *     (`social_publications`, `social_content_references` and generation
 *     outputs/references are already indexed on `media_asset_id`.)
 *
 * Plain CREATE INDEX (TypeORM wraps migrations in a transaction, so not
 * CONCURRENTLY): the tables are small today (production 2026-10-07: 17 media,
 * 1 version, 1 publication media, 14 destination creatives). Re-runnable.
 */
export class AddCreativeGenerationCleanupIndexes1798400000000 implements MigrationInterface {
  name = 'AddCreativeGenerationCleanupIndexes1798400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_media_assets_temporary_generation"
        ON "media_assets" ("created_at", "id")
        WHERE "source" = 'temporary:creative_generation'
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_creative_asset_versions_media"
        ON "social_creative_asset_versions" ("media_asset_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_creative_asset_versions_thumbnail_media"
        ON "social_creative_asset_versions" ("thumbnail_media_asset_id")
        WHERE "thumbnail_media_asset_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_publication_media_media"
        ON "social_publication_media" ("media_asset_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_destination_creatives_media"
        ON "social_destination_creatives" ("media_asset_id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const index of [
      'IDX_social_destination_creatives_media',
      'IDX_social_publication_media_media',
      'IDX_social_creative_asset_versions_thumbnail_media',
      'IDX_social_creative_asset_versions_media',
      'IDX_media_assets_temporary_generation',
    ])
      await queryRunner.query(`DROP INDEX IF EXISTS "${index}"`);
  }
}
