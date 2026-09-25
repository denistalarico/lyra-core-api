import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `creative_id` to `social_ad_entities`, so an ad can be shown as a picture.
 *
 * ## One column, and deliberately not a URL
 *
 * The obvious column here would be `thumbnail_url`, and it is the wrong one.
 * Meta's creative thumbnails are CDN links signed with an `oe` parameter that
 * expires in roughly five days: a URL written into a column renders for a few
 * days and then starts returning 403, a failure that surfaces long after the
 * commit that caused it and looks like a broken image rather than a stale
 * cache. `SocialOrganicThumbnailService` exists because the organic side
 * learned this; the paid side stores the creative's **id**, which is stable,
 * and resolves the picture on demand through the same shape.
 *
 * ## Why the id had to be stored at all, rather than read with the ad
 *
 * Measured against the production account: asking the `/ads` edge for
 * `creative{id,thumbnail_url}` costs no additional Graph calls — 260 ads still
 * came back in two pages, 258 of them with a thumbnail and none without a
 * creative. So riding along on the hierarchy sync is free.
 *
 * What is *not* free is the picture's size. `thumbnail_width` and
 * `thumbnail_height` are ignored on the `/ads` edge — every URL it returns is
 * stamped `p64x64`, which is unusable in a table — and honoured on the creative
 * node, which answers `p320x320` for the same creative. Resolving the image
 * therefore means a request per creative, which is exactly what must not happen
 * during a sync and exactly what an on-demand, cached read-time service is for.
 * Storing the id is what makes that later request addressable.
 *
 * ## Nullable, with no default and no backfill
 *
 * NULL means "this sync did not learn a creative for this ad", which covers an
 * ad synced before this column existed and an ad Meta answered about without
 * one. Both render a placeholder. A backfill is unnecessary: the next hierarchy
 * sync fills every row it sees, at no extra call cost, and inventing values now
 * for rows the provider has not been asked about would be writing data we do
 * not have.
 *
 * No index. The column is never a search key — it is read from a row already
 * located by the ad's own identity — and `social_ad_entities` is write-heavy
 * on every sync, where an index nothing queries is pure cost.
 *
 * Length 180 matches `external_id` on the same table. Creative ids are Meta
 * object ids of the same family; a separate width would be a second opinion
 * about the same provider's id format.
 */
export class AddAdCreativeId1796800000000 implements MigrationInterface {
  name = 'AddAdCreativeId1796800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_ad_entities"
        ADD COLUMN IF NOT EXISTS "creative_id" varchar(180)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_ad_entities"
        DROP COLUMN IF EXISTS "creative_id"
    `);
  }
}
