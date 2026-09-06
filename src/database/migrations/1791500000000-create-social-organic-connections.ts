import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Provider-neutral connection and publishable-asset foundation for Social. */
export class CreateSocialOrganicConnections1791500000000 implements MigrationInterface {
  name = 'CreateSocialOrganicConnections1791500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_organic_connections" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,
        "provider" varchar(40) NOT NULL,
        "connection_status" varchar(32) NOT NULL DEFAULT 'pending',
        "authorization_method" varchar(40) NOT NULL,
        "credential_version" integer NOT NULL DEFAULT 1,
        "access_token_encrypted" text,
        "refresh_token_encrypted" text,
        "token_expires_at" timestamptz,
        "scopes" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "oauth_state_hash" varchar(64),
        "oauth_expires_at" timestamptz,
        "created_by_id" uuid,
        "credential_removed_at" timestamptz,
        "last_error" varchar(240),
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_organic_connections_context"
        ON "social_organic_connections"
        ("tenant_id", "workspace_id", "agency_client_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_organic_connections_oauth_state"
        ON "social_organic_connections" ("oauth_state_hash")
        WHERE "oauth_state_hash" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_organic_assets" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,
        "connection_id" uuid NOT NULL,
        "provider" varchar(40) NOT NULL,
        "asset_type" varchar(64) NOT NULL,
        "external_asset_id" varchar(180) NOT NULL,
        "display_name" varchar(240),
        "username" varchar(180),
        "avatar_url" text,
        "asset_token_encrypted" text,
        "asset_token_expires_at" timestamptz,
        "is_publish_enabled" boolean NOT NULL DEFAULT false,
        "capabilities_snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "status" varchar(32) NOT NULL DEFAULT 'active',
        "last_health_check_at" timestamptz,
        "last_health_status" varchar(64),
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_social_organic_assets_connection"
          FOREIGN KEY ("connection_id")
          REFERENCES "social_organic_connections" ("id")
          ON DELETE RESTRICT,
        CONSTRAINT "UQ_social_organic_assets_external_asset"
          UNIQUE ("tenant_id", "workspace_id", "provider", "external_asset_id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_organic_assets_context"
        ON "social_organic_assets"
        ("tenant_id", "workspace_id", "agency_client_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_organic_assets_connection"
        ON "social_organic_assets" ("connection_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "social_organic_assets"`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "social_organic_connections"`,
    );
  }
}
