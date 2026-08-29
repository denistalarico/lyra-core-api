import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import { SocialAdEntity } from '../entities/social-ad-entity.entity';
import type { NormalizedAdEntity } from '../sync/meta-ads-entity.contract';
import {
  SocialAdEntityWriterService,
  type SocialAdEntityWriteScope,
} from './social-ad-entity-writer.service';
import { describePostgresIntegration } from '../../../testing/postgres-integration';

/**
 * The destination dimension against a real PostgreSQL.
 *
 * The questions here are all database questions. Whether a re-sync updates a
 * destination in place, whether a row that predates the feature stays NULL, and
 * whether the future "leads by destination" query can group across two tables
 * are properties of an `ON CONFLICT` list, a nullable column and a join — none
 * of which a mock can be wrong about in the same way Postgres can.
 */
const run = describePostgresIntegration();

run('Paid media destination against PostgreSQL', () => {
  let queryRunner: QueryRunner;
  let writer: SocialAdEntityWriterService;

  const connectionId = randomUUID();
  const otherConnectionId = randomUUID();
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const workspaceId = randomUUID();
  const otherWorkspaceId = randomUUID();
  const clientId = randomUUID();

  const OBSERVED_AT = new Date('2026-08-28T10:00:00.000Z');

  const scope = (
    overrides: Partial<SocialAdEntityWriteScope> = {},
  ): SocialAdEntityWriteScope => ({
    tenantId,
    workspaceId,
    agencyClientId: null,
    connectionId,
    provider: 'meta_ads',
    ...overrides,
  });

  function adSet(
    externalId: string,
    overrides: Partial<NormalizedAdEntity> = {},
  ): NormalizedAdEntity {
    return {
      entityLevel: 'adset',
      externalId,
      parentExternalId: 'campaign-1',
      campaignExternalId: 'campaign-1',
      name: `AdSet ${externalId}`,
      status: 'ACTIVE',
      effectiveStatus: 'ACTIVE',
      objective: null,
      optimizationGoal: 'CONVERSATIONS',
      billingEvent: 'IMPRESSIONS',
      destinationType: 'whatsapp',
      destinationRaw: 'WHATSAPP',
      destinationObservedAt: OBSERVED_AT,
      dailyBudgetMinor: '5000',
      lifetimeBudgetMinor: null,
      budgetRemainingMinor: null,
      currency: 'BRL',
      startTime: null,
      stopTime: null,
      providerCreatedTime: null,
      providerUpdatedTime: null,
      metadata: {},
      ...overrides,
    };
  }

  const select = async <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await queryRunner.query(sql, params)) as T[];

  const destinationOf = async (externalId: string, conn = connectionId) => {
    const rows = await select<{
      destination_type: string | null;
      destination_raw: string | null;
      destination_observed_at: Date | null;
    }>(
      `SELECT "destination_type", "destination_raw", "destination_observed_at"
         FROM "social_ad_entities"
        WHERE "connection_id" = $1 AND "external_id" = $2`,
      [conn, externalId],
    );

    return rows[0];
  };

  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();

    queryRunner = AgencyDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    for (const [id, tenant, workspace] of [
      [connectionId, tenantId, workspaceId],
      [otherConnectionId, otherTenantId, otherWorkspaceId],
    ]) {
      await queryRunner.query(
        `INSERT INTO "social_ad_account_connections"
           ("id", "tenant_id", "workspace_id", "provider", "external_account_id")
         VALUES ($1, $2, $3, 'meta_ads', 'act_dry_run')`,
        [id, tenant, workspace],
      );
    }

    writer = new SocialAdEntityWriterService(
      queryRunner.manager.getRepository(SocialAdEntity),
    );
  });

  afterAll(async () => {
    if (queryRunner?.isTransactionActive)
      await queryRunner.rollbackTransaction();
    await queryRunner?.release();
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  describe('persistence', () => {
    it('stores the canonical destination alongside the provider value', async () => {
      await writer.upsert({
        scope: scope(),
        rows: [adSet('adset-persist')],
        seenAt: new Date(),
      });

      expect(await destinationOf('adset-persist')).toMatchObject({
        destination_type: 'whatsapp',
        destination_raw: 'WHATSAPP',
        destination_observed_at: OBSERVED_AT,
      });
    });

    it('stores an unknown destination as unknown rather than as NULL', async () => {
      // The difference matters: NULL means "never observed", `unknown` means
      // "observed, and the provider had nothing to say".
      await writer.upsert({
        scope: scope(),
        rows: [
          adSet('adset-unknown', {
            destinationType: 'unknown',
            destinationRaw: 'UNDEFINED',
          }),
        ],
        seenAt: new Date(),
      });

      expect(await destinationOf('adset-unknown')).toMatchObject({
        destination_type: 'unknown',
        destination_raw: 'UNDEFINED',
      });
    });

    it('leaves levels that cannot carry a destination NULL', async () => {
      await writer.upsert({
        scope: scope(),
        rows: [
          adSet('campaign-null', {
            entityLevel: 'campaign',
            destinationType: null,
            destinationRaw: null,
            destinationObservedAt: null,
          }),
        ],
        seenAt: new Date(),
      });

      expect(await destinationOf('campaign-null')).toMatchObject({
        destination_type: null,
        destination_raw: null,
        destination_observed_at: null,
      });
    });
  });

  describe('re-sync', () => {
    /**
     * Meta's answer is the current truth, so a repointed ad set updates in
     * place. This is the behaviour that creates the historical hazard the
     * entity documents — the point of asserting it is that it is a decision,
     * not an accident.
     */
    it('updates an existing destination when the provider changes it', async () => {
      await writer.upsert({
        scope: scope(),
        rows: [adSet('adset-repoint')],
        seenAt: new Date(),
      });

      const later = new Date('2026-09-15T10:00:00.000Z');
      await writer.upsert({
        scope: scope(),
        rows: [
          adSet('adset-repoint', {
            destinationType: 'instagram_direct',
            destinationRaw: 'INSTAGRAM_DIRECT',
            destinationObservedAt: later,
          }),
        ],
        seenAt: new Date(),
      });

      expect(await destinationOf('adset-repoint')).toMatchObject({
        destination_type: 'instagram_direct',
        destination_raw: 'INSTAGRAM_DIRECT',
        // Moves with the value, so a reader can always tell how current the
        // classification is relative to the period it is reading.
        destination_observed_at: later,
      });
    });

    it('keeps first_seen_at while the destination changes', async () => {
      await writer.upsert({
        scope: scope(),
        rows: [adSet('adset-history')],
        seenAt: new Date('2026-07-01T00:00:00.000Z'),
      });

      const [before] = await select<{ first_seen_at: Date }>(
        `SELECT "first_seen_at" FROM "social_ad_entities"
          WHERE "connection_id" = $1 AND "external_id" = $2`,
        [connectionId, 'adset-history'],
      );

      await writer.upsert({
        scope: scope(),
        rows: [adSet('adset-history', { destinationType: 'messenger' })],
        seenAt: new Date('2026-08-01T00:00:00.000Z'),
      });

      const [after] = await select<{ first_seen_at: Date }>(
        `SELECT "first_seen_at" FROM "social_ad_entities"
          WHERE "connection_id" = $1 AND "external_id" = $2`,
        [connectionId, 'adset-history'],
      );

      expect(after.first_seen_at).toEqual(before.first_seen_at);
    });
  });

  describe('legacy rows', () => {
    /**
     * A row written before this feature existed. Nothing backfills it: the
     * migration adds nullable columns with no default, and no code derives a
     * destination from a name or an optimization goal.
     */
    it('leaves a row that predates the feature untouched', async () => {
      await queryRunner.query(
        `INSERT INTO "social_ad_entities"
           ("tenant_id", "workspace_id", "connection_id", "provider",
            "entity_level", "external_id", "optimization_goal", "name")
         VALUES ($1, $2, $3, 'meta_ads', 'adset', 'adset-legacy',
                 'CONVERSATIONS', 'Campanha WhatsApp Julho')`,
        [tenantId, workspaceId, connectionId],
      );

      // Both a "WhatsApp" name and a CONVERSATIONS goal are present, and
      // neither produces a destination.
      expect(await destinationOf('adset-legacy')).toMatchObject({
        destination_type: null,
        destination_raw: null,
        destination_observed_at: null,
      });
    });
  });

  describe('isolation', () => {
    it('does not leak a destination across tenants or workspaces', async () => {
      await writer.upsert({
        scope: scope(),
        rows: [adSet('adset-shared')],
        seenAt: new Date(),
      });
      await writer.upsert({
        scope: scope({
          tenantId: otherTenantId,
          workspaceId: otherWorkspaceId,
          connectionId: otherConnectionId,
        }),
        rows: [
          adSet('adset-shared', {
            destinationType: 'messenger',
            destinationRaw: 'MESSENGER',
          }),
        ],
        seenAt: new Date(),
      });

      // The same provider id under two connections is two objects, and each
      // keeps its own destination.
      expect(await destinationOf('adset-shared')).toMatchObject({
        destination_type: 'whatsapp',
      });
      expect(
        await destinationOf('adset-shared', otherConnectionId),
      ).toMatchObject({ destination_type: 'messenger' });
    });

    it('keeps a managed client destination scoped to that client', async () => {
      await writer.upsert({
        scope: scope({ agencyClientId: clientId }),
        rows: [adSet('adset-client', { destinationType: 'instagram_direct' })],
        seenAt: new Date(),
      });

      const agencyScoped = await select<{ count: string }>(
        `SELECT count(*)::text AS count FROM "social_ad_entities"
          WHERE "tenant_id" = $1 AND "workspace_id" = $2
            AND "agency_client_id" IS NULL
            AND "external_id" = 'adset-client'`,
        [tenantId, workspaceId],
      );

      // Reading the agency's own scope must not surface the client's ad set.
      expect(agencyScoped[0].count).toBe('0');

      const clientScoped = await select<{ destination_type: string }>(
        `SELECT "destination_type" FROM "social_ad_entities"
          WHERE "tenant_id" = $1 AND "workspace_id" = $2
            AND "agency_client_id" = $3
            AND "external_id" = 'adset-client'`,
        [tenantId, workspaceId, clientId],
      );

      expect(clientScoped).toEqual([{ destination_type: 'instagram_direct' }]);
    });
  });

  describe('the query a future step will run', () => {
    /**
     * Proof that the dimension is usable without changing anything downstream:
     * spend grouped by destination, joining the metrics table to the ad set
     * that carries the classification.
     *
     * The join is on the ad set, not on the ad or campaign, because that is the
     * only level Meta states a destination for. It is written out here rather
     * than implemented anywhere, since I3 must not change in this step.
     */
    it('groups metrics by destination through the ad set', async () => {
      const adSetId = 'adset-metrics';
      await writer.upsert({
        scope: scope(),
        rows: [adSet(adSetId)],
        seenAt: new Date(),
      });

      await queryRunner.query(
        `INSERT INTO "social_ad_metrics_daily"
           ("tenant_id", "workspace_id", "connection_id", "provider",
            "entity_level", "entity_external_id", "metric_date",
            "account_timezone", "spend", "impressions", "leads")
         VALUES ($1, $2, $3, 'meta_ads', 'adset', $4, DATE '2026-08-10',
                 'America/Sao_Paulo', 123.45, 1000, 7)`,
        [tenantId, workspaceId, connectionId, adSetId],
      );

      const rows = await select<{
        destination_type: string | null;
        spend: string;
        leads: string;
      }>(
        `SELECT entity."destination_type",
                sum(metric."spend")::text AS spend,
                sum(metric."leads")::text AS leads
           FROM "social_ad_metrics_daily" metric
           JOIN "social_ad_entities" entity
             ON entity."connection_id" = metric."connection_id"
            AND entity."entity_level" = metric."entity_level"
            AND entity."external_id" = metric."entity_external_id"
          WHERE metric."tenant_id" = $1
            AND metric."workspace_id" = $2
            AND metric."entity_level" = 'adset'
            AND metric."metric_date" >= DATE '2026-08-01'
            AND metric."metric_date" < DATE '2026-09-01'
          GROUP BY entity."destination_type"`,
        [tenantId, workspaceId],
      );

      expect(rows).toEqual([
        { destination_type: 'whatsapp', spend: '123.450000', leads: '7' },
      ]);
    });

    it('writes nothing to the metrics table', async () => {
      const before = await select<{ count: string }>(
        `SELECT count(*)::text AS count FROM "social_ad_metrics_daily"
          WHERE "connection_id" = $1`,
        [connectionId],
      );

      await writer.upsert({
        scope: scope(),
        rows: [adSet('adset-no-metric')],
        seenAt: new Date(),
      });

      const after = await select<{ count: string }>(
        `SELECT count(*)::text AS count FROM "social_ad_metrics_daily"
          WHERE "connection_id" = $1`,
        [connectionId],
      );

      // Destination is a dimension of the entity, never a column of the daily
      // fact table.
      expect(after[0].count).toBe(before[0].count);
    });
  });
});
