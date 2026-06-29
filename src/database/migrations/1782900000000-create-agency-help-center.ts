import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Official Lyra Help Center.
 *
 * These tables hold platform-owned ("system") help content and are
 * intentionally GLOBAL: they carry no tenant_id / workspace_id. The content is
 * the same for every tenant, authored by the platform and versioned in code
 * (see modules/knowledge/help/content). It must never be mixed with the
 * tenant-scoped agency_knowledge_* tables, which hold user/company content.
 */
export class CreateAgencyHelpCenter1782900000000 implements MigrationInterface {
  name = "CreateAgencyHelpCenter1782900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "help_categories" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "key" character varying(120) NOT NULL,
        "title" character varying(180) NOT NULL,
        "description" text,
        "icon" character varying(80),
        "color" character varying(32),
        "product_key" character varying(80) NOT NULL DEFAULT 'lyra-agency',
        "module_key" character varying(80),
        "sort_order" integer NOT NULL DEFAULT 0,
        "locale" character varying(8) NOT NULL DEFAULT 'pt-BR',
        "status" character varying(20) NOT NULL DEFAULT 'published',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_help_categories" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_help_categories_key_locale"
      ON "help_categories" ("key", "locale")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_help_categories_locale_status"
      ON "help_categories" ("locale", "status")
    `);

    await queryRunner.query(`
      CREATE TABLE "help_trails" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "key" character varying(120) NOT NULL,
        "title" character varying(180) NOT NULL,
        "description" text,
        "audience" character varying(160),
        "estimated_minutes" integer NOT NULL DEFAULT 0,
        "product_key" character varying(80) NOT NULL DEFAULT 'lyra-agency',
        "module_key" character varying(80),
        "sort_order" integer NOT NULL DEFAULT 0,
        "locale" character varying(8) NOT NULL DEFAULT 'pt-BR',
        "status" character varying(20) NOT NULL DEFAULT 'published',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_help_trails" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_help_trails_key_locale"
      ON "help_trails" ("key", "locale")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_help_trails_locale_status"
      ON "help_trails" ("locale", "status")
    `);

    await queryRunner.query(`
      CREATE TABLE "help_articles" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "system_key" character varying(160) NOT NULL,
        "slug" character varying(200) NOT NULL,
        "title" character varying(220) NOT NULL,
        "summary" text,
        "content" text NOT NULL DEFAULT '',
        "content_format" character varying(16) NOT NULL DEFAULT 'html',
        "category_key" character varying(120),
        "product_key" character varying(80) NOT NULL DEFAULT 'lyra-agency',
        "module_key" character varying(80),
        "locale" character varying(8) NOT NULL DEFAULT 'pt-BR',
        "version" integer NOT NULL DEFAULT 1,
        "sort_order" integer NOT NULL DEFAULT 0,
        "status" character varying(20) NOT NULL DEFAULT 'published',
        "is_featured" boolean NOT NULL DEFAULT false,
        "searchable" boolean NOT NULL DEFAULT true,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_help_articles" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_help_articles_system_key_locale"
      ON "help_articles" ("system_key", "locale")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_help_articles_slug_locale"
      ON "help_articles" ("slug", "locale")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_help_articles_category"
      ON "help_articles" ("locale", "category_key", "status")
    `);

    await queryRunner.query(`
      CREATE TABLE "help_trail_articles" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "trail_id" uuid NOT NULL,
        "article_id" uuid NOT NULL,
        "sort_order" integer NOT NULL DEFAULT 0,
        "required" boolean NOT NULL DEFAULT true,
        "estimated_minutes" integer,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_help_trail_articles" PRIMARY KEY ("id"),
        CONSTRAINT "FK_help_trail_articles_trail" FOREIGN KEY ("trail_id")
          REFERENCES "help_trails" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_help_trail_articles_article" FOREIGN KEY ("article_id")
          REFERENCES "help_articles" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_help_trail_articles_unique"
      ON "help_trail_articles" ("trail_id", "article_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_help_trail_articles_trail"
      ON "help_trail_articles" ("trail_id", "sort_order")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_help_trail_articles_trail"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_help_trail_articles_unique"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "help_trail_articles"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_help_articles_category"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_help_articles_slug_locale"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_help_articles_system_key_locale"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "help_articles"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_help_trails_locale_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_help_trails_key_locale"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "help_trails"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_help_categories_locale_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_help_categories_key_locale"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "help_categories"`);
  }
}
