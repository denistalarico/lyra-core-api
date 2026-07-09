import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLeadflowAgentsCore1783400000000
  implements MigrationInterface
{
  name = 'CreateLeadflowAgentsCore1783400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "leadflow_agents" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "settings_id" uuid,
        "context_type" character varying(30) NOT NULL DEFAULT 'agency',
        "agency_client_id" uuid,
        "business_mode_key" character varying(80) NOT NULL,
        "preset_key" character varying(120),
        "type" character varying(60) NOT NULL DEFAULT 'custom',
        "name" character varying(160) NOT NULL,
        "description" text,
        "status" character varying(30) NOT NULL DEFAULT 'draft',
        "is_system" boolean NOT NULL DEFAULT false,
        "is_custom" boolean NOT NULL DEFAULT false,
        "is_protected" boolean NOT NULL DEFAULT false,
        "behavior_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "prompt_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "handoff_policy" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "crm_policy" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "channel_policy" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "avatar_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "readiness" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "published_version_id" uuid,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_by_id" uuid,
        "updated_by_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_leadflow_agents" PRIMARY KEY ("id"),
        CONSTRAINT "FK_lf_agents_settings" FOREIGN KEY ("settings_id")
          REFERENCES "leadflow_client_settings" ("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_lf_agents_tenant_workspace"
      ON "leadflow_agents" ("tenant_id", "workspace_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_lf_agents_settings_id"
      ON "leadflow_agents" ("settings_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_lf_agents_business_mode_key"
      ON "leadflow_agents" ("business_mode_key")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_lf_agents_status"
      ON "leadflow_agents" ("status")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_lf_agents_context"
      ON "leadflow_agents" ("tenant_id", "workspace_id", "context_type", "agency_client_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "leadflow_agent_versions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "agent_id" uuid NOT NULL,
        "version" integer NOT NULL,
        "status" character varying(30) NOT NULL DEFAULT 'published',
        "snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_by_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_leadflow_agent_versions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_lf_agent_versions_agent" FOREIGN KEY ("agent_id")
          REFERENCES "leadflow_agents" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_lf_agent_versions_agent_id"
      ON "leadflow_agent_versions" ("agent_id")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_lf_agent_versions_agent_version"
      ON "leadflow_agent_versions" ("agent_id", "version")
    `);

    await queryRunner.query(`
      ALTER TABLE "leadflow_agents"
      ADD CONSTRAINT "FK_lf_agents_published_version"
      FOREIGN KEY ("published_version_id")
      REFERENCES "leadflow_agent_versions" ("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "leadflow_agent_channel_bindings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agent_id" uuid NOT NULL,
        "channel_key" character varying(60) NOT NULL,
        "provider" character varying(60),
        "external_ref" character varying(200),
        "status" character varying(30) NOT NULL DEFAULT 'unbound',
        "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_leadflow_agent_channel_bindings" PRIMARY KEY ("id"),
        CONSTRAINT "FK_lf_agent_channel_bindings_agent" FOREIGN KEY ("agent_id")
          REFERENCES "leadflow_agents" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_lf_agent_channel_bindings_agent_id"
      ON "leadflow_agent_channel_bindings" ("agent_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_lf_agent_channel_bindings_tenant_workspace"
      ON "leadflow_agent_channel_bindings" ("tenant_id", "workspace_id")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_lf_agent_channel_bindings_agent_channel"
      ON "leadflow_agent_channel_bindings" ("agent_id", "channel_key")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_lf_agent_channel_bindings_agent_channel"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_lf_agent_channel_bindings_tenant_workspace"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_lf_agent_channel_bindings_agent_id"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "leadflow_agent_channel_bindings"`,
    );

    await queryRunner.query(
      `ALTER TABLE "leadflow_agents" DROP CONSTRAINT IF EXISTS "FK_lf_agents_published_version"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_lf_agent_versions_agent_version"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_lf_agent_versions_agent_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "leadflow_agent_versions"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_lf_agents_context"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_lf_agents_status"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_lf_agents_business_mode_key"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_lf_agents_settings_id"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_lf_agents_tenant_workspace"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "leadflow_agents"`);
  }
}
