import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Promotes "conversations started by an ad" to a column of its own.
 *
 * ## Why a column when the number was already stored
 *
 * Every conversation this backfills was already in `actions`, the JSONB map of
 * everything Meta reported — the ingest has been keeping it since the first
 * sync, deliberately uncounted, because on a WhatsApp account a conversation
 * and a lead are two views of one person and nobody had yet said which one the
 * product means. The operator has now said: conversations are the primary
 * conversion.
 *
 * Reading it out of JSONB on every aggregate would work and would need no
 * migration. It is not what `leads` does, and the reason is the six places the
 * read service sums a metric: an expression repeated six times is one edit away
 * from disagreeing with itself, it cannot be indexed, and the next promoted
 * action type repeats the whole pattern. This is the same path `leads` took.
 *
 * ## Nullable, with no default
 *
 * `leads` beside it defaults to 0, and this one deliberately does not. A zero
 * default would state that every pre-existing row was measured and had no
 * conversations — but those rows have conversations, sitting in their own
 * `actions` payload. The backfill below reads them out, and the column stays
 * nullable afterwards so that a row collected by a future path that does not
 * request the field stays distinguishable from a genuine zero. Same rule as
 * `thruplays`, which was added to this table under the same circumstances.
 *
 * ## The backfill is exact, not an estimate
 *
 * It re-derives from the stored payload using the same single action type the
 * normalizer now reads, so a backfilled row and a freshly synced row of the
 * same day are identical. It does not ask Meta for anything — which also means
 * it cannot be rate-limited, and it is safe to re-run: the `WHERE` clause skips
 * rows already carrying a value.
 *
 * `mappingVersion` is **not** bumped by this migration, and that is checked
 * rather than assumed: `leads`, `conversions`, `conversion_value` and
 * `video_views` come out unchanged for every input, because the type read here
 * belongs to no action family. See `meta-action-mapping.ts`.
 */
export class AddAdMessagingConversations1796600000000 implements MigrationInterface {
  name = 'AddAdMessagingConversations1796600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_ad_metrics_daily"
        ADD COLUMN IF NOT EXISTS "messaging_conversations" bigint
    `);

    /**
     * `->>` yields text; a payload that ever held a non-numeric value there
     * would abort the whole migration on the cast, so the regex gates it. The
     * stored form is a scaled decimal (`'1.000000'`), and the integer part is
     * taken rather than rounded — half a conversation from an attribution split
     * is not a conversation.
     */
    await queryRunner.query(`
      UPDATE "social_ad_metrics_daily"
         SET "messaging_conversations" =
               split_part(
                 "actions" -> 'counts'
                   ->> 'onsite_conversion.messaging_conversation_started_7d',
                 '.',
                 1
               )::bigint
       WHERE "messaging_conversations" IS NULL
         AND "actions" -> 'counts'
               ->> 'onsite_conversion.messaging_conversation_started_7d'
             ~ '^[0-9]+(\\.[0-9]+)?$'
    `);

    await queryRunner.query(`
      ALTER TABLE "social_ad_metrics_daily"
        ADD CONSTRAINT "CK_social_ad_metrics_daily_messaging_conversations"
        CHECK ("messaging_conversations" IS NULL
               OR "messaging_conversations" >= 0)
    `);
  }

  /**
   * Drops the column, and the data with it — which is safe here in a way it
   * usually is not: every value was derived from `actions`, that payload is
   * untouched by this migration, and re-running `up` reconstructs the column
   * exactly. Nothing is lost that cannot be rebuilt without contacting Meta.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_ad_metrics_daily"
        DROP CONSTRAINT IF EXISTS
          "CK_social_ad_metrics_daily_messaging_conversations"
    `);

    await queryRunner.query(`
      ALTER TABLE "social_ad_metrics_daily"
        DROP COLUMN IF EXISTS "messaging_conversations"
    `);
  }
}
