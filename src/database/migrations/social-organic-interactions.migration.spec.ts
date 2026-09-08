import { agencyEntities } from '../../config/typeorm.config';
import { SocialOrganicInteractionEntity } from '../../modules/social-organic/webhooks/entities';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { CreateSocialOrganicInteractions1792300000000 } from './1792300000000-create-social-organic-interactions';

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
    new CreateSocialOrganicInteractions1792300000000().up(queryRunner),
  );

const down = () =>
  collectSql((queryRunner) =>
    new CreateSocialOrganicInteractions1792300000000().down(queryRunner),
  );

describe('social organic interactions migration', () => {
  it('creates the table', async () => {
    expect(await up()).toContain(
      'CREATE TABLE IF NOT EXISTS "social_organic_interactions"',
    );
  });

  it('guarantees idempotency with a unique index, not application code', async () => {
    expect(await up()).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_organic_interactions_external"\n        ON "social_organic_interactions"\n        ("provider", "asset_id", "external_interaction_id")',
    );
  });

  it('excludes interaction_type from the uniqueness key', async () => {
    // A comment created and later edited is one comment. Including the type
    // would make an edit insert a second row instead of converging.
    const joined = await up();
    const uniqueIndex = joined
      .split('\n')
      .filter((line) => line.includes('"provider", "asset_id"'))
      .join('\n');

    expect(uniqueIndex).not.toContain('interaction_type');
  });

  it('requires a scope — unlike the receipt, an interaction may not be tenantless', async () => {
    const joined = await up();

    expect(joined).toContain('"tenant_id" uuid NOT NULL');
    expect(joined).toContain('"workspace_id" uuid NOT NULL');
    expect(joined).toContain('"asset_id" uuid NOT NULL');
    // The agency's own context is a legitimate NULL here.
    expect(joined).toContain('"agency_client_id" uuid,');
  });

  it('constrains the interaction vocabulary', async () => {
    const joined = await up();

    expect(joined).toContain('CK_social_organic_interactions_type');
    expect(joined).toContain('CK_social_organic_interactions_surface');
    expect(joined).toContain('CK_social_organic_interactions_status');

    for (const value of [
      'post_created',
      'post_updated',
      'post_removed',
      'comment_created',
      'comment_updated',
      'comment_removed',
      'mention_created',
      'page_feed_other',
    ]) {
      expect(joined).toContain(`'${value}'`);
    }
    for (const value of [
      'page_feed',
      'page_mention',
      'instagram_comments',
      'instagram_mentions',
    ]) {
      expect(joined).toContain(`'${value}'`);
    }
  });

  it('stores no raw payload column — the receipt already holds it once', async () => {
    // §10: the domain row is normalized and minimal; duplicating the payload
    // would double the PII surface for no gain.
    const joined = await up();

    expect(joined).not.toContain('raw_payload');
    expect(joined).toContain('"retain_until" timestamptz');
  });

  it('indexes the scope, the asset timeline and the parent content', async () => {
    const joined = await up();

    expect(joined).toContain('"IDX_social_organic_interactions_scope"');
    expect(joined).toContain('"IDX_social_organic_interactions_asset"');
    expect(joined).toContain('"IDX_social_organic_interactions_content"');
  });

  it('foreign-keys nothing, so a row outlives its asset and its receipt', async () => {
    const joined = await up();

    expect(joined).not.toContain('REFERENCES "social_organic_assets"');
    expect(joined).not.toContain('REFERENCES "social_organic_webhook_events"');
  });

  it('is provider-neutral — no Meta-specific column or table name', async () => {
    const joined = `${await up()}\n${await down()}`;

    expect(joined).not.toMatch(/meta_/);
    expect(joined).not.toContain('facebook');
    expect(joined).not.toContain('instagram_media');
  });

  it('has a working down() that drops everything it created', async () => {
    const joined = await down();

    expect(joined).toContain(
      'DROP TABLE IF EXISTS "social_organic_interactions"',
    );
    for (const index of [
      'UQ_social_organic_interactions_external',
      'IDX_social_organic_interactions_scope',
      'IDX_social_organic_interactions_asset',
      'IDX_social_organic_interactions_content',
    ]) {
      expect(joined).toContain(`DROP INDEX IF EXISTS "${index}"`);
    }
  });

  it('touches no Inbox, LeadFlow or Meta Ads table', async () => {
    const joined = `${await up()}\n${await down()}`;

    expect(joined).not.toContain('inbox_');
    expect(joined).not.toContain('leadflow_');
    expect(joined).not.toContain('social_ad_');
  });

  it('is registered on the agency datasource, after the webhook receipts', () => {
    const names = AgencyDataSource.options.migrations as unknown as Array<
      new () => { name?: string }
    >;
    const registered = names.map((migration) => new migration().name);

    // AF-13: imported *and* listed. A migration that is only imported never
    // runs, and the failure is silent until the table is missing in production.
    expect(registered).toContain(
      'CreateSocialOrganicInteractions1792300000000',
    );
    expect(
      registered.indexOf('CreateSocialOrganicInteractions1792300000000'),
    ).toBeGreaterThan(
      registered.indexOf('CreateSocialOrganicWebhookEvents1792200000000'),
    );
  });

  it('registers the entity on the agency datasource', () => {
    expect(agencyEntities).toContain(SocialOrganicInteractionEntity);
  });
});
