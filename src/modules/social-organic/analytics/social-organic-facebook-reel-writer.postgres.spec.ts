import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import { CreateSocialOrganicConnections1791500000000 } from '../../../database/migrations/1791500000000-create-social-organic-connections';
import { AddFacebookPageMeasures1796400000000 } from '../../../database/migrations/1796400000000-add-facebook-page-measures';
import { describePostgresIntegration } from '../../../testing/postgres-integration';
import {
  SocialOrganicFacebookReelWriterService,
  type OrganicFacebookReelObservation,
} from './social-organic-facebook-reel-writer.service';

const run = describePostgresIntegration();

/**
 * The reel upsert against a real table.
 *
 * Worth a Postgres spec for what only the database can witness: the statement
 * binds 30 positional parameters, which is the shape where an off-by-one
 * type-checks perfectly and writes a play count into the replay column. And
 * `retention_graph` is the module's first jsonb column carrying a structure
 * rather than a bag of provider leftovers — a round trip through the driver is
 * the only thing that shows it comes back as the object that went in.
 */
run('SocialOrganicFacebookReelWriterService against PostgreSQL', () => {
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  const connectionId = randomUUID();
  const assetId = randomUUID();
  let service: SocialOrganicFacebookReelWriterService;

  const observation = (
    overrides: Partial<OrganicFacebookReelObservation> = {},
  ): OrganicFacebookReelObservation => ({
    tenantId,
    workspaceId,
    agencyClientId: null,
    assetId,
    provider: 'meta',
    externalPublicationId: 'reel-1',
    publishedAt: new Date('2026-09-10T13:41:05.000Z'),
    description: 'Um reel',
    permalink: '/reel/reel-1/',
    thumbnailUrl: 'https://cdn.example/reel.jpg',
    lengthSeconds: '27.271',
    plays: '5659',
    blueReelsPlays: '5285',
    replays: '374',
    uniqueViewers: '6243',
    totalWatchTimeMs: '47678166',
    avgWatchTimeMs: '9023',
    reactionsTotal: '15',
    reactionsLike: '12',
    reactionsLove: '3',
    reactionsWow: '0',
    reactionsHaha: '0',
    reactionsSorry: '0',
    reactionsAnger: '0',
    comments: '2',
    shares: '4',
    newFollowers: '1',
    retentionGraph: { '0': 0.9822, '1': 0.9841 },
    observedAt: new Date('2026-09-24T12:00:00.000Z'),
    syncRunId: null,
    ...overrides,
  });

  async function readRow() {
    const [row] = await AgencyDataSource.query<Array<Record<string, unknown>>>(
      `SELECT plays::text, blue_reels_plays::text, replays::text,
              unique_viewers::text, total_watch_time_ms::text,
              avg_watch_time_ms::text, reactions_total::text,
              reactions_like::text, reactions_love::text, comments::text,
              shares::text, new_followers::text, length_seconds::text,
              retention_graph, thumbnail_url, observed_at
         FROM social_organic_facebook_reels
        WHERE asset_id = $1 AND external_publication_id = 'reel-1'`,
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
      await new AddFacebookPageMeasures1796400000000().up(queryRunner);
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
       VALUES ($1, $2, $3, $4, 'meta', 'facebook_page', $5)`,
      [assetId, tenantId, workspaceId, connectionId, `external-${assetId}`],
    );

    service = new SocialOrganicFacebookReelWriterService(AgencyDataSource);
  });

  afterAll(async () => {
    try {
      await AgencyDataSource.query(
        `DELETE FROM social_organic_facebook_reels WHERE asset_id = $1`,
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
    // Each value is distinct, so a mis-ordered parameter shows up as a swapped
    // number rather than passing by coincidence.
    await service.upsert([observation()]);

    expect(await readRow()).toMatchObject({
      plays: '5659',
      blue_reels_plays: '5285',
      replays: '374',
      unique_viewers: '6243',
      total_watch_time_ms: '47678166',
      avg_watch_time_ms: '9023',
      reactions_total: '15',
      reactions_like: '12',
      reactions_love: '3',
      comments: '2',
      shares: '4',
      new_followers: '1',
      length_seconds: '27.271',
    });
  });

  it('returns the retention curve as the object that went in', async () => {
    await service.upsert([
      observation({ retentionGraph: { '0': 0.5, '1': 0.25 } }),
    ]);

    expect((await readRow()).retention_graph).toEqual({
      '0': 0.5,
      '1': 0.25,
    });
  });

  it('keeps one row per reel across re-reads', async () => {
    await service.upsert([observation()]);
    await service.upsert([observation({ plays: '6000' })]);

    const [{ count }] = await AgencyDataSource.query<Array<{ count: string }>>(
      `SELECT COUNT(*)::text AS count
         FROM social_organic_facebook_reels
        WHERE asset_id = $1`,
      [assetId],
    );

    expect(count).toBe('1');
    expect((await readRow()).plays).toBe('6000');
  });

  it('does not let a refused read erase a counter it once had', async () => {
    await service.upsert([observation()]);
    // What a pass looks like when `video_insights` was refused: the listing's
    // figures are there and everything the insights edge knows is null.
    await service.upsert([
      observation({
        uniqueViewers: null,
        totalWatchTimeMs: null,
        retentionGraph: null,
      }),
    ]);

    const row = await readRow();
    expect(row.unique_viewers).toBe('6243');
    expect(row.total_watch_time_ms).toBe('47678166');
    expect(row.retention_graph).toEqual({ '0': 0.9822, '1': 0.9841 });
  });

  it('moves the thumbnail forward, because the old URL has expired', async () => {
    await service.upsert([observation()]);
    await service.upsert([
      observation({ thumbnailUrl: 'https://cdn.example/fresh.jpg' }),
    ]);

    // The one identity field that should follow the newest read: Meta signs
    // these with a few days' expiry, so the latest is the only one with a
    // chance of resolving.
    expect((await readRow()).thumbnail_url).toBe(
      'https://cdn.example/fresh.jpg',
    );
  });

  it('refuses a negative counter', async () => {
    await expect(
      service.upsert([
        observation({ externalPublicationId: 'reel-neg', plays: '-1' }),
      ]),
    ).rejects.toThrow();
  });
});
