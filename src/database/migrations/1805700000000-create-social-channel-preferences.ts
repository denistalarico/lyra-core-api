import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Social channels switched off per context (2026-11-23). Switching a channel
 * off keeps its connection and configuration; the product only stops offering
 * it. One row per context and channel; the scope ids are coalesced in the
 * unique index because the agency's own context has both as NULL.
 */
export class CreateSocialChannelPreferences1805700000000 implements MigrationInterface {
  name = 'CreateSocialChannelPreferences1805700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_channel_preferences" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid NULL,
        "company_context_id" uuid NULL,
        "channel" varchar(40) NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "updated_by_id" uuid NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_social_channel_preferences" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_channel_preferences_scope"
        ON "social_channel_preferences" (
          "tenant_id",
          "workspace_id",
          COALESCE("agency_client_id", '00000000-0000-0000-0000-000000000000'::uuid),
          COALESCE("company_context_id", '00000000-0000-0000-0000-000000000000'::uuid),
          "channel"
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "social_channel_preferences"`,
    );
  }
}
