import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Social Planner publishing cadence foundation.
 *
 * One cadence per Social operational context. This describes preferred
 * publishing rhythm only; it does not schedule or publish provider content.
 */
export class CreateSocialPublishingCadences1791200000000
  implements MigrationInterface
{
  name = 'CreateSocialPublishingCadences1791200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_publishing_cadences" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),

        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,

        "timezone" varchar(120)
          NOT NULL DEFAULT 'America/Sao_Paulo',

        "auto_distribution_enabled" boolean
          NOT NULL DEFAULT false,

        "channels" jsonb
          NOT NULL DEFAULT '[]'::jsonb,

        "created_by_id" uuid,
        "updated_by_id" uuid,

        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT "PK_social_publishing_cadences"
          PRIMARY KEY ("id"),

        CONSTRAINT "CK_social_publishing_cadences_channels_array"
          CHECK (jsonb_typeof("channels") = 'array')
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS
        "UQ_social_publishing_cadences_agency_scope"
        ON "social_publishing_cadences" (
          "tenant_id",
          "workspace_id"
        )
        WHERE "agency_client_id" IS NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS
        "UQ_social_publishing_cadences_client_scope"
        ON "social_publishing_cadences" (
          "tenant_id",
          "workspace_id",
          "agency_client_id"
        )
        WHERE "agency_client_id" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS
        "IDX_social_publishing_cadences_scope"
        ON "social_publishing_cadences" (
          "tenant_id",
          "workspace_id",
          "agency_client_id"
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_social_publishing_cadences_scope"',
    );

    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_social_publishing_cadences_client_scope"',
    );

    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_social_publishing_cadences_agency_scope"',
    );

    await queryRunner.query(
      'DROP TABLE IF EXISTS "social_publishing_cadences"',
    );
  }
}
