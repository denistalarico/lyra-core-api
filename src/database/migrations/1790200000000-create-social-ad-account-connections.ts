import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ad account connections for Lyra Social — the first runtime table of the
 * product.
 *
 * One row per ad account, plus the in-flight rows of an authorization still in
 * progress. Keeping both in one table is deliberate: "connecting" and
 * "waiting for account selection" are states of a connection, and a separate
 * session table would duplicate the tenant/workspace/client scope and force
 * every settings read to union two sources.
 *
 * The unique key is what stops two rows from holding a live credential for the
 * same account — a duplicate would mean a later disconnect revokes only one of
 * them, leaving a token nobody can see and nobody can remove. `NULL` is
 * distinct in a Postgres unique index, so rows that never reached an account
 * never collide with each other.
 *
 * No metrics, campaign, recommendation or policy table is created here. This
 * slice connects an account; it does not read one.
 */
export class CreateSocialAdAccountConnections1790200000000 implements MigrationInterface {
  name = 'CreateSocialAdAccountConnections1790200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_ad_account_connections" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,
        "provider" varchar(40) NOT NULL,
        "external_account_id" varchar(180),
        "external_business_id" varchar(180),
        "account_name" varchar(240),
        "currency" varchar(8),
        "timezone" varchar(64),
        "connection_status" varchar(32) NOT NULL DEFAULT 'pending',
        "credential_version" integer NOT NULL DEFAULT 1,
        "access_token_encrypted" text,
        "refresh_token_encrypted" text,
        "token_expires_at" timestamptz,
        "scopes" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "last_synced_at" timestamptz,
        "last_sync_error" varchar(240),
        "oauth_state_hash" varchar(64),
        "oauth_expires_at" timestamptz,
        "created_by_id" uuid,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "credential_removed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_ad_account_connections_account"
        ON "social_ad_account_connections"
        ("tenant_id", "workspace_id", "provider", "external_account_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_ad_account_connections_context"
        ON "social_ad_account_connections"
        ("tenant_id", "workspace_id", "agency_client_id")
    `);

    // The OAuth callback arrives with no session and looks the row up by this
    // hash alone, so it is a hot single-column lookup on a public endpoint.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_ad_account_connections_oauth_state"
        ON "social_ad_account_connections" ("oauth_state_hash")
        WHERE "oauth_state_hash" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "social_ad_account_connections"`,
    );
  }
}
