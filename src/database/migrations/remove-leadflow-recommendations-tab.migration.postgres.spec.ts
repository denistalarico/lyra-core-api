import { randomUUID } from 'node:crypto';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { RemoveLeadflowRecommendationsTab1801000000000 } from './1801000000000-remove-leadflow-recommendations-tab';

const run = describePostgresIntegration();

run('remove LeadFlow recommendations tab migration against PostgreSQL', () => {
  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
  });

  afterAll(async () => {
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  it('runs up/down/up without rewriting the overview layout', async () => {
    const migration = new RemoveLeadflowRecommendationsTab1801000000000();
    const runner = AgencyDataSource.createQueryRunner();
    const tenantId = randomUUID();
    const workspaceId = randomUUID();
    const agencyClientId = randomUUID();
    const companyContextId = randomUUID();
    const overviewLayout = {
      version: 1,
      sections: [
        {
          id: 'section-overview',
          channel: 'overview',
          title: 'Visão geral',
          cards: [],
        },
      ],
    };

    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query(
        `INSERT INTO leadflow_analytics_dashboards
           (tenant_id, workspace_id, agency_client_id, company_context_id, name, is_default, channels, layout)
         VALUES ($1, $2, $3, $4, 'Visão Geral', true, '["overview"]'::jsonb, $5::jsonb)`,
        [
          tenantId,
          workspaceId,
          agencyClientId,
          companyContextId,
          JSON.stringify(overviewLayout),
        ],
      );
      await runner.query(
        `INSERT INTO leadflow_analytics_dashboards
           (tenant_id, workspace_id, agency_client_id, company_context_id, name, channel_key, channels, layout)
         VALUES ($1, $2, $3, $4, 'Sugestões', 'recommendations', '["recommendations"]'::jsonb,
                 '{"version":1,"sections":[]}'::jsonb)`,
        [tenantId, workspaceId, agencyClientId, companyContextId],
      );

      await migration.up(runner);
      expect(
        await runner.query(
          `SELECT count(*)::int AS total FROM leadflow_analytics_dashboards
            WHERE tenant_id = $1 AND workspace_id = $2 AND channel_key = 'recommendations'`,
          [tenantId, workspaceId],
        ),
      ).toEqual([{ total: 0 }]);
      expect(
        await runner.query(
          `SELECT layout FROM leadflow_analytics_dashboards
            WHERE tenant_id = $1 AND workspace_id = $2 AND is_default`,
          [tenantId, workspaceId],
        ),
      ).toEqual([{ layout: overviewLayout }]);

      await migration.down(runner);
      await migration.down(runner);
      const restored = await runner.query(
        `SELECT name, channel_key, channels, layout
           FROM leadflow_analytics_dashboards
          WHERE tenant_id = $1 AND workspace_id = $2 AND channel_key = 'recommendations'`,
        [tenantId, workspaceId],
      );
      expect(restored).toEqual([
        {
          name: 'Sugestões',
          channel_key: 'recommendations',
          channels: ['recommendations'],
          layout: {
            version: 1,
            sections: [
              {
                id: 'section-recommendations',
                channel: 'recommendations',
                title: 'Sugestões',
                cards: [
                  {
                    id: 'recommendations.list',
                    kind: 'table',
                    title: 'Sugestões (leitura)',
                    description: null,
                    size: { w: 10, h: 5 },
                    source: 'recommendations.list',
                  },
                ],
              },
            ],
          },
        },
      ]);

      await migration.up(runner);
      expect(
        await runner.query(
          `SELECT count(*)::int AS total FROM leadflow_analytics_dashboards
            WHERE tenant_id = $1 AND workspace_id = $2 AND channel_key = 'recommendations'`,
          [tenantId, workspaceId],
        ),
      ).toEqual([{ total: 0 }]);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });
});
