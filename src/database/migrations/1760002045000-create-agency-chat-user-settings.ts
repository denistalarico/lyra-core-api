import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgencyChatUserSettings1760002045000
  implements MigrationInterface
{
  name = 'CreateAgencyChatUserSettings1760002045000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS agency_chat_user_settings (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        user_id uuid NOT NULL,
        data jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_agency_chat_user_settings_user
          UNIQUE (tenant_id, workspace_id, user_id)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_chat_user_settings_tenant_workspace
      ON agency_chat_user_settings (tenant_id, workspace_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS agency_chat_user_settings`);
  }
}
