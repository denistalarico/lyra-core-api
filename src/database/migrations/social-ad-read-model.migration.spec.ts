import { getMetadataArgsStorage } from 'typeorm';
import {
  SocialAdEntity,
  SocialAdMetricDailyEntity,
  SocialAdSyncRunEntity,
} from '../../modules/social-integrations/entities';
import { agencyEntities } from '../../config/typeorm.config';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { CreateSocialAdReadModel1790400000000 } from './1790400000000-create-social-ad-read-model';

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
    new CreateSocialAdReadModel1790400000000().up(queryRunner),
  );

/** Column names of one entity, as declared to TypeORM. */
function columnsOf(target: new () => object) {
  return getMetadataArgsStorage()
    .columns.filter((column) => column.target === target)
    .map((column) => column.options.name ?? column.propertyName);
}

describe('social ad read model migration', () => {
  it('creates exactly the three tables of the read model', async () => {
    const joined = await up();

    for (const table of [
      'social_ad_entities',
      'social_ad_sync_runs',
      'social_ad_metrics_daily',
    ]) {
      expect(joined).toContain(`CREATE TABLE IF NOT EXISTS "${table}"`);
    }

    // The slice that reads Meta is not this one, and neither is the one that
    // acts on it.
    for (const table of [
      'social_ad_recommendations',
      'social_ad_policies',
      'social_ad_governed_actions',
    ]) {
      expect(joined).not.toContain(table);
    }
  });

  describe('the unique fact key', () => {
    it('is what a future ON CONFLICT will target', async () => {
      const joined = await up();

      expect(joined).toContain('UQ_social_ad_metrics_daily_fact');
      expect(joined).toContain(
        `("tenant_id", "workspace_id", "connection_id", "source",
         "entity_level", "entity_external_id", "metric_date", "attribution_setting")`,
      );
    });

    it('includes source, so organic never overwrites paid', async () => {
      const [fact] = (await up())
        .split(
          'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_ad_metrics_daily_fact"',
        )
        .slice(1);

      expect(fact).toContain('"source"');
    });

    it('includes attribution_setting, so a second window lands beside the first', async () => {
      // Dropping this column from the key turns "measured another way" into
      // "overwrite the number already reported to the client".
      const [fact] = (await up())
        .split(
          'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_ad_metrics_daily_fact"',
        )
        .slice(1);

      expect(fact).toContain('"attribution_setting"');
    });
  });

  it('never lets a fact be written without an attribution setting', async () => {
    const joined = await up();

    expect(joined).toContain(
      `"attribution_setting" varchar(60) NOT NULL DEFAULT 'account_default'`,
    );
    expect(joined).toContain(`"source" varchar(24) NOT NULL DEFAULT 'paid'`);
  });

  it('stores no ratio, in the table or in the entity', async () => {
    const joined = await up();
    const declared = columnsOf(SocialAdMetricDailyEntity);

    // Every one of these is a quotient of columns already present, and a
    // stored quotient stops being true the moment two rows are summed.
    for (const ratio of [
      'ctr',
      'cpc',
      'cpm',
      'cpl',
      'cpa',
      'roas',
      'frequency',
    ]) {
      expect(joined).not.toMatch(new RegExp(`"${ratio}"`, 'i'));
      expect(declared).not.toContain(ratio);
    }

    // The numerators and denominators they are derived from, however, are.
    for (const fact of ['spend', 'impressions', 'clicks', 'link_clicks']) {
      expect(declared).toContain(fact);
    }
  });

  it('keeps the day and the timezone that defined it together', async () => {
    const joined = await up();

    expect(joined).toContain('"metric_date" date NOT NULL');
    expect(joined).toContain('"account_timezone" varchar(64) NOT NULL');
    // A CURRENT_DATE bound would be a server-timezone rule applied to an
    // account-timezone date — and Postgres rejects the non-immutable
    // expression in a CHECK anyway. The comments explaining that are allowed
    // to name it; the executed SQL is not.
    expect(joined.replace(/--[^\n]*/g, '')).not.toContain('CURRENT_DATE');
  });

  it('leaves reach nullable and unaggregated', async () => {
    // Reach is de-duplicated people: summing two days double-counts anyone
    // present on both, so nothing here may imply it is additive.
    expect(await up()).toContain('"reach" bigint,');
  });

  describe('foreign keys', () => {
    it('ties every table to the connection that produced it', async () => {
      const joined = await up();

      for (const constraint of [
        'FK_social_ad_entities_connection',
        'FK_social_ad_sync_runs_connection',
        'FK_social_ad_metrics_daily_connection',
      ]) {
        expect(joined).toContain(constraint);
      }
      expect(
        joined.match(
          /REFERENCES "social_ad_account_connections" \("id"\) ON DELETE CASCADE/g,
        ),
      ).toHaveLength(3);
    });

    it('detaches facts from a pruned run instead of deleting them', async () => {
      const joined = await up();

      expect(joined).toContain('FK_social_ad_metrics_daily_sync_run');
      expect(joined).toContain(
        'REFERENCES "social_ad_sync_runs" ("id") ON DELETE SET NULL',
      );
      // Cascading here would mean a retention sweep on the log silently
      // deletes the spend history it produced.
      expect(joined).not.toMatch(
        /REFERENCES "social_ad_sync_runs" \("id"\) ON DELETE CASCADE/,
      );
    });
  });

  describe('check constraints', () => {
    it('admits exactly the seven run states', async () => {
      const joined = await up();

      expect(joined).toContain('CK_social_ad_sync_runs_status');
      for (const status of [
        'queued',
        'processing',
        'succeeded',
        'partial',
        'failed',
        'dead_letter',
        'cancelled',
      ]) {
        expect(joined).toContain(`'${status}'`);
      }
    });

    it('rejects an inverted window without rejecting an absent one', async () => {
      const joined = await up();

      expect(joined).toContain('CK_social_ad_sync_runs_window');
      expect(joined).toContain('"window_start" IS NULL');
      expect(joined).toContain('"window_start" <= "window_end"');
    });

    it('admits exactly the four hierarchy levels, on both tables', async () => {
      const joined = await up();

      expect(
        joined.match(
          /CHECK \("entity_level" IN \('account', 'campaign', 'adset', 'ad'\)\)/g,
        ),
      ).toHaveLength(2);
    });

    it('refuses to root an account under a parent', async () => {
      expect(await up()).toContain(
        `CHECK ("entity_level" <> 'account' OR "parent_external_id" IS NULL)`,
      );
    });

    it('refuses negative money and negative counts', async () => {
      const joined = await up();

      expect(joined).toContain('CK_social_ad_metrics_daily_non_negative');
      expect(joined).toContain('CK_social_ad_entities_budgets_non_negative');
    });
  });

  describe('indexes', () => {
    it('indexes the reads the pipeline and the dashboard will make', async () => {
      const joined = await up();

      for (const index of [
        'UQ_social_ad_entities_identity',
        'IDX_social_ad_entities_scope',
        'IDX_social_ad_entities_parent',
        'IDX_social_ad_entities_stale',
        'UQ_social_ad_metrics_daily_fact',
        'IDX_social_ad_metrics_daily_read',
        'IDX_social_ad_metrics_daily_campaign',
        'IDX_social_ad_metrics_daily_partial',
        'UQ_social_ad_sync_runs_inflight',
        'IDX_social_ad_sync_runs_queue',
        'IDX_social_ad_sync_runs_stale_lock',
        'IDX_social_ad_sync_runs_connection',
      ]) {
        expect(joined).toContain(index);
      }
    });

    it('binds the in-flight run constraint only to the active states', async () => {
      const joined = await up();

      // Without the WHERE, re-running the same window next week would be
      // rejected as a duplicate of a run that finished long ago.
      expect(joined).toContain(`WHERE "status" IN ('queued', 'processing')`);
    });

    it('builds no index for a retention sweep that does not exist', async () => {
      expect(await up()).not.toContain('retain_until"\n        ON');
      expect(await up()).not.toMatch(/INDEX[^;]*\("retain_until"\)/);
    });
  });

  it('drops the three tables in reverse dependency order', async () => {
    const joined = await collectSql((queryRunner) =>
      new CreateSocialAdReadModel1790400000000().down(queryRunner),
    );

    // Facts reference runs; dropping the runs first would fail on the FK.
    expect(joined.indexOf('social_ad_metrics_daily')).toBeLessThan(
      joined.indexOf('social_ad_sync_runs'),
    );
    expect(joined).toContain('DROP TABLE IF EXISTS "social_ad_entities"');
    // The connection table belongs to S1 and outlives this migration.
    expect(joined).not.toContain('social_ad_account_connections');
  });
});

describe('social ad read model registration', () => {
  it('is registered in the agency datasource, where the tenants live', () => {
    expect(AgencyDataSource.options.migrations).toContain(
      CreateSocialAdReadModel1790400000000,
    );
  });

  it('registers all three entities as agency entities', () => {
    for (const entity of [
      SocialAdEntity,
      SocialAdMetricDailyEntity,
      SocialAdSyncRunEntity,
    ]) {
      expect(agencyEntities).toContain(entity);
    }
  });

  it('declares the same table names the migration creates', () => {
    const tables = getMetadataArgsStorage()
      .tables.filter((table) =>
        [
          SocialAdEntity,
          SocialAdMetricDailyEntity,
          SocialAdSyncRunEntity,
        ].includes(table.target as never),
      )
      .map((table) => table.name);

    expect(tables.sort()).toEqual([
      'social_ad_entities',
      'social_ad_metrics_daily',
      'social_ad_sync_runs',
    ]);
  });
});
