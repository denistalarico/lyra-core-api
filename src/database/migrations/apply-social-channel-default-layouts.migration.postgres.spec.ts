import { randomUUID } from 'node:crypto';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { socialChannelDefaultLayout } from '../../modules/social-analytics-dashboards/defaults/social-channel-default-layouts';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { ApplySocialChannelDefaultLayouts1801100000000 } from './1801100000000-apply-social-channel-default-layouts';

const run = describePostgresIntegration();

const CHANNELS = ['meta_ads', 'instagram', 'facebook'] as const;

function operatorLayout(channel: string) {
  return {
    version: 1,
    sections: [
      {
        id: `section-${channel}`,
        channel,
        title: `Operador ${channel}`,
        cards: [
          {
            id: `kpi-${channel}`,
            kind: 'kpi',
            size: { w: 3, h: 1 },
            metric: 'reach',
          },
        ],
      },
    ],
  };
}

run('apply Social channel default layouts migration against PostgreSQL', () => {
  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
  });

  afterAll(async () => {
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  it('runs up/down/up, backing up and restoring the channel screens only', async () => {
    const migration = new ApplySocialChannelDefaultLayouts1801100000000();
    const runner = AgencyDataSource.createQueryRunner();
    const tenantId = randomUUID();
    const workspaceId = randomUUID();
    const overviewLayout = {
      version: 1,
      sections: [
        {
          id: 'section-summary',
          channel: 'summary',
          title: 'Resumo',
          cards: [],
        },
      ],
    };
    const handMadeLayout = operatorLayout('meta_ads');

    const layouts = async () =>
      Object.fromEntries(
        (
          (await runner.query(
            `SELECT coalesce(channel_key, name) AS key, layout
               FROM social_analytics_dashboards
              WHERE tenant_id = $1 AND workspace_id = $2`,
            [tenantId, workspaceId],
          )) as Array<{ key: string; layout: unknown }>
        ).map((row) => [row.key, row.layout]),
      );
    const backups = async () =>
      (
        (await runner.query(
          `SELECT count(*)::int AS total
             FROM social_analytics_dashboard_layout_backups b
             JOIN social_analytics_dashboards d ON d.id = b.dashboard_id
            WHERE d.tenant_id = $1 AND b.reason = 'SO-DEF1'`,
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
        CHANNELS.map((c) => [c, socialChannelDefaultLayout(c)]),
      ),
    };

    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query(
        `INSERT INTO social_analytics_dashboards
           (tenant_id, workspace_id, name, is_default, channels, layout)
         VALUES ($1, $2, 'Visão Geral', true, '["summary"]'::jsonb, $3::jsonb),
                ($1, $2, 'Meu dashboard', false, '["meta_ads"]'::jsonb, $4::jsonb)`,
        [
          tenantId,
          workspaceId,
          JSON.stringify(overviewLayout),
          JSON.stringify(handMadeLayout),
        ],
      );
      for (const channel of CHANNELS) {
        await runner.query(
          `INSERT INTO social_analytics_dashboards
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
      expect(await backups()).toBe(3);

      // A second run keeps the operator's layout as the backup, not the default.
      await migration.up(runner);
      expect(await backups()).toBe(3);

      await migration.down(runner);
      expect(await layouts()).toEqual(original);
      expect(await backups()).toBe(0);
      expect(
        await runner.query(
          `SELECT to_regclass('social_analytics_dashboard_layout_backups') IS NOT NULL AS kept`,
        ),
      ).toEqual([{ kept: true }]);

      await migration.up(runner);
      expect(await layouts()).toEqual(applied);
      expect(await backups()).toBe(3);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });
});
