import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExpandCrmKanbanSettings1760000023000 implements MigrationInterface {
  name = 'ExpandCrmKanbanSettings1760000023000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE crm_pipelines
      ADD COLUMN IF NOT EXISTS visibility varchar(32) NOT NULL DEFAULT 'workspace',
      ADD COLUMN IF NOT EXISTS owner_user_id uuid NULL,
      ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS channels jsonb NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS allowed_user_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
    `);

    await queryRunner.query(`
      ALTER TABLE crm_stages
      ADD COLUMN IF NOT EXISTS is_folded boolean NOT NULL DEFAULT false;
    `);

    await queryRunner.query(`
      ALTER TABLE crm_opportunities
      ADD COLUMN IF NOT EXISTS contact_name varchar(180) NULL,
      ADD COLUMN IF NOT EXISTS contact_email varchar(180) NULL,
      ADD COLUMN IF NOT EXISTS contact_phone varchar(40) NULL,
      ADD COLUMN IF NOT EXISTS card_color varchar(32) NULL,
      ADD COLUMN IF NOT EXISTS visibility varchar(32) NOT NULL DEFAULT 'workspace',
      ADD COLUMN IF NOT EXISTS follow_mode varchar(32) NOT NULL DEFAULT 'automatic',
      ADD COLUMN IF NOT EXISTS follow_message text NULL,
      ADD COLUMN IF NOT EXISTS follow_send_automatically boolean NOT NULL DEFAULT false;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS crm_tags (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        name varchar(80) NOT NULL,
        slug varchar(100) NOT NULL,
        color varchar(32) NULL,
        icon varchar(60) NULL,
        kind varchar(24) NOT NULL DEFAULT 'user',
        scope varchar(24) NOT NULL DEFAULT 'workspace',
        owner_user_id uuid NULL,
        description text NULL,
        is_editable boolean NOT NULL DEFAULT true,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz NULL
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_tags_tenant_workspace_slug_active
      ON crm_tags (tenant_id, workspace_id, slug)
      WHERE deleted_at IS NULL;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_crm_tags_tenant_workspace
      ON crm_tags (tenant_id, workspace_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_crm_tags_kind
      ON crm_tags (kind);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_crm_tags_scope_owner
      ON crm_tags (scope, owner_user_id);
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS crm_opportunity_tags (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        opportunity_id uuid NOT NULL,
        tag_id uuid NOT NULL,
        assigned_by_type varchar(32) NOT NULL DEFAULT 'user',
        assigned_by_user_id uuid NULL,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_opportunity_tags_unique
      ON crm_opportunity_tags (tenant_id, workspace_id, opportunity_id, tag_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_crm_opportunity_tags_opportunity
      ON crm_opportunity_tags (tenant_id, workspace_id, opportunity_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_crm_opportunity_tags_tag
      ON crm_opportunity_tags (tenant_id, workspace_id, tag_id);
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS crm_opportunity_events (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        opportunity_id uuid NOT NULL,
        actor_type varchar(32) NOT NULL DEFAULT 'user',
        actor_user_id uuid NULL,
        event_type varchar(80) NOT NULL,
        title varchar(180) NOT NULL,
        description text NULL,
        before_data jsonb NOT NULL DEFAULT '{}'::jsonb,
        after_data jsonb NOT NULL DEFAULT '{}'::jsonb,
        reason text NULL,
        confidence numeric(5, 2) NULL,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_crm_opportunity_events_opportunity
      ON crm_opportunity_events (tenant_id, workspace_id, opportunity_id, created_at DESC);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_crm_opportunity_events_actor
      ON crm_opportunity_events (actor_type, actor_user_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_crm_opportunity_events_type
      ON crm_opportunity_events (event_type);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_crm_pipelines_visibility_owner
      ON crm_pipelines (tenant_id, workspace_id, visibility, owner_user_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_crm_opportunities_contact_snapshot
      ON crm_opportunities (tenant_id, workspace_id, contact_email, contact_phone);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_crm_opportunities_visibility_assigned
      ON crm_opportunities (tenant_id, workspace_id, visibility, assigned_user_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_crm_opportunities_follow
      ON crm_opportunities (tenant_id, workspace_id, follow_mode, next_follow_up_at);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_crm_opportunities_follow;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_crm_opportunities_visibility_assigned;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_crm_opportunities_contact_snapshot;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_crm_pipelines_visibility_owner;`);

    await queryRunner.query(`DROP INDEX IF EXISTS idx_crm_opportunity_events_type;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_crm_opportunity_events_actor;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_crm_opportunity_events_opportunity;`);
    await queryRunner.query(`DROP TABLE IF EXISTS crm_opportunity_events;`);

    await queryRunner.query(`DROP INDEX IF EXISTS idx_crm_opportunity_tags_tag;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_crm_opportunity_tags_opportunity;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_crm_opportunity_tags_unique;`);
    await queryRunner.query(`DROP TABLE IF EXISTS crm_opportunity_tags;`);

    await queryRunner.query(`DROP INDEX IF EXISTS idx_crm_tags_scope_owner;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_crm_tags_kind;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_crm_tags_tenant_workspace;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_crm_tags_tenant_workspace_slug_active;`);
    await queryRunner.query(`DROP TABLE IF EXISTS crm_tags;`);

    await queryRunner.query(`
      ALTER TABLE crm_opportunities
      DROP COLUMN IF EXISTS follow_send_automatically,
      DROP COLUMN IF EXISTS follow_message,
      DROP COLUMN IF EXISTS follow_mode,
      DROP COLUMN IF EXISTS visibility,
      DROP COLUMN IF EXISTS card_color,
      DROP COLUMN IF EXISTS contact_phone,
      DROP COLUMN IF EXISTS contact_email,
      DROP COLUMN IF EXISTS contact_name;
    `);

    await queryRunner.query(`
      ALTER TABLE crm_stages
      DROP COLUMN IF EXISTS is_folded;
    `);

    await queryRunner.query(`
      ALTER TABLE crm_pipelines
      DROP COLUMN IF EXISTS allowed_user_ids,
      DROP COLUMN IF EXISTS channels,
      DROP COLUMN IF EXISTS settings,
      DROP COLUMN IF EXISTS owner_user_id,
      DROP COLUMN IF EXISTS visibility;
    `);
  }
}
