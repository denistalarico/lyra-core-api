import type { MigrationInterface, QueryRunner } from 'typeorm';

/** AN-LF3: keep recommendations in Visão Geral, but remove its fixed tab. */
export class RemoveLeadflowRecommendationsTab1801000000000 implements MigrationInterface {
  name = 'RemoveLeadflowRecommendationsTab1801000000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      `DELETE FROM leadflow_analytics_dashboards
        WHERE channel_key = 'recommendations'`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      INSERT INTO leadflow_analytics_dashboards
        (tenant_id, workspace_id, agency_client_id, company_context_id,
         name, is_default, channel_key, channels, layout, created_by_id)
      SELECT d.tenant_id, d.workspace_id, d.agency_client_id, d.company_context_id,
             'Sugestões', false, 'recommendations', '["recommendations"]'::jsonb,
             '{"version":1,"sections":[{"id":"section-recommendations","channel":"recommendations","title":"Sugestões","cards":[{"id":"recommendations.list","kind":"table","title":"Sugestões (leitura)","description":null,"size":{"w":10,"h":5},"source":"recommendations.list"}]}]}'::jsonb,
             NULL
        FROM leadflow_analytics_dashboards d
       WHERE d.is_default
         AND NOT EXISTS (
           SELECT 1
             FROM leadflow_analytics_dashboards existing
            WHERE existing.tenant_id = d.tenant_id
              AND existing.workspace_id = d.workspace_id
              AND existing.agency_client_id IS NOT DISTINCT FROM d.agency_client_id
              AND existing.company_context_id IS NOT DISTINCT FROM d.company_context_id
              AND existing.channel_key = 'recommendations'
         )
      ON CONFLICT DO NOTHING
    `);
  }
}
