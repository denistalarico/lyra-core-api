import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCrmCore1760000022000 implements MigrationInterface {
  name = 'CreateCrmCore1760000022000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS crm_pipelines (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        name varchar(140) NOT NULL,
        description text,
        business_mode varchar(80) NOT NULL DEFAULT 'general',
        is_default boolean NOT NULL DEFAULT false,
        status varchar(32) NOT NULL DEFAULT 'active',
        sort_order int NOT NULL DEFAULT 0,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS crm_stages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        pipeline_id uuid NOT NULL,
        name varchar(140) NOT NULL,
        description text,
        type varchar(32) NOT NULL DEFAULT 'open',
        color varchar(32),
        sort_order int NOT NULL DEFAULT 0,
        probability int NOT NULL DEFAULT 0,
        is_won_stage boolean NOT NULL DEFAULT false,
        is_lost_stage boolean NOT NULL DEFAULT false,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS crm_opportunities (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        pipeline_id uuid NOT NULL,
        stage_id uuid NOT NULL,
        contact_id uuid,
        inbox_conversation_id uuid,
        title varchar(180) NOT NULL,
        description text,
        value_amount numeric(14,2),
        currency varchar(12) NOT NULL DEFAULT 'BRL',
        status varchar(32) NOT NULL DEFAULT 'open',
        priority varchar(24) NOT NULL DEFAULT 'normal',
        source varchar(40) NOT NULL DEFAULT 'manual',
        business_mode varchar(80) NOT NULL DEFAULT 'general',
        operational_status varchar(80),
        business_context jsonb NOT NULL DEFAULT '{}'::jsonb,
        assigned_user_id uuid,
        expected_close_date date,
        next_follow_up_at timestamptz,
        last_activity_at timestamptz,
        won_at timestamptz,
        lost_at timestamptz,
        lost_reason text,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS crm_activities (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        opportunity_id uuid NOT NULL,
        contact_id uuid,
        inbox_conversation_id uuid,
        type varchar(40) NOT NULL DEFAULT 'note',
        title varchar(180) NOT NULL,
        description text,
        status varchar(32) NOT NULL DEFAULT 'open',
        due_at timestamptz,
        completed_at timestamptz,
        assigned_user_id uuid,
        created_by_user_id uuid,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      )
    `);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_crm_pipelines_tenant_workspace ON crm_pipelines (tenant_id, workspace_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_crm_pipelines_default ON crm_pipelines (tenant_id, workspace_id, is_default)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_crm_pipelines_business_mode ON crm_pipelines (tenant_id, workspace_id, business_mode)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_crm_pipelines_status ON crm_pipelines (tenant_id, workspace_id, status)`);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_crm_stages_tenant_workspace ON crm_stages (tenant_id, workspace_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_crm_stages_pipeline ON crm_stages (pipeline_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_crm_stages_sort ON crm_stages (pipeline_id, sort_order)`);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_crm_opportunities_tenant_workspace ON crm_opportunities (tenant_id, workspace_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_crm_opportunities_pipeline ON crm_opportunities (pipeline_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_crm_opportunities_stage ON crm_opportunities (stage_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_crm_opportunities_contact ON crm_opportunities (contact_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_crm_opportunities_inbox_conversation ON crm_opportunities (inbox_conversation_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_crm_opportunities_status ON crm_opportunities (tenant_id, workspace_id, status)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_crm_opportunities_priority ON crm_opportunities (tenant_id, workspace_id, priority)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_crm_opportunities_source ON crm_opportunities (tenant_id, workspace_id, source)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_crm_opportunities_business_mode ON crm_opportunities (tenant_id, workspace_id, business_mode)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_crm_opportunities_assigned_user ON crm_opportunities (tenant_id, workspace_id, assigned_user_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_crm_opportunities_next_follow_up ON crm_opportunities (tenant_id, workspace_id, next_follow_up_at)`);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_crm_activities_tenant_workspace ON crm_activities (tenant_id, workspace_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_crm_activities_opportunity ON crm_activities (opportunity_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_crm_activities_contact ON crm_activities (contact_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_crm_activities_inbox_conversation ON crm_activities (inbox_conversation_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_crm_activities_status ON crm_activities (tenant_id, workspace_id, status)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_crm_activities_due_at ON crm_activities (tenant_id, workspace_id, due_at)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS crm_activities`);
    await queryRunner.query(`DROP TABLE IF EXISTS crm_opportunities`);
    await queryRunner.query(`DROP TABLE IF EXISTS crm_stages`);
    await queryRunner.query(`DROP TABLE IF EXISTS crm_pipelines`);
  }
}
