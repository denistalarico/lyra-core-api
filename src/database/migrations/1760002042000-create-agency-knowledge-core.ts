import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateAgencyKnowledgeCore1760002042000 implements MigrationInterface {
  name = "CreateAgencyKnowledgeCore1760002042000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "agency_knowledge_article_status_enum" AS ENUM (
        'draft',
        'published',
        'in_review',
        'archived'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "agency_knowledge_article_type_enum" AS ENUM (
        'article',
        'tutorial',
        'process',
        'decision',
        'checklist',
        'onboarding',
        'useful_link',
        'open_credential',
        'internal_faq',
        'policy'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "agency_knowledge_article_visibility_enum" AS ENUM (
        'internal',
        'managers',
        'restricted',
        'private'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "agency_knowledge_comment_status_enum" AS ENUM (
        'active',
        'resolved',
        'archived'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "agency_knowledge_reaction_type_enum" AS ENUM (
        'useful',
        'not_useful',
        'outdated',
        'favorite',
        'read'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "agency_knowledge_vault_status_enum" AS ENUM (
        'active',
        'archived',
        'revoked'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "agency_knowledge_vault_service_type_enum" AS ENUM (
        'instagram',
        'facebook',
        'meta_business',
        'google',
        'google_ads',
        'google_analytics',
        'gmail',
        'email',
        'hosting',
        'domain',
        'wordpress',
        'canva',
        'figma',
        'tiktok',
        'linkedin',
        'whatsapp',
        'other'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "agency_knowledge_vault_permission_role_enum" AS ENUM (
        'owner',
        'admin',
        'manager',
        'member',
        'user'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "agency_knowledge_vault_access_action_enum" AS ENUM (
        'created',
        'updated',
        'revealed',
        'copied',
        'permission_granted',
        'permission_removed',
        'archived',
        'failed_reveal_attempt'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "agency_knowledge_categories" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "parent_id" uuid,
        "name" character varying(160) NOT NULL,
        "slug" character varying(180) NOT NULL,
        "description" text,
        "icon" character varying(80),
        "color" character varying(32),
        "sort_order" integer NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agency_knowledge_categories" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_agency_knowledge_categories_slug"
      ON "agency_knowledge_categories" ("tenant_id", "workspace_id", "slug")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_agency_knowledge_categories_context"
      ON "agency_knowledge_categories" ("tenant_id", "workspace_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "agency_knowledge_articles" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "category_id" uuid,
        "author_id" uuid NOT NULL,
        "owner_id" uuid,
        "client_id" uuid,
        "project_id" uuid,
        "task_id" uuid,
        "title" character varying(220) NOT NULL,
        "slug" character varying(240) NOT NULL,
        "summary" text,
        "type" "agency_knowledge_article_type_enum" NOT NULL DEFAULT 'article',
        "status" "agency_knowledge_article_status_enum" NOT NULL DEFAULT 'draft',
        "visibility" "agency_knowledge_article_visibility_enum" NOT NULL DEFAULT 'internal',
        "header_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "content_json" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "content_html" text,
        "footer_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "tags" text array NOT NULL DEFAULT '{}',
        "is_pinned" boolean NOT NULL DEFAULT false,
        "is_featured" boolean NOT NULL DEFAULT false,
        "is_onboarding_required" boolean NOT NULL DEFAULT false,
        "estimated_read_minutes" integer NOT NULL DEFAULT 1,
        "review_at" TIMESTAMP WITH TIME ZONE,
        "published_at" TIMESTAMP WITH TIME ZONE,
        "archived_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agency_knowledge_articles" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_agency_knowledge_articles_slug"
      ON "agency_knowledge_articles" ("tenant_id", "workspace_id", "slug")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_agency_knowledge_articles_context"
      ON "agency_knowledge_articles" ("tenant_id", "workspace_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_agency_knowledge_articles_status"
      ON "agency_knowledge_articles" ("tenant_id", "workspace_id", "status")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_agency_knowledge_articles_type"
      ON "agency_knowledge_articles" ("tenant_id", "workspace_id", "type")
    `);

    await queryRunner.query(`
      CREATE TABLE "agency_knowledge_comments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "article_id" uuid NOT NULL,
        "author_id" uuid NOT NULL,
        "body" text NOT NULL,
        "status" "agency_knowledge_comment_status_enum" NOT NULL DEFAULT 'active',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agency_knowledge_comments" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_agency_knowledge_comments_article"
      ON "agency_knowledge_comments" ("tenant_id", "workspace_id", "article_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "agency_knowledge_reactions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "article_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "type" "agency_knowledge_reaction_type_enum" NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agency_knowledge_reactions" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_agency_knowledge_reactions_article"
      ON "agency_knowledge_reactions" ("tenant_id", "workspace_id", "article_id")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_agency_knowledge_reactions_unique"
      ON "agency_knowledge_reactions" ("tenant_id", "workspace_id", "article_id", "user_id", "type")
    `);

    await queryRunner.query(`
      CREATE TABLE "agency_knowledge_article_versions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "article_id" uuid NOT NULL,
        "version_number" integer NOT NULL,
        "title" character varying(220) NOT NULL,
        "header_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "content_json" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "content_html" text,
        "footer_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "changed_by_id" uuid NOT NULL,
        "change_note" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agency_knowledge_article_versions" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_agency_knowledge_article_versions_article"
      ON "agency_knowledge_article_versions" ("tenant_id", "workspace_id", "article_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "agency_knowledge_vault_items" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "client_id" uuid,
        "article_id" uuid,
        "title" character varying(180) NOT NULL,
        "description" text,
        "service_type" "agency_knowledge_vault_service_type_enum" NOT NULL DEFAULT 'other',
        "service_url" text,
        "login_identifier" character varying(240),
        "encrypted_secret" text NOT NULL,
        "encrypted_notes" text,
        "encryption_iv" character varying(64) NOT NULL,
        "encryption_auth_tag" character varying(64) NOT NULL,
        "key_version" integer NOT NULL DEFAULT 1,
        "status" "agency_knowledge_vault_status_enum" NOT NULL DEFAULT 'active',
        "created_by_id" uuid NOT NULL,
        "updated_by_id" uuid,
        "last_revealed_at" TIMESTAMP WITH TIME ZONE,
        "archived_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agency_knowledge_vault_items" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_agency_knowledge_vault_items_context"
      ON "agency_knowledge_vault_items" ("tenant_id", "workspace_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_agency_knowledge_vault_items_client"
      ON "agency_knowledge_vault_items" ("tenant_id", "workspace_id", "client_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_agency_knowledge_vault_items_article"
      ON "agency_knowledge_vault_items" ("tenant_id", "workspace_id", "article_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "agency_knowledge_vault_permissions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "vault_item_id" uuid NOT NULL,
        "user_id" uuid,
        "role" "agency_knowledge_vault_permission_role_enum",
        "can_view_metadata" boolean NOT NULL DEFAULT true,
        "can_reveal_secret" boolean NOT NULL DEFAULT false,
        "can_edit_secret" boolean NOT NULL DEFAULT false,
        "can_manage_permissions" boolean NOT NULL DEFAULT false,
        "created_by_id" uuid NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agency_knowledge_vault_permissions" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_agency_knowledge_vault_permissions_item"
      ON "agency_knowledge_vault_permissions" ("tenant_id", "workspace_id", "vault_item_id")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_agency_knowledge_vault_permissions_user_unique"
      ON "agency_knowledge_vault_permissions" ("tenant_id", "workspace_id", "vault_item_id", "user_id")
      WHERE "user_id" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_agency_knowledge_vault_permissions_role"
      ON "agency_knowledge_vault_permissions" ("tenant_id", "workspace_id", "vault_item_id", "role")
      WHERE "role" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "agency_knowledge_vault_access_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "vault_item_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "action" "agency_knowledge_vault_access_action_enum" NOT NULL,
        "ip_address" character varying(80),
        "user_agent" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agency_knowledge_vault_access_logs" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_agency_knowledge_vault_access_logs_item"
      ON "agency_knowledge_vault_access_logs" ("tenant_id", "workspace_id", "vault_item_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_agency_knowledge_vault_access_logs_user"
      ON "agency_knowledge_vault_access_logs" ("tenant_id", "workspace_id", "user_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_knowledge_vault_access_logs_user"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_knowledge_vault_access_logs_item"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agency_knowledge_vault_access_logs"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_knowledge_vault_permissions_role"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_knowledge_vault_permissions_user_unique"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_knowledge_vault_permissions_item"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agency_knowledge_vault_permissions"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_knowledge_vault_items_article"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_knowledge_vault_items_client"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_knowledge_vault_items_context"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agency_knowledge_vault_items"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_knowledge_article_versions_article"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agency_knowledge_article_versions"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_knowledge_reactions_unique"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_knowledge_reactions_article"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agency_knowledge_reactions"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_knowledge_comments_article"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agency_knowledge_comments"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_knowledge_articles_type"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_knowledge_articles_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_knowledge_articles_context"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_knowledge_articles_slug"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agency_knowledge_articles"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_knowledge_categories_context"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_knowledge_categories_slug"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agency_knowledge_categories"`);

    await queryRunner.query(`DROP TYPE IF EXISTS "agency_knowledge_vault_access_action_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "agency_knowledge_vault_permission_role_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "agency_knowledge_vault_service_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "agency_knowledge_vault_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "agency_knowledge_reaction_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "agency_knowledge_comment_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "agency_knowledge_article_visibility_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "agency_knowledge_article_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "agency_knowledge_article_status_enum"`);
  }
}
