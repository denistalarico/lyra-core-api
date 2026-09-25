import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import { CreateSocialOrganicConnections1791500000000 } from '../../../database/migrations/1791500000000-create-social-organic-connections';
import { AddReelAndStoryMeasures1796300000000 } from '../../../database/migrations/1796300000000-add-reel-and-story-measures';
import { describePostgresIntegration } from '../../../testing/postgres-integration';
import {
  SocialOrganicStoryWriterService,
  type OrganicStoryObservation,
} from './social-organic-story-writer.service';

const run = describePostgresIntegration();

/**
 * The story upsert against a real table.
 *
 * Worth a Postgres spec rather than a mocked one for two reasons the database
 * is the only witness to. The statement binds 24 positional parameters and
 * reuses `$23` for two columns, which is exactly the shape where an off-by-one
 * type-checks perfectly and writes the observation instant into the wrong
 * field. And the whole point of the table is that its rows cannot be rebuilt
 * from the provider — so "a later read must not erase what an earlier one
 * stored" is not a preference here, it is the only protection the data has.
 */
run('SocialOrganicStoryWriterService against PostgreSQL', () => {
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  const connectionId = randomUUID();
  const assetId = randomUUID();
  let service: SocialOrganicStoryWriterService;

  const observation = (
    overrides: Partial<OrganicStoryObservation> = {},
  ): OrganicStoryObservation => ({
    tenantId,
    workspaceId,
    agencyClientId: null,
    assetId,
    provider: 'meta',
    externalPublicationId: 'story-1',
    publishedAt: new Date('2026-09-24T11:00:00.000Z'),
    mediaType: 'IMAGE',
    permalink: 'https://instagram.com/stories/1',
    mediaUrl: 'https://cdn.example/story.jpg',
    thumbnailUrl: null,
    reach: '120',
    views: '145',
    replies: '3',
    shares: '2',
    totalInteractions: '5',
    profileVisits: '4',
    follows: '1',
    navForward: '60',
    navNextStory: '20',
    navBack: '7',
    navExit: '11',
    observedAt: new Date('2026-09-24T12:00:00.000Z'),
    syncRunId: null,
    ...overrides,
  });

  async function readRow() {
    const [row] = await AgencyDataSource.query<Array<Record<string, unknown>>>(
      `SELECT reach::text, views::text, replies::text, shares::text,
              total_interactions::text, profile_visits::text, follows::text,
              nav_forward::text, nav_next_story::text, nav_back::text,
              nav_exit::text, media_url, observed_at, first_observed_at
         FROM social_organic_stories
        WHERE asset_id = $1 AND external_publication_id = 'story-1'`,
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
      await new AddReelAndStoryMeasures1796300000000().up(queryRunner);
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

    service = new SocialOrganicStoryWriterService({
      query: (sql: string, params: unknown[]) =>
        AgencyDataSource.query(sql, params),
    } as never);
  });

  afterAll(async () => {
    try {
      await AgencyDataSource.query(
        `DELETE FROM social_organic_stories WHERE asset_id = $1`,
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
      reach: '120',
      views: '145',
      replies: '3',
      shares: '2',
      total_interactions: '5',
      profile_visits: '4',
      follows: '1',
      nav_forward: '60',
      nav_next_story: '20',
      nav_back: '7',
      nav_exit: '11',
    });
  });

  it('sets first_observed_at to the observation instant on insert', async () => {
    const row = await readRow();

    // `$23` is bound twice on the insert; if the second reference drifted, this
    // is where it shows.
    expect(row?.first_observed_at).toEqual(row?.observed_at);
  });

  it('advances observed_at on re-read but never first_observed_at', async () => {
    // A story's counters keep moving for its 24 hours, so a later reading
    // replaces an earlier one. `first_observed_at` is the exception: it records
    // when the collector caught the story, and pushing it forward would make a
    // story watched all day look like one just found.
    const first = await readRow();

    await service.upsert([
      observation({
        reach: '400',
        observedAt: new Date('2026-09-24T20:00:00.000Z'),
      }),
    ]);

    const second = await readRow();
    expect(second).toMatchObject({ reach: '400' });
    expect(second?.first_observed_at).toEqual(first?.first_observed_at);
    expect(second?.observed_at).not.toEqual(first?.observed_at);
  });

  it('keeps a counter a later read could not fetch', async () => {
    // The protection that matters most here. Meta's support for the navigation
    // breakdown could not be verified against production, so the collector is
    // built to tolerate a refusal — and a refused read must not erase what a
    // successful one stored, because there is no way to fetch it again once the
    // story has expired.
    await service.upsert([
      observation({
        reach: '500',
        navForward: null,
        navNextStory: null,
        navBack: null,
        navExit: null,
      }),
    ]);

    expect(await readRow()).toMatchObject({
      reach: '500',
      nav_forward: '60',
      nav_next_story: '20',
    });
  });

  it('refuses a negative counter', async () => {
    // A negative reach is not a small number, it is a parsing failure upstream.
    await expect(
      service.upsert([
        observation({ externalPublicationId: 'story-2', reach: '-1' }),
      ]),
    ).rejects.toThrow();
  });

  it('keeps one row per story rather than one per observation', async () => {
    const rows = await AgencyDataSource.query<Array<{ count: string }>>(
      `SELECT COUNT(*)::text AS count FROM social_organic_stories
        WHERE asset_id = $1`,
      [assetId],
    );

    expect(rows[0]?.count).toBe('1');
  });
});
