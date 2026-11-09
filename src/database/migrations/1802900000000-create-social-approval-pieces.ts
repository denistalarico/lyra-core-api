import type { MigrationInterface, QueryRunner } from 'typeorm';

const SCOPE_COLUMNS = `"tenant_id" uuid NOT NULL, "workspace_id" uuid NOT NULL,
      "agency_client_id" uuid, "company_context_id" uuid`;

const scopeCheck = (name: string) =>
  `CONSTRAINT "${name}" CHECK (("agency_client_id" IS NULL AND "company_context_id" IS NULL) OR ("agency_client_id" IS NOT NULL AND "company_context_id" IS NOT NULL))`;

const APPEND_ONLY_TRIGGERS = [
  ['TRG_social_approval_snapshots_append_only', 'social_approval_snapshots'],
  ['TRG_social_approval_events_append_only', 'social_approval_events'],
] as const;

/**
 * AR1 — Piece, Step and Snapshot (plan §5), additive over AP1.
 *
 * `social_approval_requests` keeps being the attempt at approving one revision
 * and only gains nullable columns, so every existing route keeps working.
 * Snapshots and events are append-only through the AP1 trigger function.
 *
 * `active_step_id` carries no foreign key on purpose: pieces and steps
 * reference each other, and a projection column must never block a write.
 */
export class CreateSocialApprovalPieces1802900000000 implements MigrationInterface {
  name = 'CreateSocialApprovalPieces1802900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "social_approval_pieces" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), ${SCOPE_COLUMNS},
      "kind" varchar(24) NOT NULL, "source_id" uuid, "origin" varchar(24) NOT NULL, "title" varchar(255) NOT NULL,
      "send_order" varchar(16) NOT NULL DEFAULT 'sequential', "board_column" varchar(24) NOT NULL DEFAULT 'preparation',
      "active_step_id" uuid, "source_state" varchar(16) NOT NULL DEFAULT 'active',
      "finished_at" timestamptz, "finished_by_user_id" uuid, "finish_reason" text,
      "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
      ${scopeCheck('CK_social_approval_pieces_scope')},
      CONSTRAINT "CK_social_approval_pieces_kind" CHECK ("kind" IN ('plan_table','campaign_table','content_item','standalone')),
      CONSTRAINT "CK_social_approval_pieces_origin" CHECK ("origin" IN ('social_planner','projects','approvals')),
      CONSTRAINT "CK_social_approval_pieces_send_order" CHECK ("send_order" IN ('sequential','together')),
      CONSTRAINT "CK_social_approval_pieces_column" CHECK ("board_column" IN ('preparation','internal_review','awaiting_client','changes','approved','finished')),
      CONSTRAINT "CK_social_approval_pieces_source_state" CHECK ("source_state" IN ('active','hidden','posted')),
      CONSTRAINT "FK_social_approval_pieces_company" FOREIGN KEY ("company_context_id","tenant_id","workspace_id","agency_client_id") REFERENCES "agency_client_company_contexts" ("id","tenant_id","workspace_id","agency_client_id") ON DELETE RESTRICT
    )`);
    // No scope columns here: NULL is distinct in Postgres, so a scoped index
    // would duplicate own-scope pieces. `source_id` is globally unique anyway.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_approval_pieces_source" ON "social_approval_pieces" ("kind","source_id") WHERE "source_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_social_approval_pieces_board" ON "social_approval_pieces" ("tenant_id","workspace_id","agency_client_id","company_context_id","board_column","updated_at" DESC)`,
    );

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "social_approval_steps" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), ${SCOPE_COLUMNS},
      "piece_id" uuid NOT NULL, "kind" varchar(16) NOT NULL, "position" integer NOT NULL DEFAULT 0, "title" varchar(255) NOT NULL,
      "current_request_id" uuid, "is_stale" boolean NOT NULL DEFAULT false,
      "work_project_id" uuid, "work_task_id" uuid, "work_subtask_id" uuid,
      "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
      ${scopeCheck('CK_social_approval_steps_scope')},
      CONSTRAINT "CK_social_approval_steps_kind" CHECK ("kind" IN ('table','copy','creative','text','link','file','media')),
      CONSTRAINT "FK_social_approval_steps_piece" FOREIGN KEY ("piece_id") REFERENCES "social_approval_pieces"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_social_approval_steps_request" FOREIGN KEY ("current_request_id") REFERENCES "social_approval_requests"("id") ON DELETE SET NULL
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_approval_steps_piece_kind" ON "social_approval_steps" ("piece_id","kind") WHERE "kind" IN ('table','copy','creative')`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_social_approval_steps_piece" ON "social_approval_steps" ("piece_id","position")`,
    );

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "social_approval_snapshots" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), ${SCOPE_COLUMNS},
      "step_id" uuid NOT NULL, "revision_number" integer NOT NULL, "kind" varchar(16) NOT NULL, "payload" jsonb NOT NULL,
      "content_hash" varchar(64) NOT NULL, "created_by_user_id" uuid, "created_by_surface" varchar(24) NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      ${scopeCheck('CK_social_approval_snapshots_scope')},
      CONSTRAINT "CK_social_approval_snapshots_kind" CHECK ("kind" IN ('table','text','link','file','media_set')),
      CONSTRAINT "CK_social_approval_snapshots_number" CHECK ("revision_number" > 0),
      CONSTRAINT "FK_social_approval_snapshots_step" FOREIGN KEY ("step_id") REFERENCES "social_approval_steps"("id") ON DELETE RESTRICT,
      CONSTRAINT "UQ_social_approval_snapshots_revision" UNIQUE ("step_id","revision_number")
    )`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "social_approval_settings" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), ${SCOPE_COLUMNS},
      "internal_approval_enabled" boolean NOT NULL DEFAULT true,
      "internal_approver_user_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "client_approver_membership_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "client_decision_policy" varchar(8) NOT NULL DEFAULT 'first',
      "client_can_edit_text" boolean NOT NULL DEFAULT false,
      "send_to_conversation" boolean NOT NULL DEFAULT true,
      "register_decisions_in_conversation" boolean NOT NULL DEFAULT true,
      "team_chat_channel_id" uuid,
      "notification_events" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "updated_by_user_id" uuid,
      "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
      ${scopeCheck('CK_social_approval_settings_scope')},
      CONSTRAINT "CK_social_approval_settings_policy" CHECK ("client_decision_policy" IN ('first','all')),
      CONSTRAINT "CK_social_approval_settings_own_internal" CHECK ("agency_client_id" IS NOT NULL OR "internal_approval_enabled" = true),
      CONSTRAINT "FK_social_approval_settings_company" FOREIGN KEY ("company_context_id","tenant_id","workspace_id","agency_client_id") REFERENCES "agency_client_company_contexts" ("id","tenant_id","workspace_id","agency_client_id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_approval_settings_company" ON "social_approval_settings" ("tenant_id","workspace_id","agency_client_id","company_context_id") WHERE "agency_client_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_approval_settings_own" ON "social_approval_settings" ("tenant_id","workspace_id") WHERE "agency_client_id" IS NULL`,
    );

    await queryRunner.query(`ALTER TABLE "social_approval_requests"
      ADD COLUMN IF NOT EXISTS "step_id" uuid,
      ADD COLUMN IF NOT EXISTS "batch_id" uuid,
      ADD COLUMN IF NOT EXISTS "resolution" varchar(24),
      ADD COLUMN IF NOT EXISTS "required_client_approver_ids" jsonb`);
    await queryRunner.query(
      `ALTER TABLE "social_approval_requests" DROP CONSTRAINT IF EXISTS "CK_social_approval_requests_resolution"`,
    );
    await queryRunner.query(
      `ALTER TABLE "social_approval_requests" ADD CONSTRAINT "CK_social_approval_requests_resolution" CHECK ("resolution" IS NULL OR "resolution" IN ('internal_final','client_approved','agency_override'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "social_approval_requests" DROP CONSTRAINT IF EXISTS "FK_social_approval_requests_step"`,
    );
    await queryRunner.query(
      `ALTER TABLE "social_approval_requests" ADD CONSTRAINT "FK_social_approval_requests_step" FOREIGN KEY ("step_id") REFERENCES "social_approval_steps"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_social_approval_requests_step" ON "social_approval_requests" ("step_id") WHERE "step_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_social_approval_requests_batch" ON "social_approval_requests" ("batch_id") WHERE "batch_id" IS NOT NULL`,
    );

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "social_approval_events" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), ${SCOPE_COLUMNS},
      "piece_id" uuid NOT NULL, "step_id" uuid, "request_id" uuid,
      "type" varchar(24) NOT NULL, "actor_type" varchar(16) NOT NULL, "actor_user_id" uuid, "actor_name" varchar(160),
      "surface" varchar(24) NOT NULL, "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      ${scopeCheck('CK_social_approval_events_scope')},
      CONSTRAINT "CK_social_approval_events_type" CHECK ("type" IN ('sent','internal_skipped','viewed','commented','approved','changes_requested','agency_override','edited','superseded','cancelled','finished','reopened_stale')),
      CONSTRAINT "CK_social_approval_events_actor" CHECK (("actor_type" = 'user' AND "actor_user_id" IS NOT NULL) OR ("actor_type" = 'system' AND "actor_user_id" IS NULL)),
      CONSTRAINT "CK_social_approval_events_surface" CHECK ("surface" IN ('agency','client_area','self','team_chat','client_conversation','projects','planner','system')),
      CONSTRAINT "FK_social_approval_events_piece" FOREIGN KEY ("piece_id") REFERENCES "social_approval_pieces"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_social_approval_events_step" FOREIGN KEY ("step_id") REFERENCES "social_approval_steps"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_social_approval_events_request" FOREIGN KEY ("request_id") REFERENCES "social_approval_requests"("id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_social_approval_events_piece" ON "social_approval_events" ("piece_id","created_at")`,
    );

    for (const [trigger, table] of APPEND_ONLY_TRIGGERS) {
      await queryRunner.query(
        `DROP TRIGGER IF EXISTS "${trigger}" ON "${table}"`,
      );
      await queryRunner.query(
        `CREATE TRIGGER "${trigger}" BEFORE UPDATE OR DELETE ON "${table}" FOR EACH ROW EXECUTE FUNCTION "social_approval_append_only"()`,
      );
    }

    // D-15 and AR3: the two widened vocabularies.
    await queryRunner.query(
      `ALTER TABLE "social_approval_stage_decisions" DROP CONSTRAINT IF EXISTS "CK_social_approval_stage_decisions_kind"`,
    );
    await queryRunner.query(
      `ALTER TABLE "social_approval_stage_decisions" ADD CONSTRAINT "CK_social_approval_stage_decisions_kind" CHECK ("decision" IN ('approved','changes_requested','agency_override'))`,
    );
    await queryRunner.query(
      `ALTER TABLE IF EXISTS "social_content_revisions" DROP CONSTRAINT IF EXISTS "CK_social_content_revisions_source"`,
    );
    await queryRunner.query(
      `ALTER TABLE IF EXISTS "social_content_revisions" ADD CONSTRAINT "CK_social_content_revisions_source" CHECK ("source" IN ('human','ai','ai_then_human','human_then_ai','restored','import','client_edit'))`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM "social_approval_stage_decisions" WHERE "decision" = 'agency_override')
           OR EXISTS (SELECT 1 FROM "social_approval_events") THEN
          RAISE EXCEPTION 'social approvals already hold piece history; refusing to drop it';
        END IF;
      END $$`);
    await queryRunner.query(
      `ALTER TABLE IF EXISTS "social_content_revisions" DROP CONSTRAINT IF EXISTS "CK_social_content_revisions_source"`,
    );
    await queryRunner.query(
      `ALTER TABLE IF EXISTS "social_content_revisions" ADD CONSTRAINT "CK_social_content_revisions_source" CHECK ("source" IN ('human','ai','ai_then_human','human_then_ai','restored','import'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "social_approval_stage_decisions" DROP CONSTRAINT IF EXISTS "CK_social_approval_stage_decisions_kind"`,
    );
    await queryRunner.query(
      `ALTER TABLE "social_approval_stage_decisions" ADD CONSTRAINT "CK_social_approval_stage_decisions_kind" CHECK ("decision" IN ('approved','changes_requested'))`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "social_approval_events"`);
    await queryRunner.query(`ALTER TABLE "social_approval_requests"
      DROP CONSTRAINT IF EXISTS "FK_social_approval_requests_step",
      DROP CONSTRAINT IF EXISTS "CK_social_approval_requests_resolution",
      DROP COLUMN IF EXISTS "required_client_approver_ids",
      DROP COLUMN IF EXISTS "resolution",
      DROP COLUMN IF EXISTS "batch_id",
      DROP COLUMN IF EXISTS "step_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "social_approval_settings"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "social_approval_snapshots"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "social_approval_steps"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "social_approval_pieces"`);
  }
}
