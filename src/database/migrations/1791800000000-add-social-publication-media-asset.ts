import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Links a publication to the shared private media identity it publishes (M3.1B). */
export class AddSocialPublicationMediaAsset1791800000000 implements MigrationInterface {
  name = 'AddSocialPublicationMediaAsset1791800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_publications"
        ADD COLUMN IF NOT EXISTS "media_asset_id" uuid
    `);

    await queryRunner.query(`
      ALTER TABLE "social_publications"
        ADD CONSTRAINT "FK_social_publications_media_asset"
        FOREIGN KEY ("media_asset_id")
        REFERENCES "media_assets" ("id")
        ON DELETE RESTRICT
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_publications_media_asset"
        ON "social_publications" ("media_asset_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_social_publications_media_asset"
    `);

    await queryRunner.query(`
      ALTER TABLE "social_publications"
        DROP CONSTRAINT IF EXISTS "FK_social_publications_media_asset"
    `);

    await queryRunner.query(`
      ALTER TABLE "social_publications"
        DROP COLUMN IF EXISTS "media_asset_id"
    `);
  }
}
