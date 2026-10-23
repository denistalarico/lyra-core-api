import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * IX4 — one live SMS channel per business number.
 *
 * The Telnyx webhook is a single URL for every tenant (§3.5): the channel is
 * found by the number the lead wrote to, and only then is the signature
 * verified with that channel's key. Two live channels on the same number would
 * make that lookup ambiguous, so the database refuses the second one. A
 * disconnected channel keeps its number for history and does not count.
 *
 * Additive and idempotent (the PostgreSQL specs re-run `up()`).
 */
export class AddInboxSmsChannelNumberIndex1800500000000 implements MigrationInterface {
  name = 'AddInboxSmsChannelNumberIndex1800500000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_inbox_channels_sms_live_number
      ON inbox_channels (external_phone_number_id)
      WHERE type = 'sms'
        AND deleted_at IS NULL
        AND connection_status <> 'disconnected'`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      `DROP INDEX IF EXISTS uq_inbox_channels_sms_live_number`,
    );
  }
}
