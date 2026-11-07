import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Boost authorized while scheduling in the Planner and executed by the
 * campaigns runner after the publication is published. One live boost per
 * publication: a cancelled one does not block authorizing another.
 */
export class CreateSocialScheduledBoosts1802300000000 implements MigrationInterface {
  name = 'CreateSocialScheduledBoosts1802300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_scheduled_boosts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,
        "company_context_id" uuid,
        "publication_id" uuid NOT NULL,
        "content_item_id" uuid NOT NULL,
        "boost_template_id" uuid NOT NULL,
        "connection_id" uuid NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'pending',
        "boost_request_id" uuid,
        "error_code" varchar(120),
        "attempts" integer NOT NULL DEFAULT 0,
        "spend_acknowledged_at" timestamptz NOT NULL,
        "authorized_by_id" uuid,
        "cancelled_by_id" uuid,
        "cancelled_at" timestamptz,
        "executed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_social_scheduled_boosts_publication"
          FOREIGN KEY ("publication_id") REFERENCES "social_publications" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_social_scheduled_boosts_content_item"
          FOREIGN KEY ("content_item_id") REFERENCES "social_content_items" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_social_scheduled_boosts_template"
          FOREIGN KEY ("boost_template_id") REFERENCES "social_boost_templates" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_social_scheduled_boosts_connection"
          FOREIGN KEY ("connection_id") REFERENCES "social_ad_account_connections" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_social_scheduled_boosts_request"
          FOREIGN KEY ("boost_request_id") REFERENCES "social_boost_requests" ("id") ON DELETE SET NULL,
        CONSTRAINT "CK_social_scheduled_boosts_status"
          CHECK ("status" IN ('pending', 'executing', 'executed', 'failed', 'cancelled'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_scheduled_boosts_scope"
        ON "social_scheduled_boosts"
        ("tenant_id", "workspace_id", "agency_client_id", "company_context_id")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_scheduled_boosts_live_publication"
        ON "social_scheduled_boosts" ("publication_id")
        WHERE "status" <> 'cancelled'
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_scheduled_boosts_pending"
        ON "social_scheduled_boosts" ("status", "publication_id")
        WHERE "status" IN ('pending', 'executing')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "social_scheduled_boosts"`);
  }
}
