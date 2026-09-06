import { agencyEntities } from '../../config/typeorm.config';
import { SocialPublicationEntity } from '../../modules/social-organic/publication/entities/social-publication.entity';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { CreateSocialPublications1791600000000 } from './1791600000000-create-social-publications';

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

describe('social publications migration', () => {
  it('creates the execution schema with the canonical tenant scope', async () => {
    const sql = await collectSql((queryRunner) =>
      new CreateSocialPublications1791600000000().up(queryRunner),
    );

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "social_publications"');
    expect(sql).toContain('"tenant_id" uuid NOT NULL');
    expect(sql).toContain('"workspace_id" uuid NOT NULL');
    expect(sql).toContain('"agency_client_id" uuid');
    expect(sql).toContain('"scheduled_at" timestamptz NOT NULL');
    expect(sql).toContain('"payload_snapshot" jsonb NOT NULL');
    expect(sql).toContain('"payload_hash" varchar(64) NOT NULL');
    expect(sql).toContain('"external_asset_id" varchar(180) NOT NULL');
    expect(sql).not.toMatch(/provider_scheduled|provider_schedule/i);
  });

  it('creates every intent and execution-target foreign key', async () => {
    const sql = await collectSql((queryRunner) =>
      new CreateSocialPublications1791600000000().up(queryRunner),
    );

    expect(sql).toContain('FK_social_publications_content_item');
    expect(sql).toContain('REFERENCES "social_content_items" ("id")');
    expect(sql).toContain('FK_social_publications_destination');
    expect(sql).toContain('REFERENCES "social_content_destinations" ("id")');
    expect(sql).toContain('FK_social_publications_connection');
    expect(sql).toContain('REFERENCES "social_organic_connections" ("id")');
    expect(sql).toContain('FK_social_publications_asset');
    expect(sql).toContain('REFERENCES "social_organic_assets" ("id")');
  });

  it('constrains status and failure reason to their closed vocabularies', async () => {
    const sql = await collectSql((queryRunner) =>
      new CreateSocialPublications1791600000000().up(queryRunner),
    );

    expect(sql).toContain('CK_social_publications_status');
    for (const status of [
      'draft',
      'scheduled',
      'queued',
      'processing',
      'published',
      'failed',
      'cancelled',
    ]) {
      expect(sql).toContain(`'${status}'`);
    }

    expect(sql).toContain('CK_social_publications_failure_reason');
    for (const reason of [
      'credential_expired',
      'permission_lost',
      'rate_limited',
      'media_rejected',
      'payload_invalid',
      'provider_unavailable',
      'duplicate_content',
      'asset_disabled',
      'unknown',
    ]) {
      expect(sql).toContain(`'${reason}'`);
    }
  });

  it('creates the partial idempotency and due-work indexes', async () => {
    const sql = await collectSql((queryRunner) =>
      new CreateSocialPublications1791600000000().up(queryRunner),
    );

    expect(sql).toContain('UQ_social_publications_destination_idempotency');
    expect(sql).toContain(
      'ON "social_publications" ("destination_id", "idempotency_key")',
    );
    expect(sql).toContain('WHERE "destination_id" IS NOT NULL');
    expect(sql).toContain('IDX_social_publications_queue');
    expect(sql).toContain('ON "social_publications" ("available_at")');
    expect(sql).toContain(`WHERE "status" IN ('queued', 'scheduled')`);
    expect(sql).toContain('IDX_social_publications_scope_schedule');
    expect(sql).toContain(
      '("tenant_id", "workspace_id", "agency_client_id", "scheduled_at")',
    );
  });

  it('drops only the publication table on the way down', async () => {
    const sql = await collectSql((queryRunner) =>
      new CreateSocialPublications1791600000000().down(queryRunner),
    );

    expect(sql.trim()).toBe('DROP TABLE IF EXISTS "social_publications"');
  });
});

describe('social publications schema registration', () => {
  it('registers the migration in the agency datasource', () => {
    expect(AgencyDataSource.options.migrations).toContain(
      CreateSocialPublications1791600000000,
    );
  });

  it('registers the publication entity in the agency entity list', () => {
    expect(agencyEntities).toContain(SocialPublicationEntity);
  });
});
