import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Caches the de-duplicated organic reach of a period, as measured by Meta.
 *
 * The organic overview returned `reach: null` for every window longer than a
 * day, so the card showed a dash permanently. That was honest — reach is unique
 * people and daily figures do not add — but the number exists: asking Meta for
 * the range in one request (`period=day` + `metric_type=total_value`, no
 * breakdown) returns a single figure it de-duplicated itself.
 *
 * Measurements are cached rather than fetched on render for the reason the paid
 * `social_ad_reach_periods` table exists: this is a provider call on a shared
 * quota, and a dashboard that measured on every load would spend that quota on
 * re-reading a number that does not change once its window has closed.
 *
 * Mirrors `social_ad_reach_periods` deliberately, down to the nullable `reach`
 * and the `measured_at` instant — the two answer the same question on different
 * sides of the product, and a reader who has understood one should not have to
 * relearn the other.
 */
export class CreateOrganicReachPeriods1795900000000
  implements MigrationInterface
{
  name = 'CreateOrganicReachPeriods1795900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_organic_reach_periods" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,
        "asset_id" uuid NOT NULL,
        "provider" character varying(40) NOT NULL,
        "period_since" date NOT NULL,
        "period_until" date NOT NULL,
        "asset_timezone" character varying(64) NOT NULL,
        -- Nullable: "Meta reported no reach for this range" is a real answer
        -- and is not the same statement as a measured zero.
        "reach" bigint,
        -- True while the range's last day is still accumulating. A window that
        -- ends today is re-measurable; one that has closed is final.
        "is_partial" boolean NOT NULL DEFAULT false,
        "measured_at" timestamp with time zone NOT NULL DEFAULT now(),
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "PK_social_organic_reach_periods" PRIMARY KEY ("id"),
        CONSTRAINT "CK_social_organic_reach_periods_range"
          CHECK ("period_until" >= "period_since"),
        CONSTRAINT "CK_social_organic_reach_periods_non_negative"
          CHECK ("reach" IS NULL OR "reach" >= 0)
      )
    `);

    // One measurement per asset and range. A second read of the same window
    // replaces the first rather than accumulating: it is a better reading of
    // the same thing, not another thing.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_organic_reach_periods_window"
        ON "social_organic_reach_periods"
        ("asset_id", "period_since", "period_until")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_organic_reach_periods_scope"
        ON "social_organic_reach_periods"
        ("tenant_id", "workspace_id", "asset_id", "period_until" DESC)
    `);

    await queryRunner.query(`
      ALTER TABLE "social_organic_reach_periods"
        DROP CONSTRAINT IF EXISTS "FK_social_organic_reach_periods_asset"
    `);
    await queryRunner.query(`
      ALTER TABLE "social_organic_reach_periods"
        ADD CONSTRAINT "FK_social_organic_reach_periods_asset"
        FOREIGN KEY ("asset_id") REFERENCES "social_organic_assets"("id")
        ON DELETE CASCADE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "social_organic_reach_periods"`,
    );
  }
}
