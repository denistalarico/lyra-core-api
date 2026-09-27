import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fills `views_paid` on Instagram account days from the `AD` bucket Meta sent
 * all along.
 *
 * ## Why the column was empty on Instagram
 *
 * The account sync asks for `views` with `breakdown=media_product_type`, and
 * the normalizer summed every bucket except `AD` into `impressions` — the
 * organic figure. The `AD` bucket was read and dropped, so the Instagram block
 * could show organic and total impressions (`views_total`, from 1796000000000)
 * but never the paid ones. The column itself exists since 1796500000000, where
 * the Facebook Page fills it from `page_media_view`'s `is_from_ads` split.
 *
 * ## Why the bucket may be read as the paid figure
 *
 * Views are counts, not people, so unlike reach the buckets partition the
 * total: on the day this was checked against, `AD` 1 306 + `POST` 3 = 1 309,
 * exactly `total_value.value`. This is Meta's own paid slice, not the
 * `total - organic` subtraction migration 1796000000000 rules out.
 *
 * A day whose breakdown is present but carries no `AD` bucket was a day with
 * no ad delivery, and is stored as 0. A day with no breakdown at all is left
 * null — it says nothing about ads.
 *
 * ## No provider call
 *
 * `provider_metrics` holds every payload, so the history is recovered in one
 * UPDATE. `WHERE views_paid IS NULL` keeps it idempotent and leaves a value a
 * newer sync already wrote alone.
 */
export class BackfillInstagramDailyPaidViews1797000000000 implements MigrationInterface {
  name = 'BackfillInstagramDailyPaidViews1797000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // `jsonb_typeof` guards at each level, for the reason 1795600000000 gives:
    // a malformed payload must be skipped, not abort the migration.
    await queryRunner.query(
      `UPDATE "social_organic_account_metrics_daily" AS fact
          SET "views_paid" = paid.value
         FROM (
           SELECT day."id",
                  COALESCE(
                    SUM((result ->> 'value')::bigint) FILTER (
                      WHERE result -> 'dimension_values' ->> 0 = 'AD'
                        AND jsonb_typeof(result -> 'value') = 'number'
                    ),
                    0
                  ) AS value
             FROM "social_organic_account_metrics_daily" AS day
             JOIN "social_organic_assets" AS asset
               ON asset."id" = day."asset_id"
              AND asset."asset_type" = 'instagram_professional'
            CROSS JOIN LATERAL jsonb_array_elements(
                   day."provider_metrics" -> 'views' -> 'total_value' -> 'breakdowns'
                 ) AS breakdown
             LEFT JOIN LATERAL jsonb_array_elements(
                   CASE
                     WHEN jsonb_typeof(breakdown -> 'results') = 'array'
                       THEN breakdown -> 'results'
                     ELSE '[]'::jsonb
                   END
                 ) AS result ON true
            WHERE day."views_paid" IS NULL
              AND jsonb_typeof(
                    day."provider_metrics" -> 'views' -> 'total_value' -> 'breakdowns'
                  ) = 'array'
              AND jsonb_typeof(breakdown -> 'dimension_keys') = 'array'
              AND breakdown -> 'dimension_keys' ? 'media_product_type'
            GROUP BY day."id"
         ) AS paid
        WHERE fact."id" = paid."id"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Only the Instagram rows this filled; the Page's values come from a
    // different metric and are not this migration's to clear. Nothing is lost:
    // `provider_metrics` still holds the payloads, so `up()` is repeatable.
    await queryRunner.query(
      `UPDATE "social_organic_account_metrics_daily" AS fact
          SET "views_paid" = NULL
         FROM "social_organic_assets" AS asset
        WHERE asset."id" = fact."asset_id"
          AND asset."asset_type" = 'instagram_professional'`,
    );
  }
}
