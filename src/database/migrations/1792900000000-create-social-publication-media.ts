import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSocialPublicationMedia1792900000000 implements MigrationInterface {
  name = 'CreateSocialPublicationMedia1792900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "social_publication_media" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "publication_id" uuid NOT NULL,
        "media_asset_id" uuid NOT NULL,
        "role" varchar(40) NOT NULL DEFAULT 'primary',
        "sort_order" integer NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_social_publication_media" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_social_publication_media_order" UNIQUE ("publication_id", "sort_order"),
        CONSTRAINT "FK_social_publication_media_publication" FOREIGN KEY ("publication_id") REFERENCES "social_publications"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_social_publication_media_asset" FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query('CREATE INDEX "IDX_social_publication_media_publication" ON "social_publication_media" ("publication_id")');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "social_publication_media"');
  }
}
