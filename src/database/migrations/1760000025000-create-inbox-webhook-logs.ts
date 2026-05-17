import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInboxWebhookLogs1760000025000
  implements MigrationInterface
{
  name = 'CreateInboxWebhookLogs1760000025000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS inbox_webhook_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid,
        workspace_id uuid,
        channel_id uuid,
        provider varchar(40) NOT NULL,
        event_type varchar(80) NOT NULL,
        status varchar(32) NOT NULL DEFAULT 'received',
        external_account_id varchar(180),
        external_phone_number_id varchar(180),
        external_message_id varchar(220),
        signature_received boolean NOT NULL DEFAULT false,
        messages_processed int NOT NULL DEFAULT 0,
        statuses_processed int NOT NULL DEFAULT 0,
        error_message text,
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_inbox_webhook_logs_provider
      ON inbox_webhook_logs (provider)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_inbox_webhook_logs_channel
      ON inbox_webhook_logs (channel_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_inbox_webhook_logs_created_at
      ON inbox_webhook_logs (created_at)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_inbox_webhook_logs_tenant_workspace
      ON inbox_webhook_logs (tenant_id, workspace_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_inbox_webhook_logs_external_phone
      ON inbox_webhook_logs (external_phone_number_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_inbox_webhook_logs_external_message
      ON inbox_webhook_logs (external_message_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_inbox_webhook_logs_external_message`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_inbox_webhook_logs_external_phone`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_inbox_webhook_logs_tenant_workspace`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_inbox_webhook_logs_created_at`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_inbox_webhook_logs_channel`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_inbox_webhook_logs_provider`);
    await queryRunner.query(`DROP TABLE IF EXISTS inbox_webhook_logs`);
  }
}
