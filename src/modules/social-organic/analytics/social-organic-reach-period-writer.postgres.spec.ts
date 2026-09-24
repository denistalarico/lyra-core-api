import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import { CreateSocialOrganicConnections1791500000000 } from '../../../database/migrations/1791500000000-create-social-organic-connections';
import { CreateOrganicReachPeriods1795900000000 } from '../../../database/migrations/1795900000000-create-organic-reach-periods';
import { AddOrganicPeriodMeasurementColumns1796200000000 } from '../../../database/migrations/1796200000000-add-organic-period-measurement-columns';
import { describePostgresIntegration } from '../../../testing/postgres-integration';
import {
  SocialOrganicReachPeriodWriterService,
  type OrganicReachMeasurement,
} from './social-organic-reach-period-writer.service';

const run = describePostgresIntegration();

/**
 * The period-measurement upsert against a real table.
 *
 * Worth a Postgres spec rather than a mocked one because the statement grew
 * from 10 bound parameters to 19 in one change. A mock verifies the arguments
 * the service passes; only the database verifies that they line up with the
 * columns named — an off-by-one in a positional list type-checks perfectly and
 * writes the paid slice into the views column.
 */
run('SocialOrganicReachPeriodWriterService against PostgreSQL', () => {
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  const connectionId = randomUUID();
  const assetId = randomUUID();
  let service: SocialOrganicReachPeriodWriterService;

  const measurement = (
    overrides: Partial<OrganicReachMeasurement> = {},
  ): OrganicReachMeasurement => ({
    tenantId,
    workspaceId,
    agencyClientId: null,
    assetId,
    provider: 'meta',
    periodSince: '2026-08-26',
    periodUntil: '2026-09-24',
    assetTimezone: 'America/Sao_Paulo',
    reach: '6783',
    reachOrganic: '156',
    reachPaid: '6645',
    reachFeed: '40',
    views: '9155',
    viewsOrganic: '509',
    viewsPaid: '8646',
    measuredSince: '2026-08-26',
    measuredUntil: '2026-09-24',
    truncated: false,
    isPartial: false,
    ...overrides,
  });

  async function readRow() {
    const [row] = await AgencyDataSource.query<Array<Record<string, unknown>>>(
      `SELECT reach::text, reach_organic::text, reach_paid::text,
              reach_feed::text, views::text, views_organic::text,
              views_paid::text, measured_since::text, measured_until::text,
              truncated, is_partial
         FROM social_organic_reach_periods
        WHERE asset_id = $1`,
      [assetId],
    );

    return row;
  }

  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();

    const queryRunner: QueryRunner = AgencyDataSource.createQueryRunner();
    await queryRunner.connect();
    try {
      await new CreateSocialOrganicConnections1791500000000().up(queryRunner);
      await new CreateOrganicReachPeriods1795900000000().up(queryRunner);
      await new AddOrganicPeriodMeasurementColumns1796200000000().up(
        queryRunner,
      );
    } finally {
      await queryRunner.release();
    }

    await AgencyDataSource.query(
      `INSERT INTO social_organic_connections
         (id, tenant_id, workspace_id, provider, authorization_method)
       VALUES ($1, $2, $3, 'meta', 'oauth_user')`,
      [connectionId, tenantId, workspaceId],
    );
    await AgencyDataSource.query(
      `INSERT INTO social_organic_assets
         (id, tenant_id, workspace_id, connection_id, provider, asset_type,
          external_asset_id)
       VALUES ($1, $2, $3, $4, 'meta', 'instagram_professional', $5)`,
      [assetId, tenantId, workspaceId, connectionId, `external-${assetId}`],
    );

    service = new SocialOrganicReachPeriodWriterService({
      query: (sql: string, params: unknown[]) =>
        AgencyDataSource.query(sql, params),
    } as never);
  });

  afterAll(async () => {
    try {
      await AgencyDataSource.query(
        `DELETE FROM social_organic_reach_periods WHERE asset_id = $1`,
        [assetId],
      );
      await AgencyDataSource.query(
        `DELETE FROM social_organic_assets WHERE id = $1`,
        [assetId],
      );
      await AgencyDataSource.query(
        `DELETE FROM social_organic_connections WHERE id = $1`,
        [connectionId],
      );
    } finally {
      if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
    }
  });

  it('stores every figure in the column it belongs to', async () => {
    // The production figures from 2026-09-24. Each one is distinct, so a
    // mis-ordered parameter list shows up as a swapped value rather than
    // passing by coincidence.
    await service.record(measurement());

    expect(await readRow()).toMatchObject({
      reach: '6783',
      reach_organic: '156',
      reach_paid: '6645',
      reach_feed: '40',
      views: '9155',
      views_organic: '509',
      views_paid: '8646',
      measured_since: '2026-08-26',
      measured_until: '2026-09-24',
      truncated: false,
    });
  });

  it('replaces a window on re-measurement instead of accumulating', async () => {
    // A window that was still open when first measured settles when it closes.
    // Keeping both readings would leave the dashboard choosing between two
    // numbers for one question.
    await service.record(measurement({ reach: '7000', isPartial: true }));

    const rows = await AgencyDataSource.query<Array<{ count: string }>>(
      `SELECT COUNT(*)::text AS count FROM social_organic_reach_periods
        WHERE asset_id = $1`,
      [assetId],
    );

    expect(rows[0]?.count).toBe('1');
    expect(await readRow()).toMatchObject({ reach: '7000', is_partial: true });
  });

  it('clears a slice the new reading did not carry, rather than keeping a stale one', async () => {
    // The whole row describes one measurement. If a later reading returns no
    // breakdown, the old slices do not describe it — leaving them would pair a
    // fresh total with slices from a different request.
    await service.record(
      measurement({
        reach: '100',
        reachOrganic: undefined,
        reachPaid: undefined,
        reachFeed: undefined,
      }),
    );

    expect(await readRow()).toMatchObject({
      reach: '100',
      reach_organic: null,
      reach_paid: null,
      reach_feed: null,
    });
  });

  it('refuses a negative measurement', async () => {
    // The check constraint, exercised through the real statement: a negative
    // reach is not a small number, it is a parsing failure upstream, and it
    // must not reach a card.
    await expect(
      service.record(measurement({ reachOrganic: '-1' })),
    ).rejects.toThrow();
  });
});
