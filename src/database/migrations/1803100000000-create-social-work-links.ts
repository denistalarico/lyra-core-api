import type { MigrationInterface, QueryRunner } from 'typeorm';

const SCOPE_COLUMNS = `"tenant_id" uuid NOT NULL, "workspace_id" uuid NOT NULL,
      "agency_client_id" uuid, "company_context_id" uuid`;

const scopeCheck = (name: string) =>
  `CONSTRAINT "${name}" CHECK (("agency_client_id" IS NULL AND "company_context_id" IS NULL) OR ("agency_client_id" IS NOT NULL AND "company_context_id" IS NOT NULL))`;

const companyForeignKey = (name: string) =>
  `CONSTRAINT "${name}" FOREIGN KEY ("company_context_id","tenant_id","workspace_id","agency_client_id") REFERENCES "agency_client_company_contexts" ("id","tenant_id","workspace_id","agency_client_id") ON DELETE RESTRICT`;

/**
 * AR4 — the link between a Planner plan and Agency work (plan §5, D-25).
 *
 * The plan is linked, not its items: when the modal runs the items do not
 * exist yet, and a service materializes the work as they appear.
 *
 * No foreign key to items, tasks or subtasks, as in CS5. A discarded draft is
 * hard-deleted, and its link has to outlive the row: it is how the task is
 * found and cancelled. `cancelled_at` records that the sync cancelled the
 * work, the only case a restored item may bring it back.
 */
export class CreateSocialWorkLinks1803100000000 implements MigrationInterface {
  name = 'CreateSocialWorkLinks1803100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "social_plan_work_links" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), ${SCOPE_COLUMNS},
      "plan_id" uuid NOT NULL, "mode" varchar(24) NOT NULL, "project_id" uuid NOT NULL,
      "project_stage_id" uuid, "parent_task_id" uuid, "created_by_user_id" uuid NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
      ${scopeCheck('CK_social_plan_work_links_scope')},
      CONSTRAINT "CK_social_plan_work_links_mode" CHECK ("mode" IN ('project_created','project_linked','task_created')),
      CONSTRAINT "CK_social_plan_work_links_parent" CHECK (("mode" = 'task_created') = ("parent_task_id" IS NOT NULL)),
      ${companyForeignKey('FK_social_plan_work_links_company')}
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_plan_work_links_plan" ON "social_plan_work_links" ("plan_id")`,
    );

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "social_content_work_links" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), ${SCOPE_COLUMNS},
      "plan_id" uuid NOT NULL, "content_item_id" uuid NOT NULL, "step_kind" varchar(16) NOT NULL,
      "task_id" uuid NOT NULL, "subtask_id" uuid, "planned_date" date, "cancelled_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
      ${scopeCheck('CK_social_content_work_links_scope')},
      CONSTRAINT "CK_social_content_work_links_step_kind" CHECK ("step_kind" IN ('copy','creative','item')),
      ${companyForeignKey('FK_social_content_work_links_company')}
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_content_work_links_item_step" ON "social_content_work_links" ("content_item_id","step_kind")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_social_content_work_links_plan" ON "social_content_work_links" ("plan_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_social_content_work_links_task" ON "social_content_work_links" ("tenant_id","workspace_id","task_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_social_content_work_links_subtask" ON "social_content_work_links" ("subtask_id") WHERE "subtask_id" IS NOT NULL`,
    );
    // D-26's observer and the subtask section look steps up by their work.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_social_approval_steps_work_task" ON "social_approval_steps" ("tenant_id","workspace_id","work_task_id") WHERE "work_task_id" IS NOT NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_social_approval_steps_work_task"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "social_content_work_links"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "social_plan_work_links"`);
  }
}
