import type { MigrationInterface, QueryRunner } from 'typeorm';

/** AP1 — approval workflow is company-operational from its first persisted row. */
export class CreateSocialApprovals1795100000000 implements MigrationInterface {
  name = 'CreateSocialApprovals1795100000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "social_approval_requests" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "tenant_id" uuid NOT NULL, "workspace_id" uuid NOT NULL,
      "agency_client_id" uuid NOT NULL, "company_context_id" uuid NOT NULL,
      "subject_type" varchar(80) NOT NULL, "subject_id" uuid NOT NULL, "subject_revision_id" uuid NOT NULL,
      "source_module" varchar(80) NOT NULL, "display_type" varchar(80) NOT NULL, "title" varchar(255) NOT NULL, "subject_version_label" varchar(80) NOT NULL,
      "status" varchar(32) NOT NULL DEFAULT 'draft', "current_stage" varchar(16) NOT NULL DEFAULT 'internal',
      "requested_by_user_id" uuid NOT NULL, "requested_at" timestamptz NOT NULL DEFAULT now(), "sent_to_client_at" timestamptz,
      "client_first_viewed_at" timestamptz, "client_last_viewed_at" timestamptz, "approved_at" timestamptz, "cancelled_at" timestamptz, "superseded_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "CK_social_approval_requests_scope" CHECK ("agency_client_id" IS NOT NULL AND "company_context_id" IS NOT NULL),
      CONSTRAINT "CK_social_approval_requests_status" CHECK ("status" IN ('draft','awaiting_internal_review','awaiting_client','changes_requested','approved','cancelled','superseded')),
      CONSTRAINT "CK_social_approval_requests_stage" CHECK ("current_stage" IN ('internal','client')),
      CONSTRAINT "FK_social_approval_requests_company" FOREIGN KEY ("company_context_id","tenant_id","workspace_id","agency_client_id") REFERENCES "agency_client_company_contexts" ("id","tenant_id","workspace_id","agency_client_id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_social_approval_requests_scope_created" ON "social_approval_requests" ("tenant_id","workspace_id","agency_client_id","company_context_id","created_at" DESC)`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_approval_requests_active_revision" ON "social_approval_requests" ("tenant_id","workspace_id","agency_client_id","company_context_id","subject_type","subject_id","subject_revision_id") WHERE "status" IN ('draft','awaiting_internal_review','awaiting_client','changes_requested')`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "social_approval_comments" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "approval_request_id" uuid NOT NULL, "stage" varchar(16), "actor_type" varchar(16) NOT NULL, "actor_user_id" uuid, "body" text NOT NULL, "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "FK_social_approval_comments_request" FOREIGN KEY ("approval_request_id") REFERENCES "social_approval_requests"("id") ON DELETE RESTRICT,
      CONSTRAINT "CK_social_approval_comments_body" CHECK (btrim("body") <> ''), CONSTRAINT "CK_social_approval_comments_stage" CHECK ("stage" IS NULL OR "stage" IN ('internal','client')),
      CONSTRAINT "CK_social_approval_comments_actor" CHECK (("actor_type" = 'user' AND "actor_user_id" IS NOT NULL) OR ("actor_type" = 'system' AND "actor_user_id" IS NULL))
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_social_approval_comments_request_created" ON "social_approval_comments" ("approval_request_id","created_at")`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "social_approval_stage_decisions" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "approval_request_id" uuid NOT NULL, "stage" varchar(16) NOT NULL, "decision" varchar(32) NOT NULL, "actor_type" varchar(16) NOT NULL, "actor_user_id" uuid, "comment_id" uuid, "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "FK_social_approval_stage_decisions_request" FOREIGN KEY ("approval_request_id") REFERENCES "social_approval_requests"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_social_approval_stage_decisions_comment" FOREIGN KEY ("comment_id") REFERENCES "social_approval_comments"("id") ON DELETE RESTRICT,
      CONSTRAINT "CK_social_approval_stage_decisions_stage" CHECK ("stage" IN ('internal','client')), CONSTRAINT "CK_social_approval_stage_decisions_kind" CHECK ("decision" IN ('approved','changes_requested')),
      CONSTRAINT "CK_social_approval_stage_decisions_actor" CHECK (("actor_type" = 'user' AND "actor_user_id" IS NOT NULL) OR ("actor_type" = 'system' AND "actor_user_id" IS NULL))
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_social_approval_stage_decisions_request_created" ON "social_approval_stage_decisions" ("approval_request_id","created_at")`);
    await queryRunner.query(`CREATE OR REPLACE FUNCTION "social_approval_append_only"() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'Approval history is append-only'; END; $$ LANGUAGE plpgsql`);
    await queryRunner.query(`CREATE TRIGGER "TRG_social_approval_comments_append_only" BEFORE UPDATE OR DELETE ON "social_approval_comments" FOR EACH ROW EXECUTE FUNCTION "social_approval_append_only"()`);
    await queryRunner.query(`CREATE TRIGGER "TRG_social_approval_decisions_append_only" BEFORE UPDATE OR DELETE ON "social_approval_stage_decisions" FOR EACH ROW EXECUTE FUNCTION "social_approval_append_only"()`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TRIGGER IF EXISTS "TRG_social_approval_decisions_append_only" ON "social_approval_stage_decisions"');
    await queryRunner.query('DROP TRIGGER IF EXISTS "TRG_social_approval_comments_append_only" ON "social_approval_comments"');
    await queryRunner.query('DROP FUNCTION IF EXISTS "social_approval_append_only"()');
    await queryRunner.query('DROP TABLE IF EXISTS "social_approval_stage_decisions"');
    await queryRunner.query('DROP TABLE IF EXISTS "social_approval_comments"');
    await queryRunner.query('DROP TABLE IF EXISTS "social_approval_requests"');
  }
}
