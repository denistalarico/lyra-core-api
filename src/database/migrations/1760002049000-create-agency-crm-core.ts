import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgencyCrmCore1760002049000 implements MigrationInterface {
  name = 'CreateAgencyCrmCore1760002049000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "crm_pipelines" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "name" varchar(140) NOT NULL,
        "description" text,
        "business_mode" varchar(80) NOT NULL DEFAULT 'general',
        "is_default" boolean NOT NULL DEFAULT false,
        "status" varchar(32) NOT NULL DEFAULT 'active',
        "sort_order" int NOT NULL DEFAULT 0,
        "visibility" varchar(32) NOT NULL DEFAULT 'workspace',
        "owner_user_id" uuid,
        "settings" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "channels" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "allowed_user_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "crm_stages" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "pipeline_id" uuid NOT NULL,
        "name" varchar(140) NOT NULL,
        "description" text,
        "type" varchar(32) NOT NULL DEFAULT 'open',
        "color" varchar(32),
        "sort_order" int NOT NULL DEFAULT 0,
        "probability" int NOT NULL DEFAULT 0,
        "is_won_stage" boolean NOT NULL DEFAULT false,
        "is_lost_stage" boolean NOT NULL DEFAULT false,
        "is_folded" boolean NOT NULL DEFAULT false,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "fk_crm_stages_pipeline"
          FOREIGN KEY ("pipeline_id") REFERENCES "crm_pipelines"("id")
          ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "crm_opportunities" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "pipeline_id" uuid NOT NULL,
        "stage_id" uuid NOT NULL,
        "contact_id" uuid,
        "contact_name" varchar(180),
        "contact_email" varchar(180),
        "contact_phone" varchar(40),
        "inbox_conversation_id" uuid,
        "title" varchar(180) NOT NULL,
        "description" text,
        "value_amount" numeric(14,2),
        "currency" varchar(12) NOT NULL DEFAULT 'BRL',
        "status" varchar(32) NOT NULL DEFAULT 'open',
        "priority" varchar(24) NOT NULL DEFAULT 'normal',
        "source" varchar(40) NOT NULL DEFAULT 'manual',
        "business_mode" varchar(80) NOT NULL DEFAULT 'general',
        "operational_status" varchar(80),
        "business_context" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "assigned_user_id" uuid,
        "expected_close_date" date,
        "next_follow_up_at" timestamptz,
        "last_activity_at" timestamptz,
        "won_at" timestamptz,
        "lost_at" timestamptz,
        "lost_reason" text,
        "card_color" varchar(32),
        "visibility" varchar(32) NOT NULL DEFAULT 'workspace',
        "follow_mode" varchar(32) NOT NULL DEFAULT 'automatic',
        "follow_message" text,
        "follow_send_automatically" boolean NOT NULL DEFAULT false,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "fk_crm_opportunities_pipeline"
          FOREIGN KEY ("pipeline_id") REFERENCES "crm_pipelines"("id")
          ON DELETE RESTRICT,
        CONSTRAINT "fk_crm_opportunities_stage"
          FOREIGN KEY ("stage_id") REFERENCES "crm_stages"("id")
          ON DELETE RESTRICT,
        CONSTRAINT "fk_crm_opportunities_contact"
          FOREIGN KEY ("contact_id") REFERENCES "contacts"("id")
          ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "crm_tags" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "name" varchar(80) NOT NULL,
        "slug" varchar(100) NOT NULL,
        "color" varchar(32),
        "icon" varchar(60),
        "kind" varchar(24) NOT NULL DEFAULT 'user',
        "scope" varchar(24) NOT NULL DEFAULT 'workspace',
        "owner_user_id" uuid,
        "description" text,
        "is_editable" boolean NOT NULL DEFAULT true,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "crm_opportunity_tags" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "opportunity_id" uuid NOT NULL,
        "tag_id" uuid NOT NULL,
        "assigned_by_type" varchar(32) NOT NULL DEFAULT 'user',
        "assigned_by_user_id" uuid,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_crm_opportunity_tags_tenant_workspace_opportunity_tag"
          UNIQUE ("tenant_id", "workspace_id", "opportunity_id", "tag_id"),
        CONSTRAINT "fk_crm_opportunity_tags_opportunity"
          FOREIGN KEY ("opportunity_id") REFERENCES "crm_opportunities"("id")
          ON DELETE CASCADE,
        CONSTRAINT "fk_crm_opportunity_tags_tag"
          FOREIGN KEY ("tag_id") REFERENCES "crm_tags"("id")
          ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "crm_opportunity_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "opportunity_id" uuid NOT NULL,
        "actor_type" varchar(32) NOT NULL DEFAULT 'user',
        "actor_user_id" uuid,
        "event_type" varchar(80) NOT NULL,
        "title" varchar(180) NOT NULL,
        "description" text,
        "before_data" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "after_data" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "reason" text,
        "confidence" numeric(5,2),
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "fk_crm_opportunity_events_opportunity"
          FOREIGN KEY ("opportunity_id") REFERENCES "crm_opportunities"("id")
          ON DELETE CASCADE
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_crm_pipelines_tenant_workspace" ON "crm_pipelines" ("tenant_id", "workspace_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_crm_pipelines_default" ON "crm_pipelines" ("tenant_id", "workspace_id", "is_default")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_crm_pipelines_business_mode" ON "crm_pipelines" ("tenant_id", "workspace_id", "business_mode")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_crm_pipelines_status" ON "crm_pipelines" ("tenant_id", "workspace_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_crm_pipelines_visibility_owner" ON "crm_pipelines" ("tenant_id", "workspace_id", "visibility", "owner_user_id")`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_crm_stages_tenant_workspace" ON "crm_stages" ("tenant_id", "workspace_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_crm_stages_pipeline" ON "crm_stages" ("pipeline_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_crm_stages_sort" ON "crm_stages" ("pipeline_id", "sort_order")`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_crm_opportunities_tenant_workspace" ON "crm_opportunities" ("tenant_id", "workspace_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_crm_opportunities_pipeline" ON "crm_opportunities" ("pipeline_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_crm_opportunities_stage" ON "crm_opportunities" ("stage_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_crm_opportunities_contact" ON "crm_opportunities" ("contact_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_crm_opportunities_inbox_conversation" ON "crm_opportunities" ("inbox_conversation_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_crm_opportunities_status" ON "crm_opportunities" ("tenant_id", "workspace_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_crm_opportunities_priority" ON "crm_opportunities" ("tenant_id", "workspace_id", "priority")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_crm_opportunities_source" ON "crm_opportunities" ("tenant_id", "workspace_id", "source")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_crm_opportunities_business_mode" ON "crm_opportunities" ("tenant_id", "workspace_id", "business_mode")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_crm_opportunities_assigned_user" ON "crm_opportunities" ("tenant_id", "workspace_id", "assigned_user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_crm_opportunities_next_follow_up" ON "crm_opportunities" ("tenant_id", "workspace_id", "next_follow_up_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_crm_opportunities_contact_snapshot" ON "crm_opportunities" ("tenant_id", "workspace_id", "contact_email", "contact_phone")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_crm_opportunities_visibility_assigned" ON "crm_opportunities" ("tenant_id", "workspace_id", "visibility", "assigned_user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_crm_opportunities_follow" ON "crm_opportunities" ("tenant_id", "workspace_id", "follow_mode", "next_follow_up_at")`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_crm_tags_tenant_workspace_slug_active" ON "crm_tags" ("tenant_id", "workspace_id", "slug") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_crm_tags_tenant_workspace" ON "crm_tags" ("tenant_id", "workspace_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_crm_tags_kind" ON "crm_tags" ("kind")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_crm_tags_scope_owner" ON "crm_tags" ("scope", "owner_user_id")`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_crm_opportunity_tags_opportunity" ON "crm_opportunity_tags" ("tenant_id", "workspace_id", "opportunity_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_crm_opportunity_tags_tag" ON "crm_opportunity_tags" ("tenant_id", "workspace_id", "tag_id")`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_crm_opportunity_events_opportunity" ON "crm_opportunity_events" ("tenant_id", "workspace_id", "opportunity_id", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_crm_opportunity_events_actor" ON "crm_opportunity_events" ("actor_type", "actor_user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_crm_opportunity_events_type" ON "crm_opportunity_events" ("event_type")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "crm_opportunity_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "crm_opportunity_tags"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "crm_tags"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "crm_opportunities"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "crm_stages"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "crm_pipelines"`);
  }
}
