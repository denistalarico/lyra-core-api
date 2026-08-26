import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import { SocialAdEntity } from '../entities/social-ad-entity.entity';
import type { NormalizedAdEntity } from '../sync/meta-ads-entity.contract';
import {
  SocialAdEntityWriterService,
  type SocialAdEntityWriteScope,
} from './social-ad-entity-writer.service';

/**
 * The writer against a real PostgreSQL, inside one transaction that is rolled
 * back.
 *
 * Idempotence, `first_seen_at` preservation and stale archiving are all
 * *database* behaviours: they live in an `ON CONFLICT` clause and a `WHERE`,
 * and a spec built on mocks would only prove that the strings were passed
 * along. The interesting failures — a conflict target that matches no unique
 * index, an overwrite list that resets local history — are invisible until
 * Postgres runs the statement.
 *
 * Gated behind the same flag as the other PostgreSQL specs: it needs a
 * database, and CI without one must skip rather than fail.
 */
const run =
  process.env.INBOX_PG_INTEGRATION === 'true' ? describe : describe.skip;

run('SocialAdEntityWriterService against PostgreSQL', () => {
  let queryRunner: QueryRunner;
  let writer: SocialAdEntityWriterService;

  const connectionId = randomUUID();
  const tenantId = randomUUID();
  const workspaceId = randomUUID();

  const scope: SocialAdEntityWriteScope = {
    tenantId,
    workspaceId,
    agencyClientId: null,
    connectionId,
    provider: 'meta_ads',
  };

  const at = (iso: string) => new Date(iso);

  function campaign(
    externalId: string,
    overrides: Partial<NormalizedAdEntity> = {},
  ): NormalizedAdEntity {
    return {
      entityLevel: 'campaign',
      externalId,
      parentExternalId: 'act_dry_run',
      campaignExternalId: externalId,
      name: `Campaign ${externalId}`,
      status: 'ACTIVE',
      effectiveStatus: 'ACTIVE',
      objective: 'OUTCOME_LEADS',
      optimizationGoal: null,
      billingEvent: null,
      dailyBudgetMinor: '5000',
      lifetimeBudgetMinor: null,
      budgetRemainingMinor: '0',
      currency: 'BRL',
      startTime: null,
      stopTime: null,
      providerCreatedTime: null,
      providerUpdatedTime: null,
      metadata: {},
      ...overrides,
    };
  }

  const rowsOf = (externalId: string) =>
    queryRunner.query(
      `SELECT "name", "status", "daily_budget_minor", "first_seen_at",
              "last_seen_at", "archived_at", "raw"
       FROM "social_ad_entities"
       WHERE "connection_id" = '${connectionId}' AND "external_id" = '${externalId}'`,
    ) as Promise<
      {
        name: string;
        status: string;
        daily_budget_minor: string | null;
        first_seen_at: Date;
        last_seen_at: Date;
        archived_at: Date | null;
        raw: unknown;
      }[]
    >;

  const countRows = async () => {
    const rows = (await queryRunner.query(
      `SELECT count(*)::int AS count FROM "social_ad_entities"
       WHERE "connection_id" = '${connectionId}'`,
    )) as { count: number }[];

    return rows[0].count;
  };

  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();

    queryRunner = AgencyDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    await queryRunner.query(`
      INSERT INTO "social_ad_account_connections"
        ("id", "tenant_id", "workspace_id", "provider", "external_account_id")
      VALUES ('${connectionId}', '${tenantId}', '${workspaceId}', 'meta_ads', 'act_dry_run')
    `);

    // The repository comes off the query runner, so every write below happens
    // inside the transaction and disappears with it.
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

  it('inserts a level the first time it sees it', async () => {
    const written = await writer.upsert({
      scope,
      rows: [campaign('c-1'), campaign('c-2')],
      seenAt: at('2026-08-25T10:00:00Z'),
    });

    expect(written).toBe(2);
    expect(await countRows()).toBe(2);
  });

  it('runs again without duplicating a single row', async () => {
    // The whole point of the unique identity: Meta restates the same objects on
    // every read, so a second sync has to collide and update.
    await writer.upsert({
      scope,
      rows: [campaign('c-1'), campaign('c-2')],
      seenAt: at('2026-08-25T11:00:00Z'),
    });

    expect(await countRows()).toBe(2);
  });

  it('keeps first_seen_at and advances last_seen_at', async () => {
    await writer.upsert({
      scope,
      rows: [campaign('c-1', { name: 'Renamed', status: 'PAUSED' })],
      seenAt: at('2026-08-25T12:00:00Z'),
    });

    const [row] = await rowsOf('c-1');

    expect(row.first_seen_at.toISOString()).toBe('2026-08-25T10:00:00.000Z');
    expect(row.last_seen_at.toISOString()).toBe('2026-08-25T12:00:00.000Z');
    // Mutable columns follow the provider; local history does not.
    expect(row.name).toBe('Renamed');
    expect(row.status).toBe('PAUSED');
  });

  it('leaves raw null in this slice', async () => {
    const [row] = await rowsOf('c-1');

    expect(row.raw).toBeNull();
  });

  it('archives what a complete snapshot did not contain', async () => {
    const seenAt = at('2026-08-25T13:00:00Z');

    // A sync that saw only c-1: c-2 is gone from Meta.
    await writer.upsert({ scope, rows: [campaign('c-1')], seenAt });
    const archived = await writer.archiveMissing({
      scope,
      entityLevel: 'campaign',
      seenAt,
    });

    expect(archived).toBe(1);

    const [gone] = await rowsOf('c-2');
    const [present] = await rowsOf('c-1');

    // Archived, never deleted: historical metrics reference this row for its
    // name, and a delete turns last quarter's report into numeric ids.
    expect(gone.archived_at).not.toBeNull();
    expect(present.archived_at).toBeNull();
    expect(await countRows()).toBe(2);
  });

  it('does not re-stamp a row that was already archived', async () => {
    const [before] = await rowsOf('c-2');

    await writer.archiveMissing({
      scope,
      entityLevel: 'campaign',
      seenAt: at('2026-08-25T14:00:00Z'),
    });

    const [after] = await rowsOf('c-2');

    // `archived_at` says when the object disappeared, not when the latest sync
    // noticed it was still gone.
    expect(after.archived_at).toEqual(before.archived_at);
  });

  it('un-archives an object that comes back', async () => {
    await writer.upsert({
      scope,
      rows: [campaign('c-2')],
      seenAt: at('2026-08-25T15:00:00Z'),
    });

    const [row] = await rowsOf('c-2');

    // Same statement that refreshed it, so there is no window where the object
    // is both present and archived.
    expect(row.archived_at).toBeNull();
    expect(row.first_seen_at.toISOString()).toBe('2026-08-25T10:00:00.000Z');
  });

  it('archives one level without touching another', async () => {
    const seenAt = at('2026-08-25T16:00:00Z');

    await writer.upsert({
      scope,
      rows: [
        campaign('c-1'),
        {
          ...campaign('a-1'),
          entityLevel: 'adset',
          parentExternalId: 'c-1',
          campaignExternalId: 'c-1',
        },
      ],
      seenAt,
    });

    // A campaign sweep must not archive ad sets: `entity_level` is part of the
    // predicate precisely because the four levels share one table.
    await writer.archiveMissing({ scope, entityLevel: 'campaign', seenAt });

    const [adSet] = await rowsOf('a-1');

    expect(adSet.archived_at).toBeNull();
  });

  it('writes budgets as the minor units Meta reported', async () => {
    const [row] = await rowsOf('c-1');

    // `bigint` comes back as a string, which is what keeps a lifetime budget
    // above 2^53 minor units exact.
    expect(row.daily_budget_minor).toBe('5000');
  });
});
