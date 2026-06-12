import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePlatformNotificationsLayer1760002050000
  implements MigrationInterface
{
  name = 'CreatePlatformNotificationsLayer1760002050000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

        tenant_id uuid NOT NULL,
        workspace_id uuid,
        managed_tenant_id uuid,

        product_key varchar(30) NOT NULL,
        module_key varchar(80) NOT NULL,
        event_type varchar(120) NOT NULL,
        category varchar(40) NOT NULL,
        priority varchar(20) NOT NULL DEFAULT 'normal',

        title varchar(180) NOT NULL,
        body text NOT NULL,

        action_type varchar(30) NOT NULL DEFAULT 'none',
        action_url varchar(500),

        resource_type varchar(80),
        resource_id uuid,

        actor_type varchar(30) NOT NULL,
        actor_user_id uuid,
        initiated_by_user_id uuid,

        source_event_id varchar(160) NOT NULL,
        deduplication_key varchar(255),

        template_key varchar(180) NOT NULL,
        template_variables jsonb NOT NULL DEFAULT '{}'::jsonb,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

        occurred_at timestamptz NOT NULL,
        expires_at timestamptz,

        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT uq_notifications_tenant_source_event
          UNIQUE (tenant_id, source_event_id)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_notifications_tenant_workspace_created
      ON notifications (tenant_id, workspace_id, created_at DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_notifications_product_module
      ON notifications (product_key, module_key)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_notifications_event_type
      ON notifications (event_type)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_notifications_deduplication_key
      ON notifications (deduplication_key)
      WHERE deduplication_key IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS notification_recipients (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

        notification_id uuid NOT NULL,
        user_id uuid NOT NULL,
        interest_reason varchar(40) NOT NULL,

        seen_at timestamptz,
        read_at timestamptz,
        archived_at timestamptz,
        dismissed_at timestamptz,

        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT fk_notification_recipients_notification
          FOREIGN KEY (notification_id)
          REFERENCES notifications(id)
          ON DELETE CASCADE,

        CONSTRAINT uq_notification_recipients_notification_user
          UNIQUE (notification_id, user_id)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_notification_recipients_user_created
      ON notification_recipients (user_id, created_at DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_notification_recipients_user_read_archived
      ON notification_recipients (user_id, read_at, archived_at)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS notification_deliveries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

        notification_recipient_id uuid NOT NULL,
        channel varchar(30) NOT NULL,
        status varchar(30) NOT NULL DEFAULT 'pending',

        scheduled_at timestamptz,
        sent_at timestamptz,
        failed_at timestamptz,
        failure_reason text,
        attempts integer NOT NULL DEFAULT 0,
        provider_message_id varchar(255),

        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT fk_notification_deliveries_recipient
          FOREIGN KEY (notification_recipient_id)
          REFERENCES notification_recipients(id)
          ON DELETE CASCADE,

        CONSTRAINT uq_notification_deliveries_recipient_channel
          UNIQUE (notification_recipient_id, channel)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_notification_deliveries_status_scheduled
      ON notification_deliveries (status, scheduled_at)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_notification_deliveries_status_scheduled
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS notification_deliveries
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_notification_recipients_user_read_archived
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_notification_recipients_user_created
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS notification_recipients
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_notifications_deduplication_key
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_notifications_event_type
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_notifications_product_module
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_notifications_tenant_workspace_created
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS notifications
    `);
  }
}
