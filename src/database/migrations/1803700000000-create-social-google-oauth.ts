import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * G0.4.2 — Google OAuth foundation (GA4, Ads, Business Profile).
 *
 * Additive only: four new tables, no change to existing ones. `down` drops
 * them, which discards stored Google credentials — acceptable for a rollback
 * because every connection can be re-authorized.
 */
export class CreateSocialGoogleOAuth1803700000000 implements MigrationInterface {
  name = 'CreateSocialGoogleOAuth1803700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_google_authorizations" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid NULL,
        "company_context_id" uuid NULL,
        "google_sub" varchar(255) NOT NULL,
        "status" varchar(24) NOT NULL DEFAULT 'connected',
        "access_token_encrypted" text NULL,
        "refresh_token_encrypted" text NULL,
        "token_expires_at" timestamptz NULL,
        "granted_scopes" text[] NOT NULL DEFAULT '{}',
        "credential_version" integer NOT NULL DEFAULT 1,
        "connected_by_id" uuid NULL,
        "connected_at" timestamptz NOT NULL DEFAULT now(),
        "revoked_at" timestamptz NULL,
        "last_error" varchar(64) NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_social_google_authorizations_status"
          CHECK ("status" IN ('connected','reauth_required','revoked'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_social_google_authorizations_context"
         ON "social_google_authorizations"
         ("tenant_id","workspace_id","agency_client_id","company_context_id")`,
    );
    // One live authorization per context. NULL ids are coalesced because
    // Postgres treats NULLs as distinct in unique indexes.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_google_authorizations_live_context"
         ON "social_google_authorizations" (
           "tenant_id","workspace_id",
           COALESCE("agency_client_id",'00000000-0000-0000-0000-000000000000'::uuid),
           COALESCE("company_context_id",'00000000-0000-0000-0000-000000000000'::uuid)
         ) WHERE "status" <> 'revoked'`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_google_oauth_sessions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid NULL,
        "company_context_id" uuid NULL,
        "initiated_by_id" uuid NOT NULL,
        "product" varchar(24) NOT NULL,
        "status" varchar(24) NOT NULL DEFAULT 'pending',
        "state_hash" varchar(64) NOT NULL,
        "code_verifier_encrypted" text NULL,
        "nonce_hash" varchar(64) NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "google_sub" varchar(255) NULL,
        "access_token_encrypted" text NULL,
        "refresh_token_encrypted" text NULL,
        "token_expires_at" timestamptz NULL,
        "granted_scopes" text[] NOT NULL DEFAULT '{}',
        "failure_reason" varchar(64) NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_social_google_oauth_sessions_product"
          CHECK ("product" IN ('ga4','ads','business_profile')),
        CONSTRAINT "CHK_social_google_oauth_sessions_status"
          CHECK ("status" IN ('pending','awaiting_confirmation','consumed','failed'))
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_google_oauth_sessions_state"
         ON "social_google_oauth_sessions" ("state_hash")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_google_product_links" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "authorization_id" uuid NOT NULL
          REFERENCES "social_google_authorizations" ("id") ON DELETE CASCADE,
        "tenant_id" uuid NOT NULL,
        "product" varchar(24) NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'connected',
        "resources" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "connected_at" timestamptz NULL,
        "disconnected_at" timestamptz NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_social_google_product_links_product"
          CHECK ("product" IN ('ga4','ads','business_profile')),
        CONSTRAINT "CHK_social_google_product_links_status"
          CHECK ("status" IN ('connected','disconnected'))
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_google_product_links_authorization_product"
         ON "social_google_product_links" ("authorization_id","product")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_google_audit_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "authorization_id" uuid NULL,
        "event" varchar(48) NOT NULL,
        "product" varchar(24) NULL,
        "actor_id" uuid NULL,
        "detail" varchar(64) NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_social_google_audit_events_authorization"
         ON "social_google_audit_events" ("authorization_id","created_at")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "social_google_audit_events"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "social_google_product_links"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "social_google_oauth_sessions"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "social_google_authorizations"`,
    );
  }
}
