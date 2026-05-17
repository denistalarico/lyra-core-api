import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExpandInboxChannelsFoundation1760000024000
  implements MigrationInterface
{
  name = 'ExpandInboxChannelsFoundation1760000024000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE inbox_channels
      ADD COLUMN IF NOT EXISTS external_account_id varchar(180),
      ADD COLUMN IF NOT EXISTS external_phone_number_id varchar(180),
      ADD COLUMN IF NOT EXISTS external_page_id varchar(180),
      ADD COLUMN IF NOT EXISTS access_token_encrypted text,
      ADD COLUMN IF NOT EXISTS verify_token varchar(220),
      ADD COLUMN IF NOT EXISTS webhook_secret varchar(220)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_inbox_channels_external_account
      ON inbox_channels (tenant_id, workspace_id, external_account_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_inbox_channels_external_phone
      ON inbox_channels (tenant_id, workspace_id, external_phone_number_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_inbox_channels_external_page
      ON inbox_channels (tenant_id, workspace_id, external_page_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_inbox_channels_external_page`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_inbox_channels_external_phone`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_inbox_channels_external_account`);

    await queryRunner.query(`
      ALTER TABLE inbox_channels
      DROP COLUMN IF EXISTS webhook_secret,
      DROP COLUMN IF EXISTS verify_token,
      DROP COLUMN IF EXISTS access_token_encrypted,
      DROP COLUMN IF EXISTS external_page_id,
      DROP COLUMN IF EXISTS external_phone_number_id,
      DROP COLUMN IF EXISTS external_account_id
    `);
  }
}
