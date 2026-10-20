import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CA11.1: `inbox_settings.quick_replies` is the only source of quick replies. The Agency Inbox
 * kept its own copy inside `metadata.agencyInbox`; that copy (what Agency users saw and edited)
 * moves to the column and leaves the blob. `down()` puts it back in the blob for the old web.
 */
export class ConsolidateInboxQuickReplies1800070000000 implements MigrationInterface {
  name = 'ConsolidateInboxQuickReplies1800070000000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`UPDATE inbox_settings
      SET quick_replies=metadata->'agencyInbox'->'quickReplies',
          metadata=jsonb_set(metadata,'{agencyInbox}',(metadata->'agencyInbox')-'quickReplies')
      WHERE jsonb_typeof(metadata->'agencyInbox'->'quickReplies')='array'`);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`UPDATE inbox_settings
      SET metadata=jsonb_set(metadata,'{agencyInbox,quickReplies}',quick_replies)
      WHERE jsonb_typeof(metadata->'agencyInbox')='object'
        AND NOT (metadata->'agencyInbox' ? 'quickReplies')`);
  }
}
