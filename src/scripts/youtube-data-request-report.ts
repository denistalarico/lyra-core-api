/**
 * YouTube data request report (read-only) — runbook
 * docs/legal/public-site/YOUTUBE-DATA-DELETION-RUNBOOK.md.
 *
 *   pnpm youtube:data-request-report -- --channel-id UCxxxxxxxx
 *
 * Locates every Lyra asset of a YouTube channel and reports, per asset, its
 * scope (tenant, workspace, client, company), connection and Google link state
 * and how much YouTube API data is still stored. Run it when a deletion request
 * arrives (to find what to disconnect) and after the disconnect (to evidence
 * that nothing is left). It never writes: the transaction is READ ONLY, and it
 * prints no channel name, handle, title or token, only ids and counts.
 */
import 'reflect-metadata';
import { AgencyDataSource } from '../database/agency-typeorm.datasource';

export function parseChannelId(argv: readonly string[]): string {
  const index = argv.indexOf('--channel-id');
  const value = index >= 0 ? argv[index + 1]?.trim() : undefined;
  if (!value || !/^[A-Za-z0-9_-]{2,64}$/.test(value)) {
    throw new Error('usage: --channel-id <YouTube channel id>');
  }
  return value;
}

export const YOUTUBE_DATA_REQUEST_REPORT_SQL = `
  SELECT a.id AS "assetId", a.tenant_id AS "tenantId",
         a.workspace_id AS "workspaceId",
         a.agency_client_id AS "agencyClientId",
         a.company_context_id AS "companyContextId",
         a.status AS "assetStatus", c.connection_status AS "connectionStatus",
         (c.credential_removed_at IS NOT NULL) AS "credentialsRemoved",
         (a.display_name IS NOT NULL OR a.username IS NOT NULL
            OR a.avatar_url IS NOT NULL) AS "channelDetailsStored",
         (SELECT count(*)::int FROM social_organic_post_metrics_daily p
           WHERE p.asset_id = a.id) AS "videoMetricRows",
         (SELECT count(*)::int FROM social_organic_account_metrics_daily m
           WHERE m.asset_id = a.id) AS "channelMetricRows",
         (SELECT count(*)::int FROM social_analytics_reports r
           WHERE r.tenant_id = a.tenant_id AND r.workspace_id = a.workspace_id
             AND r.agency_client_id IS NOT DISTINCT FROM a.agency_client_id
             AND r.company_context_id IS NOT DISTINCT FROM a.company_context_id
             AND r.channels ?| ARRAY['youtube','summary']
             AND r.created_at >= a.created_at) AS "reportsWithYoutube",
         (SELECT string_agg(l.status || '/' || g.status, ',')
            FROM social_google_authorizations g
            JOIN social_google_product_links l
              ON l.authorization_id = g.id AND l.product = 'youtube'
           WHERE g.tenant_id = a.tenant_id AND g.workspace_id = a.workspace_id
             AND g.agency_client_id IS NOT DISTINCT FROM a.agency_client_id
             AND g.company_context_id IS NOT DISTINCT FROM a.company_context_id
         ) AS "googleYoutubeLinks",
         (SELECT max(e.created_at) FROM social_google_audit_events e
           WHERE e.event = 'youtube_data_purged'
             AND e.detail LIKE '%asset=' || a.id::text) AS "lastPurgedAt"
    FROM social_organic_assets a
    JOIN social_organic_connections c ON c.id = a.connection_id
   WHERE a.provider = 'youtube' AND a.external_asset_id = $1
   ORDER BY a.created_at`;

async function main(): Promise<void> {
  const channelId = parseChannelId(process.argv.slice(2));
  await AgencyDataSource.initialize();
  const runner = AgencyDataSource.createQueryRunner();
  try {
    await runner.connect();
    await runner.query('BEGIN TRANSACTION READ ONLY');
    const rows: unknown = await runner.query(YOUTUBE_DATA_REQUEST_REPORT_SQL, [
      channelId,
    ]);
    await runner.query('ROLLBACK');
    console.log(
      JSON.stringify(
        { channelId, generatedAt: new Date().toISOString(), assets: rows },
        null,
        2,
      ),
    );
  } finally {
    await runner.release();
    await AgencyDataSource.destroy();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'failed');
    process.exitCode = 1;
  });
}
