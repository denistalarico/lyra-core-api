import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Promotes agency-owned `legacy_unassigned` rows to `scope_kind='agency'`.
 *
 * CC2E/CC2F stamped every pre-existing LeadFlow row `legacy_unassigned`,
 * because a migration cannot know which commercial account a row belongs to.
 * CC2G then made that bucket invisible to both agency and company reads, which
 * is correct for rows that *do* belong to some client — they must not leak into
 * an agency view before an operator reconciles them.
 *
 * It is wrong for rows that were never a client's. LeadFlow has only ever run
 * in the agency's own context here: every affected row carries no
 * `agency_client_id`, no `company_context_id`, and no legacy
 * `metadata->>'clientId'` stamp. Those three facts together are what make this
 * safe, so each statement re-asserts them in its WHERE clause rather than
 * trusting this comment — a row that has since gained a client binding is
 * skipped instead of being silently relabelled.
 *
 * The CHECK constraints already treat the two labels identically (both require
 * client and company NULL), so this only rewrites the label; no scope column
 * changes value, and nothing widens what a company-scoped read can see.
 *
 * Reconciliation stays the only path for rows that genuinely belong to a
 * client. This migration deliberately cannot express that case: it never writes
 * a non-NULL `agency_client_id`.
 */
export class PromoteAgencyOwnedLegacyScope1795200000000
  implements MigrationInterface
{
  name = 'PromoteAgencyOwnedLegacyScope1795200000000';

  /**
   * Roots carrying a `metadata` column, whose legacy client stamp must also be
   * absent before the row is considered agency-owned.
   */
  private static readonly WITH_METADATA = [
    'crm_pipelines',
    'crm_opportunities',
    'crm_tags',
    // `inbox_channels` must precede `inbox_conversations`: a conversation's
    // trigger requires it to share its channel's scope at every instant.
    'inbox_channels',
    'inbox_conversations',
  ];

  /**
   * Roots with no `metadata` column: the scope columns are the whole story.
   * `inbox_settings` and `inbox_autonomy_controls` are excluded here and
   * handled below, because they carry a one-row-per-workspace unique index.
   */
  private static readonly WITHOUT_METADATA = [
    'inbox_channel_connection_sessions',
  ];

  /**
   * Singleton roots: a partial unique index allows exactly one `agency` row per
   * (tenant, workspace). Where a bootstrap default was already created — the
   * app writes one on first read that finds no visible agency row — the legacy
   * row cannot be promoted into a duplicate.
   *
   * Such a row is skipped rather than merged. Choosing which of two settings
   * rows wins is a judgement about configuration an operator has to make; a
   * migration that guessed would silently discard either the historical setup
   * or whatever was changed since the default appeared. The skip is visible
   * (the row stays `legacy_unassigned` and keeps showing up in the
   * reconciliation inventory) instead of being quietly resolved the wrong way.
   */
  private static readonly SINGLETON = [
    'inbox_settings',
    'inbox_autonomy_controls',
  ];

  async up(queryRunner: QueryRunner): Promise<void> {
    // `TR_inbox_conversations_company_scope` refuses *any* scope change on a
    // conversation, to stop a live reassignment moving someone's messages
    // between companies. That rule is right for the application and wrong for
    // this one-off relabelling, so it is suspended for this statement only and
    // restored below — inside the migration's transaction, so a failure rolls
    // the trigger back with everything else.
    //
    // Its second rule, that a conversation matches its channel's scope, is
    // preserved by construction: channels are promoted first, and the WHERE
    // clauses admit exactly the same rows on both tables. The re-enabled
    // trigger is verified against every promoted row after the fact.
    await queryRunner.query(
      'ALTER TABLE "inbox_conversations" DISABLE TRIGGER "TR_inbox_conversations_company_scope"',
    );

    for (const table of PromoteAgencyOwnedLegacyScope1795200000000.WITH_METADATA) {
      await queryRunner.query(`
        UPDATE "${table}"
        SET "scope_kind" = 'agency'
        WHERE "scope_kind" = 'legacy_unassigned'
          AND "agency_client_id" IS NULL
          AND "company_context_id" IS NULL
          AND COALESCE("metadata"->>'clientId', '') = ''
      `);
    }

    for (const table of PromoteAgencyOwnedLegacyScope1795200000000.WITHOUT_METADATA) {
      await queryRunner.query(`
        UPDATE "${table}"
        SET "scope_kind" = 'agency'
        WHERE "scope_kind" = 'legacy_unassigned'
          AND "agency_client_id" IS NULL
          AND "company_context_id" IS NULL
      `);
    }

    for (const table of PromoteAgencyOwnedLegacyScope1795200000000.SINGLETON) {
      await queryRunner.query(`
        UPDATE "${table}" legacy_row
        SET "scope_kind" = 'agency'
        WHERE legacy_row."scope_kind" = 'legacy_unassigned'
          AND legacy_row."agency_client_id" IS NULL
          AND legacy_row."company_context_id" IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM "${table}" existing
            WHERE existing."tenant_id" = legacy_row."tenant_id"
              AND existing."workspace_id" = legacy_row."workspace_id"
              AND existing."scope_kind" = 'agency'
          )
      `);
    }

    await queryRunner.query(
      'ALTER TABLE "inbox_conversations" ENABLE TRIGGER "TR_inbox_conversations_company_scope"',
    );

    // Fail closed: assert the invariant the trigger would have enforced. If a
    // conversation ended up out of step with its channel, the whole migration
    // rolls back rather than leaving the Inbox in a state the trigger would
    // reject on the next ordinary write.
    const [drift] = (await queryRunner.query(`
      SELECT count(*)::int AS count
        FROM "inbox_conversations" conversation
        JOIN "inbox_channels" channel ON channel."id" = conversation."channel_id"
       WHERE conversation."channel_id" IS NOT NULL
         AND (
           channel."scope_kind" IS DISTINCT FROM conversation."scope_kind"
           OR channel."agency_client_id" IS DISTINCT FROM conversation."agency_client_id"
           OR channel."company_context_id" IS DISTINCT FROM conversation."company_context_id"
         )
    `)) as Array<{ count: number }>;

    if (drift.count > 0) {
      throw new Error(
        `PromoteAgencyOwnedLegacyScope: ${drift.count} conversation(s) do not share their channel's company scope; rolling back.`,
      );
    }
  }

  /**
   * Irreversible by design.
   *
   * Once promoted, an `agency` row is indistinguishable from one the agency
   * created directly — the label is the only thing that differed. Sending every
   * agency row back to `legacy_unassigned` would hide genuine agency data that
   * was never part of this promotion, which is a worse outcome than leaving the
   * promotion in place. Roll back by restoring the pre-migration backup.
   */
  async down(): Promise<void> {
    // Intentionally empty; see the note above.
  }
}
