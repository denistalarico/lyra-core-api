import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Normalized organic interactions — posts, comments and mentions (W1.2).
 *
 * Separate from `social_organic_webhook_events` on purpose: that table is
 * transport (one row per *delivery*, keyed by a fingerprint of the bytes,
 * holding the raw payload), this one is product (one row per *thing that
 * happened*, keyed by the provider's id for it, holding only normalized
 * fields). Using the receipt table as a read model would have meant querying
 * product data out of JSON that exists for audit.
 *
 * Two schema decisions worth stating here rather than leaving to inference:
 *
 * - **Scope is NOT NULL**, unlike on the receipt. A receipt must survive an
 *   unresolvable scope because it is evidence Meta sent something; an
 *   interaction must not, because a row with no tenant cannot be shown to
 *   anyone without guessing. Unresolved deliveries stop at the receipt.
 * - **`UQ_social_organic_interactions_external` is the idempotency guarantee**,
 *   and it deliberately excludes `interaction_type`: a comment that is created
 *   and later edited is one comment, so an update converges onto the same row
 *   instead of inserting a second.
 *
 * No foreign key to `social_organic_assets` or to the receipt: an interaction
 * must outlive both a disconnected asset and a purged receipt.
 */
export class CreateSocialOrganicInteractions1792300000000 implements MigrationInterface {
  name = 'CreateSocialOrganicInteractions1792300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_organic_interactions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,
        "asset_id" uuid NOT NULL,
        "provider" varchar(40) NOT NULL,
        "surface" varchar(40) NOT NULL,
        "interaction_type" varchar(40) NOT NULL,
        "external_interaction_id" varchar(180) NOT NULL,
        "external_parent_id" varchar(180),
        "external_content_id" varchar(180),
        "actor_external_id" varchar(180),
        "actor_display_name" varchar(240),
        "text" text,
        "occurred_at" timestamptz NOT NULL,
        "provider_created_at" timestamptz,
        "status" varchar(24) NOT NULL DEFAULT 'active',
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "source_webhook_event_id" uuid,
        "retain_until" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CK_social_organic_interactions_type"
          CHECK ("interaction_type" IN (
            'post_created', 'post_updated', 'post_removed',
            'comment_created', 'comment_updated', 'comment_removed',
            'mention_created', 'page_feed_other'
          )),
        CONSTRAINT "CK_social_organic_interactions_surface"
          CHECK ("surface" IN (
            'page_feed', 'page_mention',
            'instagram_comments', 'instagram_mentions'
          )),
        CONSTRAINT "CK_social_organic_interactions_status"
          CHECK ("status" IN ('active', 'removed'))
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_organic_interactions_external"
        ON "social_organic_interactions"
        ("provider", "asset_id", "external_interaction_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_organic_interactions_scope"
        ON "social_organic_interactions"
        ("tenant_id", "workspace_id", "agency_client_id", "occurred_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_organic_interactions_asset"
        ON "social_organic_interactions" ("asset_id", "occurred_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_organic_interactions_content"
        ON "social_organic_interactions" ("asset_id", "external_content_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_social_organic_interactions_content"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_social_organic_interactions_asset"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_social_organic_interactions_scope"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_social_organic_interactions_external"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "social_organic_interactions"`,
    );
  }
}
