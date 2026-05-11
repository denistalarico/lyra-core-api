import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInboxSettings1760000021000 implements MigrationInterface {
  name = 'CreateInboxSettings1760000021000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS inbox_settings (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        tags jsonb NOT NULL DEFAULT '[]'::jsonb,
        channels jsonb NOT NULL DEFAULT '[]'::jsonb,
        ai_assignment_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
        human_assignment_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
        notification_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
        business_hours jsonb NOT NULL DEFAULT '{}'::jsonb,
        conversation_automations jsonb NOT NULL DEFAULT '[]'::jsonb,
        quick_replies jsonb NOT NULL DEFAULT '[]'::jsonb,
        lead_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_settings_tenant_workspace
      ON inbox_settings (tenant_id, workspace_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_inbox_settings_tenant_workspace;`);
    await queryRunner.query(`DROP TABLE IF EXISTS inbox_settings;`);
  }
}
