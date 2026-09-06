import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Durable organic-publication queue and execution audit trail. */
export class CreateSocialPublications1791600000000 implements MigrationInterface {
  name = 'CreateSocialPublications1791600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_publications" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,

        "content_item_id" uuid NOT NULL,
        "destination_id" uuid,

        "provider" varchar(40) NOT NULL,
        "connection_id" uuid NOT NULL,
        "asset_id" uuid NOT NULL,
        "external_asset_id" varchar(180) NOT NULL,

        "status" varchar(24) NOT NULL,
        "scheduled_at" timestamptz NOT NULL,
        "published_at" timestamptz,

        "external_publication_id" varchar(240),
        "external_permalink" text,

        "payload_snapshot" jsonb NOT NULL,
        "payload_hash" varchar(64) NOT NULL,

        "idempotency_key" varchar(200) NOT NULL,
        "attempts" integer NOT NULL DEFAULT 0,
        "max_attempts" integer NOT NULL DEFAULT 5,
        "available_at" timestamptz NOT NULL,
        "locked_at" timestamptz,
        "locked_by" varchar(120),

        "last_error_code" varchar(240),
        "failure_reason" varchar(40),
        "provider_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,

        "created_by_id" uuid,
        "cancelled_by_id" uuid,
        "cancelled_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT "FK_social_publications_content_item"
          FOREIGN KEY ("content_item_id")
          REFERENCES "social_content_items" ("id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_social_publications_destination"
          FOREIGN KEY ("destination_id")
          REFERENCES "social_content_destinations" ("id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_social_publications_connection"
          FOREIGN KEY ("connection_id")
          REFERENCES "social_organic_connections" ("id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_social_publications_asset"
          FOREIGN KEY ("asset_id")
          REFERENCES "social_organic_assets" ("id")
          ON DELETE RESTRICT,
        CONSTRAINT "CK_social_publications_status"
          CHECK (
            "status" IN (
              'draft',
              'scheduled',
              'queued',
              'processing',
              'published',
              'failed',
              'cancelled'
            )
          ),
        CONSTRAINT "CK_social_publications_failure_reason"
          CHECK (
            "failure_reason" IS NULL OR
            "failure_reason" IN (
              'credential_expired',
              'permission_lost',
              'rate_limited',
              'media_rejected',
              'payload_invalid',
              'provider_unavailable',
              'duplicate_content',
              'asset_disabled',
              'unknown'
            )
          )
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS
        "UQ_social_publications_destination_idempotency"
        ON "social_publications" ("destination_id", "idempotency_key")
        WHERE "destination_id" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_publications_queue"
        ON "social_publications" ("available_at")
        WHERE "status" IN ('queued', 'scheduled')
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_publications_scope_schedule"
        ON "social_publications"
        ("tenant_id", "workspace_id", "agency_client_id", "scheduled_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "social_publications"`);
  }
}
