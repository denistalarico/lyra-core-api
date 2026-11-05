import { randomUUID } from 'node:crypto';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { leadFlowChannelDefaultLayout } from '../../modules/leadflow-analytics/dashboards/leadflow-channel-default-layouts';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { ApplyLeadflowChannelDefaultLayouts1801800000000 } from './1801800000000-apply-leadflow-channel-default-layouts';

const run = describePostgresIntegration();
const CHANNELS = [
  'service',
  'commercial',
  'lead_quality',
  'automations',
] as const;

function operatorLayout(channel: string) {
  return {
    version: 1,
    sections: [
      {
        id: `operator-${channel}`,
        channel,
        title: `Operador ${channel}`,
        cards: [],
      },
    ],
  };
}

run(
  'apply LeadFlow channel default layouts migration against PostgreSQL',
  () => {
    beforeAll(async () => {
      if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
    });

    afterAll(async () => {
      if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
    });

    it('runs up/down/up, backing up and restoring only fixed channel dashboards', async () => {
      const migration = new ApplyLeadflowChannelDefaultLayouts1801800000000();
      const runner = AgencyDataSource.createQueryRunner();
      const tenantId = randomUUID();
      const workspaceId = randomUUID();
      const overviewLayout = operatorLayout('overview');
      const handMadeLayout = operatorLayout('service');

      const layouts = async () =>
        Object.fromEntries(
          (
            (await runner.query(
              `SELECT coalesce(channel_key, name) AS key, layout
               FROM leadflow_analytics_dashboards
              WHERE tenant_id = $1 AND workspace_id = $2`,
              [tenantId, workspaceId],
            )) as Array<{ key: string; layout: unknown }>
          ).map((row) => [row.key, row.layout]),
        );
      const backups = async () =>
        (
          (await runner.query(
            `SELECT count(*)::int AS total
             FROM leadflow_analytics_dashboard_layout_backups b
             JOIN leadflow_analytics_dashboards d ON d.id = b.dashboard_id
            WHERE d.tenant_id = $1 AND b.reason = 'LF-DEF1'`,
            [tenantId],
          )) as Array<{ total: number }>
        )[0].total;

      const original = {
        'Visão Geral': overviewLayout,
        'Meu dashboard': handMadeLayout,
        ...Object.fromEntries(CHANNELS.map((c) => [c, operatorLayout(c)])),
      };
      const applied = {
        'Visão Geral': overviewLayout,
        'Meu dashboard': handMadeLayout,
        ...Object.fromEntries(
          CHANNELS.map((c) => [c, leadFlowChannelDefaultLayout(c)]),
        ),
      };

      await runner.connect();
      await runner.startTransaction();
      try {
        await runner.query(
          `INSERT INTO leadflow_analytics_dashboards
           (tenant_id, workspace_id, name, is_default, channels, layout)
         VALUES ($1, $2, 'Visão Geral', true, '["overview"]'::jsonb, $3::jsonb),
                ($1, $2, 'Meu dashboard', false, '["service"]'::jsonb, $4::jsonb)`,
          [
            tenantId,
            workspaceId,
            JSON.stringify(overviewLayout),
            JSON.stringify(handMadeLayout),
          ],
        );
        for (const channel of CHANNELS) {
          await runner.query(
            `INSERT INTO leadflow_analytics_dashboards
             (tenant_id, workspace_id, name, channel_key, channels, layout)
           VALUES ($1, $2, $3, $3, $4::jsonb, $5::jsonb)`,
            [
              tenantId,
              workspaceId,
              channel,
              JSON.stringify([channel]),
              JSON.stringify(operatorLayout(channel)),
            ],
          );
        }

        await migration.up(runner);
        expect(await layouts()).toEqual(applied);
        expect(await backups()).toBe(4);

        await migration.up(runner);
        expect(await backups()).toBe(4);

        await migration.down(runner);
        expect(await layouts()).toEqual(original);
        expect(await backups()).toBe(0);

        await migration.up(runner);
        expect(await layouts()).toEqual(applied);
        expect(await backups()).toBe(4);
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
      }
    });
  },
);
