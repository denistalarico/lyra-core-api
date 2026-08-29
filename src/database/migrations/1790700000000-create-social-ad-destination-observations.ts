import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Append-only evidence of the destinations Lyra has *observed* on ad sets.
 *
 * A new table rather than more columns on `social_ad_entities`, because the two
 * answer different questions: that row says where an ad set sends people now,
 * which every screen needs on every render, and these rows say what was seen
 * and when, which only a temporal question needs. And a new table rather than a
 * reuse, because Social has no append-only log to extend — unlike the Inbox,
 * whose qualification history could ride on `inbox_conversation_events`.
 *
 * Every name here says "observed". Meta publishes no timestamp for a
 * destination change: `last_modified_time`, `effective_time` and
 * `destination_type_updated_time` are all dropped from the ad set payload, and
 * the generic `updated_time` moves for any edit at all — in the production
 * account it spreads across 39 distinct days while destinations barely vary.
 * Calling a column `changed_at` or `effective_at` would attach a precise moment
 * to something nobody measured.
 *
 * Nothing is backfilled. Before the first sync after deploy, an ad set's
 * historical destination is genuinely unknown, and inventing rows from the
 * current value, a campaign name or an optimization goal would fabricate the
 * exact history this table exists to record honestly.
 */
export class CreateSocialAdDestinationObservations1790700000000 implements MigrationInterface {
  name = 'CreateSocialAdDestinationObservations1790700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_ad_destination_observations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,
        "connection_id" uuid NOT NULL,
        "ad_entity_id" uuid NOT NULL,
        "provider" varchar(40) NOT NULL,
        "destination_type" varchar(40) NOT NULL,
        "destination_raw" varchar(60),
        "observed_at" timestamptz NOT NULL,
        "sync_run_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_social_ad_destination_observations" PRIMARY KEY ("id"),
        -- The observation is about a mirrored ad set; without that row there is
        -- nothing for it to describe or join to.
        CONSTRAINT "FK_social_ad_destination_obs_entity"
          FOREIGN KEY ("ad_entity_id") REFERENCES "social_ad_entities" ("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_social_ad_destination_obs_connection"
          FOREIGN KEY ("connection_id")
          REFERENCES "social_ad_account_connections" ("id")
          ON DELETE CASCADE,
        -- SET NULL, emphatically not CASCADE: S2.9 deletes old sync runs as
        -- operational history, and losing the record of which sweep saw a
        -- destination must never delete the evidence that it was seen.
        CONSTRAINT "FK_social_ad_destination_obs_run"
          FOREIGN KEY ("sync_run_id") REFERENCES "social_ad_sync_runs" ("id")
          ON DELETE SET NULL
      )
    `);

    // The read path, and the index the temporal resolution uses to find the
    // last observation at or before a given date.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_ad_destination_obs_entity"
        ON "social_ad_destination_observations" ("ad_entity_id", "observed_at")
    `);

    /**
     * Idempotency for a retried run.
     *
     * Deliberately keyed on the run and not on `(entity, destination)`: the
     * latter reads as the obvious uniqueness rule and would make
     * `whatsapp → instagram_direct → whatsapp` impossible to record, because
     * the third observation is a real event that collides with the first.
     *
     * Partial because `sync_run_id` is nullable — a manual sweep outside the
     * queue has no run, and NULLs would quietly disable the constraint for
     * exactly those rows.
     */
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_ad_destination_obs_run"
        ON "social_ad_destination_observations"
        ("ad_entity_id", "sync_run_id", "destination_type")
        WHERE "sync_run_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "social_ad_destination_observations"`,
    );
  }
}
