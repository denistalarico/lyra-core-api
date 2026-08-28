import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The acquisition-side record of *how a conversation arrived*.
 *
 * Meta sends a `referral` block on the first inbound message of a
 * click-to-message conversation: the ad that was clicked, the click id, and
 * the surface it was clicked from. Until now the WhatsApp adapter normalized
 * that block, handed it to the agent activation policy, and dropped it. The
 * identifier that would let anyone prove `ad → conversation → opportunity →
 * won` arrived on every ad-sourced conversation and was never written down.
 *
 * That loss has no backfill. Meta does not expose the referral of a past
 * message, so every inbound that arrives before this table exists is
 * permanently unattributable — which is the whole reason this is a table and
 * not a later phase of the Intelligence work.
 *
 * ## Why a table rather than metadata
 *
 * `inbox_messages.metadata` and `inbox_conversations.metadata` are both jsonb
 * with no constraints. Either would hold the values, and neither can hold the
 * *guarantees*:
 *
 * - A conversation can be observed with more than one referral. A contact who
 *   clicks a second ad three weeks later re-enters the same WhatsApp thread,
 *   and the thread is keyed by phone number. A single metadata slot means the
 *   second observation silently overwrites the first, destroying exactly the
 *   first-touch evidence the model exists to preserve. An array inside jsonb
 *   would need hand-written de-duplication against a webhook Meta is free to
 *   retry.
 * - `inbox_conversation_events` is append-only with no unique constraint and
 *   no idempotency column, so a retried webhook duplicates the row. It is also
 *   the conversation timeline the UI renders; attribution is not an event a
 *   human should read.
 * - The future join is `ad_id = social_ad_entities.external_id`. A btree on a
 *   real column costs nothing; the same join through a jsonb path costs an
 *   expression index on the largest table in Inbox.
 *
 * ## What this table is not
 *
 * It is not a copy of the webhook. Five identifiers and a timestamp are
 * stored; the headline, body text, thumbnail and source URL Meta also sends
 * are marketing copy about the ad, retrievable from `social_ad_entities` by
 * the id that *is* stored, and keeping them here would mean holding ad
 * creative in the Inbox forever for no query that wants it.
 *
 * It is also not a Social table. The row is written by channel ingestion,
 * scoped like the conversation it belongs to, and remains meaningful when no
 * Social connection exists at all — an `ad_id` observed on an ad account this
 * agency does not manage is still a true observation.
 */
export class CreateInboxAttributionObservations1790500000000
  implements MigrationInterface
{
  name = 'CreateInboxAttributionObservations1790500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "inbox_attribution_observations" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,

        -- Denormalized from "inbox_channels".metadata->>'clientId' at write
        -- time. The Inbox derives its client binding from the channel on every
        -- read, which is correct for conversations because a channel's binding
        -- is stable. It is the wrong shape for a fact: this row asserts what
        -- was true when the message arrived, and re-pointing a channel at a
        -- different client years later must not silently re-attribute
        -- historical ad spend to them. Nullable, because a channel bound to
        -- the agency's own context legitimately has no client.
        "agency_client_id" uuid,

        "conversation_id" uuid NOT NULL
          REFERENCES "inbox_conversations" ("id") ON DELETE CASCADE,

        -- The observation belongs to the message that carried it. ON DELETE
        -- CASCADE rather than SET NULL: an observation whose message is gone
        -- cannot be verified against anything, and keeping it would leave a
        -- claim about an ad with no evidence behind it.
        "message_id" uuid NOT NULL
          REFERENCES "inbox_messages" ("id") ON DELETE CASCADE,

        "channel_id" uuid,

        -- 'meta' today. A column rather than an assumption, because the same
        -- shape is what a TikTok or Google click-to-message referral would
        -- fill, and a table that hardcodes one provider gets copied instead of
        -- extended.
        "provider" varchar(40) NOT NULL,
        "channel_type" varchar(40) NOT NULL,

        -- Meta's referral.source_id. varchar(180) matches
        -- social_ad_entities.external_id exactly, so the future join needs no
        -- cast: the two columns are the same type and the same identity space.
        "ad_id" varchar(180),

        -- referral.ctwa_clid. Meta's own click identifier, the input to any
        -- provider-side attribution API that may exist later. Kept even though
        -- nothing reads it yet, because it is the half of the pair that cannot
        -- be reconstructed from the ad hierarchy.
        "click_id" varchar(180),

        -- referral.source_type: 'ad', 'post', 'page'. The surface, not the
        -- object — a 'post' referral means the click came from organic
        -- content, and an ad_id will not resolve against the ad hierarchy for
        -- one. Storing it is what keeps that a known distinction rather than a
        -- failed join.
        "source_type" varchar(60),

        -- The instant the provider says the message arrived, not the instant
        -- this row was written. Ordering by it is what makes first-touch and
        -- last-touch derivable, so a webhook replayed out of order still
        -- yields the right first observation.
        "observed_at" timestamptz NOT NULL,

        "created_at" timestamptz NOT NULL DEFAULT now(),

        -- An observation that identifies nothing is not an observation. Meta
        -- can send a referral block with neither id present; the ingestion
        -- path drops it rather than writing a row that says only "an ad,
        -- somewhere". Enforced here so no future writer can reintroduce it.
        CONSTRAINT "CK_inbox_attribution_observations_identifier"
          CHECK ("ad_id" IS NOT NULL OR "click_id" IS NOT NULL)
      )
    `);

    // The idempotency of the whole feature, and the reason ingestion needs no
    // de-duplication logic of its own.
    //
    // A message carries at most one referral, so one row per message is the
    // natural grain. Meta retries webhooks freely, but a retry resolves to the
    // same `inbox_messages` row (that table already de-duplicates on
    // provider message id), so the retry lands on this key and does nothing.
    //
    // Tenant and workspace lead the key so it is never a global lookup.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_inbox_attribution_observation_message"
        ON "inbox_attribution_observations"
        ("tenant_id", "workspace_id", "message_id")
    `);

    // "How did this conversation arrive?" — ordered so that first-touch is the
    // first row and last-touch is the last, without a sort.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_inbox_attribution_observations_conversation"
        ON "inbox_attribution_observations"
        ("conversation_id", "observed_at")
    `);

    // The future join, from the Social side: "which conversations came from
    // this ad, for this client, in this period?". Partial because a row
    // without an ad id can never satisfy that question, and on a table where
    // organic-surface referrals are common that keeps the index to the rows
    // that can actually answer.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_inbox_attribution_observations_ad"
        ON "inbox_attribution_observations"
        ("tenant_id", "workspace_id", "agency_client_id", "ad_id", "observed_at")
        WHERE "ad_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "inbox_attribution_observations"`,
    );
  }
}
