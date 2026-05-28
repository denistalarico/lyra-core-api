import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgencyTeamAttendance1760002026000 implements MigrationInterface {
  name = 'CreateAgencyTeamAttendance1760002026000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS team_member_presence (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        member_id uuid NOT NULL,
        status varchar(40) NOT NULL DEFAULT 'offline',
        status_message varchar(180) NULL,
        source varchar(40) NOT NULL DEFAULT 'system',
        last_seen_at timestamptz NULL,
        updated_by_id uuid NULL,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_team_member_presence_member
      ON team_member_presence (tenant_id, workspace_id, member_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_team_member_presence_status
      ON team_member_presence (tenant_id, workspace_id, status)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS team_attendance_entries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        member_id uuid NOT NULL,
        type varchar(40) NOT NULL,
        source varchar(40) NOT NULL,
        occurred_at timestamptz NOT NULL DEFAULT now(),
        timezone varchar(80) NULL,
        note text NULL,
        created_by_id uuid NULL,
        approved_by_id uuid NULL,
        approved_at timestamptz NULL,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_team_attendance_entries_member
      ON team_attendance_entries (tenant_id, workspace_id, member_id, occurred_at DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_team_attendance_entries_type
      ON team_attendance_entries (tenant_id, workspace_id, type)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_team_attendance_entries_source
      ON team_attendance_entries (tenant_id, workspace_id, source)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS team_attendance_entries');
    await queryRunner.query('DROP TABLE IF EXISTS team_member_presence');
  }
}
