import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gives every existing opportunity the follow-up mode its origin implies.
 *
 * `follow_mode` has been on the card since the beginning and never governed
 * anything: the section that edits it was disabled in the drawer, and every
 * creation path wrote the same `'manual'`. So the stored value is provably a
 * default nobody chose, and the column starts governing with this release —
 * without the backfill the feature would ship switched off for the entire
 * history.
 *
 * The origin is read from the card itself: one linked to an Inbox conversation
 * came from a real lead and is followed up automatically; one without a
 * conversation was typed into the CRM by hand, and nobody there is waiting on
 * a reply.
 *
 * Turning a card automatic does not send anything by itself. The chain is only
 * armed by a new outbound message that goes unanswered, so a conversation that
 * has been quiet for months stays quiet.
 */
export class BackfillOpportunityFollowMode1789600000000
  implements MigrationInterface
{
  name = 'BackfillOpportunityFollowMode1789600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "crm_opportunities"
      SET "follow_mode" = CASE
        WHEN "inbox_conversation_id" IS NOT NULL THEN 'automatic'
        ELSE 'disabled'
      END
      WHERE "follow_mode" = 'manual'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The previous state is a single value for every row, which is exactly why
    // it carried no decision worth preserving.
    await queryRunner.query(`
      UPDATE "crm_opportunities"
      SET "follow_mode" = 'manual'
      WHERE "follow_mode" IN ('automatic', 'disabled')
    `);
  }
}
