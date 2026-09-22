import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Resolves the one conflict `PromoteAgencyOwnedLegacyScope1795200000000`
 * deliberately refuses to decide on its own.
 *
 * `inbox_settings` and `inbox_autonomy_controls` allow a single `agency` row
 * per (tenant, workspace), enforced by a partial unique index. When CC2G hid
 * the historical row, `ensureSettings` found no visible agency settings on the
 * next read and wrote a fresh default — so the slot the legacy row needed was
 * already taken, and 1795200000000 skipped it rather than guess which of two
 * configurations should win.
 *
 * Here that guess is no longer needed, because the two rows are not equivalent:
 * one was written by a person, the other by the bootstrap. A bootstrap row is
 * identifiable without heuristics — `created_at = updated_at` (never edited
 * since creation) and no `agencyInbox` key, which is where the frontend
 * round-trips the entire settings object (`leadflowInboxSettings.ts`; the
 * structured columns are a template the backend never reads back). A row
 * failing either test is left alone.
 *
 * This runs on a restored dump, where the conflict exists. On a database built
 * from scratch the tables start empty, CC2E stamps nothing, no legacy row is
 * ever created, and every statement here matches zero rows.
 */
export class ResolveLegacyInboxSettingsConflict1795300000000
  implements MigrationInterface
{
  name = 'ResolveLegacyInboxSettingsConflict1795300000000';

  /**
   * `inbox_autonomy_controls` is included for symmetry: it carries the same
   * singleton index and the same bootstrap pattern. It has no `metadata`
   * column, so an untouched-since-creation bootstrap is identified by its
   * timestamps alone — and, unlike settings, it holds only three booleans, so
   * an all-default row carries no operator intent to preserve.
   */
  async up(queryRunner: QueryRunner): Promise<void> {
    // ── inbox_settings ──────────────────────────────────────────────────
    // Drop the untouched bootstrap only where a legacy row is actually
    // waiting for the slot; a bootstrap that is the only row is legitimate.
    await queryRunner.query(`
      DELETE FROM "inbox_settings" bootstrap
       WHERE bootstrap."scope_kind" = 'agency'
         AND bootstrap."created_at" = bootstrap."updated_at"
         AND NOT (bootstrap."metadata" ? 'agencyInbox')
         AND EXISTS (
           SELECT 1 FROM "inbox_settings" legacy_row
            WHERE legacy_row."tenant_id" = bootstrap."tenant_id"
              AND legacy_row."workspace_id" = bootstrap."workspace_id"
              AND legacy_row."scope_kind" = 'legacy_unassigned'
              AND legacy_row."agency_client_id" IS NULL
              AND legacy_row."company_context_id" IS NULL
              AND legacy_row."metadata" ? 'agencyInbox'
         )
    `);

    // Promote the real row into the slot just freed. Re-asserts the same
    // conditions 1795200000000 uses, so a row that has since gained a client
    // binding is still skipped.
    await queryRunner.query(`
      UPDATE "inbox_settings" legacy_row
         SET "scope_kind" = 'agency'
       WHERE legacy_row."scope_kind" = 'legacy_unassigned'
         AND legacy_row."agency_client_id" IS NULL
         AND legacy_row."company_context_id" IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM "inbox_settings" existing
            WHERE existing."tenant_id" = legacy_row."tenant_id"
              AND existing."workspace_id" = legacy_row."workspace_id"
              AND existing."scope_kind" = 'agency'
         )
    `);

    // ── inbox_autonomy_controls ─────────────────────────────────────────
    await queryRunner.query(`
      DELETE FROM "inbox_autonomy_controls" bootstrap
       WHERE bootstrap."scope_kind" = 'agency'
         AND EXISTS (
           SELECT 1 FROM "inbox_autonomy_controls" legacy_row
            WHERE legacy_row."tenant_id" = bootstrap."tenant_id"
              AND legacy_row."workspace_id" = bootstrap."workspace_id"
              AND legacy_row."scope_kind" = 'legacy_unassigned'
              AND legacy_row."agency_client_id" IS NULL
              AND legacy_row."company_context_id" IS NULL
         )
    `);

    await queryRunner.query(`
      UPDATE "inbox_autonomy_controls" legacy_row
         SET "scope_kind" = 'agency'
       WHERE legacy_row."scope_kind" = 'legacy_unassigned'
         AND legacy_row."agency_client_id" IS NULL
         AND legacy_row."company_context_id" IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM "inbox_autonomy_controls" existing
            WHERE existing."tenant_id" = legacy_row."tenant_id"
              AND existing."workspace_id" = legacy_row."workspace_id"
              AND existing."scope_kind" = 'agency'
         )
    `);

    // Fail closed: the singleton index is the invariant this migration is
    // allowed to touch, so assert it rather than trusting the statements above.
    for (const table of ['inbox_settings', 'inbox_autonomy_controls']) {
      const [duplicate] = (await queryRunner.query(`
        SELECT count(*)::int AS count FROM (
          SELECT 1 FROM "${table}"
           WHERE "scope_kind" = 'agency'
           GROUP BY "tenant_id", "workspace_id"
          HAVING count(*) > 1
        ) duplicates
      `)) as Array<{ count: number }>;

      if (duplicate.count > 0) {
        throw new Error(
          `ResolveLegacyInboxSettingsConflict: ${table} would hold more than one agency row per workspace; rolling back.`,
        );
      }
    }
  }

  /**
   * Irreversible by design: the deleted bootstrap rows carried no
   * configuration, and the promoted rows are now indistinguishable from
   * ordinary agency ones. See the note on 1795200000000.
   */
  async down(): Promise<void> {
    // Intentionally empty.
  }
}
