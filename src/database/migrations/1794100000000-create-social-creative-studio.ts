import type { MigrationInterface, QueryRunner } from 'typeorm';

/** CS1 logical Creative Studio assets; binaries remain exclusively in media_assets. */
export class CreateSocialCreativeStudio1794100000000 implements MigrationInterface {
  name = 'CreateSocialCreativeStudio1794100000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "social_creative_folders" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "tenant_id" uuid NOT NULL, "workspace_id" uuid NOT NULL, "agency_client_id" uuid,
      "name" varchar(160) NOT NULL, "parent_id" uuid, "created_by_id" uuid, "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "FK_social_creative_folders_parent" FOREIGN KEY ("parent_id") REFERENCES "social_creative_folders" ("id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_social_creative_folders_scope" ON "social_creative_folders" ("tenant_id", "workspace_id", "agency_client_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_social_creative_folders_parent" ON "social_creative_folders" ("parent_id")`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "social_creative_assets" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "tenant_id" uuid NOT NULL, "workspace_id" uuid NOT NULL, "agency_client_id" uuid,
      "name" varchar(255) NOT NULL, "asset_type" varchar(16) NOT NULL, "source_type" varchar(40) NOT NULL DEFAULT 'upload', "status" varchar(16) NOT NULL DEFAULT 'ready',
      "folder_id" uuid, "current_version_id" uuid, "content_item_id" uuid, "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb, "created_by_id" uuid,
      "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(), "archived_at" timestamptz,
      CONSTRAINT "FK_social_creative_assets_folder" FOREIGN KEY ("folder_id") REFERENCES "social_creative_folders" ("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_social_creative_assets_content" FOREIGN KEY ("content_item_id") REFERENCES "social_content_items" ("id") ON DELETE SET NULL,
      CONSTRAINT "CK_social_creative_assets_type" CHECK ("asset_type" IN ('image', 'video')),
      CONSTRAINT "CK_social_creative_assets_status" CHECK ("status" IN ('ready', 'archived'))
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_social_creative_assets_scope_created" ON "social_creative_assets" ("tenant_id", "workspace_id", "agency_client_id", "created_at" DESC)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_social_creative_assets_folder" ON "social_creative_assets" ("folder_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_social_creative_assets_content" ON "social_creative_assets" ("content_item_id")`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "social_creative_asset_versions" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "creative_asset_id" uuid NOT NULL, "version_number" integer NOT NULL,
      "media_asset_id" uuid NOT NULL, "thumbnail_media_asset_id" uuid, "source" varchar(16) NOT NULL, "created_by_id" uuid, "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "UQ_social_creative_asset_versions_number" UNIQUE ("creative_asset_id", "version_number"),
      CONSTRAINT "FK_social_creative_asset_versions_asset" FOREIGN KEY ("creative_asset_id") REFERENCES "social_creative_assets" ("id") ON DELETE CASCADE,
      CONSTRAINT "FK_social_creative_asset_versions_media" FOREIGN KEY ("media_asset_id") REFERENCES "media_assets" ("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_social_creative_asset_versions_thumbnail" FOREIGN KEY ("thumbnail_media_asset_id") REFERENCES "media_assets" ("id") ON DELETE RESTRICT,
      CONSTRAINT "CK_social_creative_asset_versions_number" CHECK ("version_number" > 0),
      CONSTRAINT "CK_social_creative_asset_versions_source" CHECK ("source" IN ('upload', 'replace'))
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_social_creative_asset_versions_asset" ON "social_creative_asset_versions" ("creative_asset_id", "version_number" DESC)`);
    // Added after versions to break the only cyclic relationship safely.
    await queryRunner.query(`ALTER TABLE "social_creative_assets" ADD CONSTRAINT "FK_social_creative_assets_current_version" FOREIGN KEY ("current_version_id") REFERENCES "social_creative_asset_versions" ("id") ON DELETE RESTRICT`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "social_creative_asset_versions"');
    await queryRunner.query('DROP TABLE IF EXISTS "social_creative_assets"');
    await queryRunner.query('DROP TABLE IF EXISTS "social_creative_folders"');
  }
}
