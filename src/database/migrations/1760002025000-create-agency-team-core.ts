import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgencyTeamCore1760002025000 implements MigrationInterface {
  name = 'CreateAgencyTeamCore1760002025000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS team_departments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        name varchar(160) NOT NULL,
        slug varchar(160) NOT NULL,
        description text NULL,
        color varchar(24) NULL,
        icon varchar(80) NULL,
        manager_member_id uuid NULL,
        parent_department_id uuid NULL,
        status varchar(40) NOT NULL DEFAULT 'active',
        is_system_default boolean NOT NULL DEFAULT false,
        created_by_id uuid NULL,
        position int NOT NULL DEFAULT 0,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_team_departments_slug
      ON team_departments (tenant_id, workspace_id, slug)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_team_departments_status
      ON team_departments (tenant_id, workspace_id, status)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS team_skills (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        name varchar(160) NOT NULL,
        slug varchar(160) NOT NULL,
        category varchar(100) NOT NULL,
        description text NULL,
        color varchar(24) NULL,
        status varchar(40) NOT NULL DEFAULT 'active',
        is_system_default boolean NOT NULL DEFAULT false,
        created_by_id uuid NULL,
        position int NOT NULL DEFAULT 0,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_team_skills_slug
      ON team_skills (tenant_id, workspace_id, slug)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_team_skills_category_status
      ON team_skills (tenant_id, workspace_id, category, status)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS team_members (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        user_id uuid NULL,
        contact_id uuid NULL,
        contract_id uuid NULL,
        department_id uuid NULL,
        manager_member_id uuid NULL,
        display_name varchar(180) NOT NULL,
        legal_name varchar(180) NULL,
        email varchar(180) NULL,
        phone varchar(80) NULL,
        avatar_url text NULL,
        job_title varchar(160) NULL,
        role_name varchar(160) NULL,
        seniority varchar(80) NULL,
        worker_type varchar(60) NOT NULL DEFAULT 'contractor',
        work_mode varchar(40) NOT NULL DEFAULT 'flexible',
        status varchar(40) NOT NULL DEFAULT 'active',
        work_location varchar(180) NULL,
        country varchar(2) NULL,
        timezone varchar(80) NULL,
        start_date date NULL,
        end_date date NULL,
        pin_code_hash varchar(180) NULL,
        barcode_value varchar(180) NULL,
        attendance_enabled boolean NOT NULL DEFAULT false,
        overtime_approval_required boolean NOT NULL DEFAULT true,
        hourly_cost numeric(12,2) NULL,
        monthly_cost numeric(12,2) NULL,
        currency varchar(3) NOT NULL DEFAULT 'USD',
        resume_file_key text NULL,
        notes text NULL,
        created_by_id uuid NULL,
        updated_by_id uuid NULL,
        archived_at timestamptz NULL,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_team_members_tenant_workspace
      ON team_members (tenant_id, workspace_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_team_members_status
      ON team_members (tenant_id, workspace_id, status)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_team_members_worker_type
      ON team_members (tenant_id, workspace_id, worker_type)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_team_members_department
      ON team_members (tenant_id, workspace_id, department_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_team_members_user
      ON team_members (tenant_id, workspace_id, user_id)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS team_member_skills (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        member_id uuid NOT NULL,
        skill_id uuid NOT NULL,
        level varchar(40) NOT NULL DEFAULT 'intermediate',
        notes text NULL,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_team_member_skills_member_skill
      ON team_member_skills (tenant_id, workspace_id, member_id, skill_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_team_member_skills_member
      ON team_member_skills (tenant_id, workspace_id, member_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_team_member_skills_skill
      ON team_member_skills (tenant_id, workspace_id, skill_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS team_member_skills');
    await queryRunner.query('DROP TABLE IF EXISTS team_members');
    await queryRunner.query('DROP TABLE IF EXISTS team_skills');
    await queryRunner.query('DROP TABLE IF EXISTS team_departments');
  }
}
