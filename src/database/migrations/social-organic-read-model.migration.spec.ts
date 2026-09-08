import { getMetadataArgsStorage } from 'typeorm';
import { agencyEntities } from '../../config/typeorm.config';
import {
  SocialOrganicAccountMetricDailyEntity,
  SocialOrganicPostMetricDailyEntity,
  SocialOrganicSyncRunEntity,
} from '../../modules/social-organic/analytics/entities';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { CreateSocialOrganicReadModel1791900000000 } from './1791900000000-create-social-organic-read-model';

function collectSql(run: (queryRunner: never) => Promise<void>) {
  const sql: string[] = [];
  const queryRunner = {
    query: jest.fn((statement: string) => {
      sql.push(statement);
      return Promise.resolve();
    }),
  };

  return run(queryRunner as never).then(() => sql.join('\n'));
}

const up = () =>
  collectSql((queryRunner) =>
    new CreateSocialOrganicReadModel1791900000000().up(queryRunner),
  );

function columnsOf(target: new () => object) {
  return getMetadataArgsStorage().columns.filter(
    (column) => column.target === target,
  );
}

describe('social organic read model migration', () => {
  it('creates the three organic analytics tables with tenant scope', async () => {
    const joined = await up();

    for (const table of [
      'social_organic_post_metrics_daily',
      'social_organic_account_metrics_daily',
      'social_organic_sync_runs',
    ]) {
      expect(joined).toContain(`CREATE TABLE IF NOT EXISTS "${table}"`);
    }

    expect(joined.match(/"tenant_id" uuid NOT NULL/g)).toHaveLength(3);
    expect(joined.match(/"workspace_id" uuid NOT NULL/g)).toHaveLength(3);
    expect(joined.match(/"agency_client_id" uuid/g)).toHaveLength(3);
  });

  it('uses the two blueprint grains as the unique fact keys', async () => {
    const joined = await up();

    expect(joined).toContain(
      '("asset_id", "external_publication_id", "metric_date", "source")',
    );
    expect(joined).toContain('("asset_id", "metric_date", "source")');
  });

  it('declares every normalized counter as bigint', () => {
    const counterProperties = new Map<new () => object, readonly string[]>([
      [
        SocialOrganicPostMetricDailyEntity,
        [
          'impressions',
          'reach',
          'likes',
          'comments',
          'shares',
          'saves',
          'videoViews',
          'watchTimeSeconds',
          'linkClicks',
          'profileVisits',
        ],
      ],
      [
        SocialOrganicAccountMetricDailyEntity,
        [
          'followersCount',
          'followersGained',
          'followersLost',
          'impressions',
          'reach',
          'profileViews',
        ],
      ],
    ] as const);

    for (const [entity, properties] of counterProperties) {
      const columns = columnsOf(entity);
      for (const property of properties) {
        expect(
          columns.find((column) => column.propertyName === property)?.options
            .type,
        ).toBe('bigint');
      }
    }
  });

  it('stores no ratio column in SQL or entity metadata', async () => {
    const joined = await up();
    const declared = [
      ...columnsOf(SocialOrganicPostMetricDailyEntity),
      ...columnsOf(SocialOrganicAccountMetricDailyEntity),
    ].map((column) => column.options.name ?? column.propertyName);

    for (const ratio of [
      'engagement_rate',
      'follower_growth_rate',
      'click_through_rate',
      'completion_rate',
      'ctr',
    ]) {
      expect(joined).not.toMatch(new RegExp(`"${ratio}"`, 'i'));
      expect(declared).not.toContain(ratio);
    }
  });

  it('requires the timezone on both fact grains without a default', () => {
    for (const entity of [
      SocialOrganicPostMetricDailyEntity,
      SocialOrganicAccountMetricDailyEntity,
    ]) {
      const timezone = columnsOf(entity).find(
        (column) => column.propertyName === 'assetTimezone',
      );

      expect(timezone?.options.nullable).not.toBe(true);
      expect(timezone?.options.default).toBeUndefined();
    }
  });

  it('keeps paid analytics out of the migration', async () => {
    expect(await up()).not.toContain('social_ad_metrics_daily');
  });

  it('drops facts before their sync runs', async () => {
    const joined = await collectSql((queryRunner) =>
      new CreateSocialOrganicReadModel1791900000000().down(queryRunner),
    );

    expect(joined.indexOf('account_metrics')).toBeLessThan(
      joined.indexOf('sync_runs'),
    );
    expect(joined.indexOf('post_metrics')).toBeLessThan(
      joined.indexOf('sync_runs'),
    );
    expect(joined).not.toContain('social_organic_assets');
  });
});

describe('social organic read model registration', () => {
  it('registers the migration in the agency datasource', () => {
    expect(AgencyDataSource.options.migrations).toContain(
      CreateSocialOrganicReadModel1791900000000,
    );
  });

  it('registers all three entities as agency entities', () => {
    expect(agencyEntities).toEqual(
      expect.arrayContaining([
        SocialOrganicPostMetricDailyEntity,
        SocialOrganicAccountMetricDailyEntity,
        SocialOrganicSyncRunEntity,
      ]),
    );
  });

  it('maps the same table names that the migration creates', () => {
    const tables = getMetadataArgsStorage()
      .tables.filter((table) =>
        [
          SocialOrganicPostMetricDailyEntity,
          SocialOrganicAccountMetricDailyEntity,
          SocialOrganicSyncRunEntity,
        ].includes(table.target as never),
      )
      .map((table) => table.name)
      .sort();

    expect(tables).toEqual([
      'social_organic_account_metrics_daily',
      'social_organic_post_metrics_daily',
      'social_organic_sync_runs',
    ]);
  });
});
