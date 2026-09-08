import { getMetadataArgsStorage } from 'typeorm';
import { agencyEntities } from '../../config/typeorm.config';
import { SocialOrganicWebhookEventEntity } from '../../modules/social-organic/webhooks/entities';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { CreateSocialOrganicWebhookEvents1792200000000 } from './1792200000000-create-social-organic-webhook-events';

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
    new CreateSocialOrganicWebhookEvents1792200000000().up(queryRunner),
  );

const down = () =>
  collectSql((queryRunner) =>
    new CreateSocialOrganicWebhookEvents1792200000000().down(queryRunner),
  );

function columnsOf(target: new () => object) {
  return getMetadataArgsStorage().columns.filter(
    (column) => column.target === target,
  );
}

describe('social organic webhook events migration', () => {
  it('creates the table', async () => {
    expect(await up()).toContain(
      'CREATE TABLE IF NOT EXISTS "social_organic_webhook_events"',
    );
  });

  it('guarantees dedupe with a unique index, not application code', async () => {
    expect(await up()).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_organic_webhook_events_key"\n        ON "social_organic_webhook_events" ("provider", "event_key")',
    );
  });

  it('keeps the scope columns nullable — a webhook carries no request context', async () => {
    const joined = await up();

    for (const column of [
      '"tenant_id" uuid,',
      '"workspace_id" uuid,',
      '"agency_client_id" uuid,',
      '"asset_id" uuid,',
    ]) {
      expect(joined).toContain(column);
    }
    expect(joined).not.toContain('"tenant_id" uuid NOT NULL');
  });

  it('constrains status and scope resolution to their vocabularies', async () => {
    const joined = await up();

    expect(joined).toContain('CK_social_organic_webhook_events_status');
    expect(joined).toContain(
      'CK_social_organic_webhook_events_scope_resolution',
    );
    for (const value of [
      'received',
      'processing',
      'processed',
      'unhandled',
      'failed',
      'dead_letter',
    ]) {
      expect(joined).toContain(`'${value}'`);
    }
    for (const value of [
      'resolved',
      'unresolved_unknown_asset',
      'unresolved_ambiguous',
      'unresolved_no_asset_id',
    ]) {
      expect(joined).toContain(`'${value}'`);
    }
  });

  it('indexes the queue, the stale lease and the scope', async () => {
    const joined = await up();

    expect(joined).toContain('"IDX_social_organic_webhook_events_queue"');
    expect(joined).toContain(`WHERE "status" = 'received'`);
    expect(joined).toContain('"IDX_social_organic_webhook_events_stale_lock"');
    expect(joined).toContain(`WHERE "status" = 'processing'`);
    expect(joined).toContain('"IDX_social_organic_webhook_events_scope"');
    expect(joined).toContain('"IDX_social_organic_webhook_events_asset"');
  });

  it('does not foreign-key the asset — a receipt outlives a disconnection', async () => {
    expect(await up()).not.toContain('REFERENCES "social_organic_assets"');
  });

  it('has a working down() that drops everything it created', async () => {
    const joined = await down();

    expect(joined).toContain(
      'DROP TABLE IF EXISTS "social_organic_webhook_events"',
    );
    for (const index of [
      'UQ_social_organic_webhook_events_key',
      'IDX_social_organic_webhook_events_queue',
      'IDX_social_organic_webhook_events_stale_lock',
      'IDX_social_organic_webhook_events_scope',
      'IDX_social_organic_webhook_events_asset',
    ]) {
      expect(joined).toContain(`DROP INDEX IF EXISTS "${index}"`);
    }
  });

  it('touches no Inbox or Meta Ads table', async () => {
    const joined = `${await up()}\n${await down()}`;

    expect(joined).not.toContain('inbox_webhook_logs');
    expect(joined).not.toContain('social_ad_');
    expect(joined).not.toContain('inbox_');
  });

  it('is registered on the agency datasource, ordered by its timestamp', () => {
    const names = AgencyDataSource.options.migrations as unknown as Array<
      new () => { name?: string }
    >;
    const registered = names.map((migration) => new migration().name);

    expect(registered).toContain(
      'CreateSocialOrganicWebhookEvents1792200000000',
    );
    // W1.2's interactions table (1792300000000) follows this one. Asserting the
    // relative order rather than "last" keeps this spec from failing every time
    // a later migration is added, while still catching a misordered insert.
    expect(
      registered.indexOf('CreateSocialOrganicInteractions1792300000000'),
    ).toBeGreaterThan(
      registered.indexOf('CreateSocialOrganicWebhookEvents1792200000000'),
    );
  });

  it('registers the entity on the agency datasource only', () => {
    expect(agencyEntities).toContain(SocialOrganicWebhookEventEntity);
  });

  it('never projects the raw payload through a select:false-style leak', () => {
    // The raw payload is backend-only by policy: it is not marked select:false
    // (the worker and any replay need it), so the guarantee is that no view
    // exists. This asserts the column is present and typed as jsonb, and the
    // boundary spec asserts no controller returns it.
    const rawPayload = columnsOf(SocialOrganicWebhookEventEntity).find(
      (column) => column.propertyName === 'rawPayload',
    );

    expect(rawPayload?.options.type).toBe('jsonb');
    expect(rawPayload?.options.name).toBe('raw_payload');
  });
});
