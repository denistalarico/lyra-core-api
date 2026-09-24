import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * How many of an account's followers were online, by day and hour.
 *
 * The source of both "melhor dia para postar" and "melhor horário para postar".
 * They are one collection, not two: Meta answers `online_followers` with, for
 * each day, a map of 24 hourly counts. The best day is that grid summed across
 * hours, the best hour is it summed across days, and storing the grid rather
 * than either aggregate is what lets a third question be asked later without
 * re-collecting a window that will have expired by then.
 *
 * ## The grain is one hour, and it is a stock
 *
 * A row says "at this hour of this day, this many followers were online". It is
 * not a flow and **must never be summed into a total of people**: the same
 * follower online at 14:00 and 15:00 is one person counted in two rows. The
 * legitimate operations are averaging across days for the same hour, and
 * comparing hours or weekdays to each other — which is exactly what the two
 * charts do.
 *
 * ## Why the hour is stored in Meta's timezone and not the asset's
 *
 * Meta reports this metric with `end_time` at `07:00:00+0000`, which is
 * midnight Pacific — it is stated in PST regardless of where the account is.
 * The hour is stored exactly as Meta indexed it, and `source_timezone` records
 * that it is PST, so the read layer converts to the asset's own timezone when
 * it draws the chart.
 *
 * Converting on the way in would be the tempting shortcut and the wrong one: it
 * bakes an assumption about Meta's timezone into rows that cannot be re-derived
 * if the assumption is wrong, and Meta has changed reporting timezones before.
 * Stored raw, a correction is a change to one function; stored converted, it is
 * a re-collection of a window Meta no longer serves.
 *
 * ## Retention is the reason this is a table at all
 *
 * Meta serves roughly 30 days of this metric and nothing older, so the history
 * only exists if it is captured as it passes. Verified against production on
 * 2026-09-24: a 30-day request returned 28 days carrying data.
 */
export class CreateOrganicOnlineFollowers1796100000000 implements MigrationInterface {
  name = 'CreateOrganicOnlineFollowers1796100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_organic_online_followers" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,
        "asset_id" uuid NOT NULL,
        "provider" character varying(40) NOT NULL,
        -- The calendar day as Meta indexed it, in "source_timezone" below.
        "metric_date" date NOT NULL,
        -- 0-23, likewise in "source_timezone" and not the asset's.
        "hour_of_day" smallint NOT NULL,
        -- The asset's own zone, kept so the read can convert into it.
        "asset_timezone" character varying(64) NOT NULL,
        -- The zone "metric_date" and "hour_of_day" are expressed in. Recorded
        -- rather than assumed: it is what makes the stored hour interpretable
        -- if Meta ever changes it.
        "source_timezone" character varying(64) NOT NULL DEFAULT 'America/Los_Angeles',
        -- Followers online in that hour. A STOCK: never sum across hours or
        -- days to get a number of people.
        "followers_online" bigint NOT NULL,
        "observed_at" timestamp with time zone NOT NULL DEFAULT now(),
        "synced_at" timestamp with time zone NOT NULL DEFAULT now(),
        "sync_run_id" uuid,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "PK_social_organic_online_followers" PRIMARY KEY ("id"),
        CONSTRAINT "CK_social_organic_online_followers_hour"
          CHECK ("hour_of_day" >= 0 AND "hour_of_day" <= 23),
        CONSTRAINT "CK_social_organic_online_followers_non_negative"
          CHECK ("followers_online" >= 0)
      )
    `);

    // One reading per asset, day and hour. A re-read of a day Meta has revised
    // replaces it rather than accumulating: it is a better measurement of the
    // same hour, not another hour.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_organic_online_followers_fact"
        ON "social_organic_online_followers"
        ("asset_id", "metric_date", "hour_of_day")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_organic_online_followers_read"
        ON "social_organic_online_followers"
        ("tenant_id", "workspace_id", "asset_id", "metric_date" DESC)
    `);

    await queryRunner.query(`
      ALTER TABLE "social_organic_online_followers"
        DROP CONSTRAINT IF EXISTS "FK_social_organic_online_followers_asset"
    `);
    await queryRunner.query(`
      ALTER TABLE "social_organic_online_followers"
        ADD CONSTRAINT "FK_social_organic_online_followers_asset"
        FOREIGN KEY ("asset_id") REFERENCES "social_organic_assets"("id")
        ON DELETE CASCADE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "social_organic_online_followers"`,
    );
  }
}
