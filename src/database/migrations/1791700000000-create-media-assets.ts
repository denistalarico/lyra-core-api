import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Shared persistent identity for reusable private-bucket media. */
export class CreateMediaAssets1791700000000 implements MigrationInterface {
  name = 'CreateMediaAssets1791700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "media_assets" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,

        "storage_path" varchar(512) NOT NULL,
        "mime_type" varchar(128) NOT NULL,
        "byte_size" bigint NOT NULL,

        "original_filename" varchar(255),
        "checksum" char(64),

        "width" integer,
        "height" integer,
        "duration_ms" bigint,
        "codec" varchar,

        "source" varchar NOT NULL,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,

        "created_by_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_media_assets_scope"
        ON "media_assets" ("tenant_id", "workspace_id", "agency_client_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_media_assets_scope_checksum"
        ON "media_assets"
        ("tenant_id", "workspace_id", "agency_client_id", "checksum")
        WHERE "checksum" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "media_assets"`);
  }
}
