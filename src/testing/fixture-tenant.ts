import type { DataSource } from 'typeorm';

/**
 * Scoped cleanup for specs that need real commits.
 *
 * These suites cannot run inside one transaction — they exercise concurrent
 * claims, advisory locks and services that open their own connections, none of
 * which can see uncommitted rows. So they commit, and something has to clean up
 * afterwards. Until 2026-08-26 that something was
 * `TRUNCATE <table-list> RESTART IDENTITY CASCADE`, which is scoped to nothing
 * at all: it emptied the tables for every tenant in the database, and on a
 * shared database that means every customer.
 *
 * The replacement deletes by `tenant_id`. Each of these specs builds its
 * fixtures under a single module-level `randomUUID()`, so a delete scoped to
 * that value removes exactly what the spec created and cannot reach a row it
 * did not write — on any database, including the one it must never be pointed
 * at again.
 *
 * `RESTART IDENTITY` is not replaced by anything because nothing needed it:
 * every id in these tables is a UUID supplied by the caller.
 */

/**
 * Delete order for the tables these fixtures touch: referencing tables first.
 *
 * A single list rather than per-spec ordering, so a spec author picks tables
 * and never has to reason about foreign keys. Two pairs are mutually
 * dependent — `leadflow_agents` ↔ `leadflow_agent_versions` and
 * `leadflow_automations` ↔ `leadflow_automation_versions`, each parent holding
 * a `published_version_id`. Both cycles are broken the same way: delete the
 * parent first and let its children go by `ON DELETE CASCADE`. The version
 * tables stay listed afterwards so a spec that names only the child still
 * cleans up, and so the list reads as the complete inventory it is.
 */
export const FIXTURE_DELETE_ORDER: readonly string[] = [
  'inbox_governed_actions',
  'inbox_meta_operations',
  'inbox_channel_lifecycle_requests',
  'inbox_channel_contact_identities',
  'inbox_provider_usage_ledger',
  'inbox_media_derivatives',
  'inbox_media_assets',
  'inbox_agent_decisions',
  'inbox_processing_batches',
  'inbox_conversation_events',
  'inbox_conversation_participants',
  'inbox_attribution_observations',
  'inbox_messages',
  'inbox_conversations',
  'inbox_domain_outbox',
  'leadflow_operations_room_event_outbox',
  'leadflow_agents',
  'leadflow_agent_versions',
  'leadflow_agent_channel_bindings',
  'leadflow_agent_operational_state',
  'inbox_channels',
  'leadflow_automation_run_attempts',
  'leadflow_automation_runs',
  'leadflow_automations',
  'leadflow_automation_versions',
  'leadflow_event_deliveries',
  'platform_permission_audit_events',
  'crm_opportunity_tags',
  'crm_opportunity_events',
  'crm_opportunities',
  'crm_stages',
  'crm_pipelines',
  'contacts',
  // Social Ads. The three child tables carry `ON DELETE CASCADE` foreign keys
  // to `social_ad_account_connections`, so the connection has to go last —
  // deleting it first would cascade rows away that a cross-domain fixture may
  // still be asserting against.
  'social_ad_metrics_daily',
  'social_ad_entities',
  'social_ad_sync_runs',
  'social_ad_account_connections',
];

/**
 * Remove every fixture row this tenant owns, in an order the foreign keys
 * accept.
 *
 * One transaction, so a failure midway leaves the database as it was rather
 * than half-cleaned — a half-cleaned fixture is what makes the *next* test
 * fail, several files away from the cause.
 */
export async function deleteFixtureTenant(
  dataSource: DataSource,
  tenantId: string,
  tables: readonly string[],
): Promise<void> {
  const unknown = tables.filter(
    (table) => !FIXTURE_DELETE_ORDER.includes(table),
  );

  if (unknown.length > 0) {
    // Refusing beats guessing: an unlisted table has no established position
    // among the foreign keys, and appending it blindly would produce a cleanup
    // that fails only when that table happens to hold a row.
    throw new Error(
      `deleteFixtureTenant: add ${unknown.join(', ')} to FIXTURE_DELETE_ORDER ` +
        `at the position its foreign keys require.`,
    );
  }

  const ordered = FIXTURE_DELETE_ORDER.filter((table) =>
    tables.includes(table),
  );

  await dataSource.transaction(async (manager) => {
    for (const table of ordered) {
      await manager.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [
        tenantId,
      ]);
    }
  });
}
