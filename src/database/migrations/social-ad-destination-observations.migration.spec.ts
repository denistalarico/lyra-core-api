import { getMetadataArgsStorage } from 'typeorm';
import { SocialAdDestinationObservationEntity } from '../../modules/social-integrations/entities';
import { agencyEntities } from '../../config/typeorm.config';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { CreateSocialAdDestinationObservations1790700000000 } from './1790700000000-create-social-ad-destination-observations';

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
    new CreateSocialAdDestinationObservations1790700000000().up(queryRunner),
  );

const down = () =>
  collectSql((queryRunner) =>
    new CreateSocialAdDestinationObservations1790700000000().down(queryRunner),
  );

function columnsOf(target: new () => object) {
  return getMetadataArgsStorage()
    .columns.filter((column) => column.target === target)
    .map((column) => column.options.name ?? column.propertyName);
}

describe('social ad destination observations migration', () => {
  it('creates the observations table', async () => {
    const joined = await up();

    expect(joined).toContain(
      'CREATE TABLE IF NOT EXISTS "social_ad_destination_observations"',
    );
  });

  /**
   * The vocabulary rule, enforced in the DDL. Meta publishes no
   * destination-change timestamp, so no column may claim one.
   */
  it('stores an observation instant and never an effective date', async () => {
    const joined = await up();

    expect(joined).toContain('"observed_at" timestamptz NOT NULL');
    for (const forbidden of [
      'effective_at',
      'changed_at',
      'effective_from',
      'valid_from',
    ]) {
      expect(joined).not.toContain(forbidden);
    }
  });

  /**
   * The FK that carries the whole retention argument: S2.9 deletes old sync
   * runs, and losing the record of which sweep saw a destination must never
   * delete the evidence that it was seen.
   */
  it('keeps observations when their sync run is deleted', async () => {
    const joined = await up();

    expect(joined).toContain('REFERENCES "social_ad_sync_runs" ("id")');
    expect(joined).toContain('ON DELETE SET NULL');
  });

  /**
   * The uniqueness rule is keyed on the run, not on the destination. Keying it
   * on `(entity, destination)` reads as the obvious choice and would make
   * `whatsapp → instagram_direct → whatsapp` impossible to record.
   */
  it('scopes idempotency to the run so a destination can recur', async () => {
    const joined = await up();

    expect(joined).toContain(
      '("ad_entity_id", "sync_run_id", "destination_type")',
    );
    expect(joined).toContain('WHERE "sync_run_id" IS NOT NULL');
  });

  it('indexes the entity timeline the temporal query walks', async () => {
    const joined = await up();

    expect(joined).toContain('"IDX_social_ad_destination_obs_entity"');
    expect(joined).toContain('("ad_entity_id", "observed_at")');
  });

  /**
   * Before the first sync after deploy, an ad set's historical destination is
   * genuinely unknown. Deriving rows from the current value, a campaign name or
   * an optimization goal would fabricate the history this table exists to
   * record honestly.
   */
  it('backfills nothing', async () => {
    const joined = await up();

    expect(joined).not.toMatch(/\bINSERT\b/i);
    expect(joined).not.toMatch(/\bUPDATE\b/i);
    expect(joined).not.toContain('social_ad_entities" e');
  });

  it('does not touch the current read model or the metrics table', async () => {
    const joined = await up();

    // The mirror keeps answering "where does this send people now"; this
    // migration only adds the historical companion.
    expect(joined).not.toContain('ALTER TABLE "social_ad_entities"');
    expect(joined).not.toContain('social_ad_metrics_daily');
  });

  it('drops only its own table', async () => {
    const joined = await down();

    expect(joined).toContain(
      'DROP TABLE IF EXISTS "social_ad_destination_observations"',
    );
    expect(joined).not.toContain('social_ad_entities');
  });

  it('matches the columns the entity declares', () => {
    const declared = columnsOf(SocialAdDestinationObservationEntity);

    for (const column of [
      'tenant_id',
      'workspace_id',
      'agency_client_id',
      'connection_id',
      'ad_entity_id',
      'destination_type',
      'destination_raw',
      'observed_at',
      'sync_run_id',
    ]) {
      expect(declared).toContain(column);
    }
  });

  it('is registered on the agency datasource and entity list', () => {
    // The registration gotcha: this datasource lists both by hand, so a file
    // that exists but is never added runs nowhere and fails at deploy time.
    const registered = (
      AgencyDataSource.options.migrations as Array<new () => object>
    ).map((migration) => migration.name);

    expect(registered).toContain(
      'CreateSocialAdDestinationObservations1790700000000',
    );
    expect(agencyEntities).toContain(SocialAdDestinationObservationEntity);
  });
});
