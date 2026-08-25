import { SocialAdAccountConnectionEntity } from '../../modules/social-integrations/entities';
import { agencyEntities } from '../../config/typeorm.config';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { CreateSocialAdAccountConnections1790200000000 } from './1790200000000-create-social-ad-account-connections';

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

describe('social_ad_account_connections migration', () => {
  it('creates the connection table with tenant, workspace and client scope', async () => {
    const joined = await collectSql((queryRunner) =>
      new CreateSocialAdAccountConnections1790200000000().up(queryRunner),
    );

    expect(joined).toContain('social_ad_account_connections');
    expect(joined).toContain('"tenant_id" uuid NOT NULL');
    expect(joined).toContain('"workspace_id" uuid NOT NULL');
    expect(joined).toContain('"agency_client_id" uuid');
    expect(joined).toContain('"provider" varchar(40) NOT NULL');
  });

  it('stores credentials in encrypted columns with a version', async () => {
    const joined = await collectSql((queryRunner) =>
      new CreateSocialAdAccountConnections1790200000000().up(queryRunner),
    );

    expect(joined).toContain('"access_token_encrypted" text');
    expect(joined).toContain('"refresh_token_encrypted" text');
    expect(joined).toContain('"credential_version" integer NOT NULL DEFAULT 1');
    expect(joined).toContain('"credential_removed_at" timestamptz');
    // A plaintext token column would make the encrypted one decorative.
    expect(joined).not.toMatch(/"access_token"\s+text/);
  });

  it('makes a duplicate live account impossible', async () => {
    const joined = await collectSql((queryRunner) =>
      new CreateSocialAdAccountConnections1790200000000().up(queryRunner),
    );

    expect(joined).toContain('UQ_social_ad_account_connections_account');
    expect(joined).toContain(
      '("tenant_id", "workspace_id", "provider", "external_account_id")',
    );
  });

  it('indexes the operational context and the callback lookup', async () => {
    const joined = await collectSql((queryRunner) =>
      new CreateSocialAdAccountConnections1790200000000().up(queryRunner),
    );

    expect(joined).toContain('IDX_social_ad_account_connections_context');
    expect(joined).toContain(
      '("tenant_id", "workspace_id", "agency_client_id")',
    );
    expect(joined).toContain('IDX_social_ad_account_connections_oauth_state');
  });

  it('creates no metrics, campaign, recommendation or policy table', async () => {
    const joined = await collectSql((queryRunner) =>
      new CreateSocialAdAccountConnections1790200000000().up(queryRunner),
    );

    for (const table of [
      'social_ad_metrics_daily',
      'social_ad_entities',
      'social_ad_sync_runs',
      'social_ad_recommendations',
      'social_ad_policies',
      'social_ad_governed_actions',
    ]) {
      expect(joined).not.toContain(table);
    }
  });

  it('drops only its own table on the way down', async () => {
    const joined = await collectSql((queryRunner) =>
      new CreateSocialAdAccountConnections1790200000000().down(queryRunner),
    );

    expect(joined).toContain(
      'DROP TABLE IF EXISTS "social_ad_account_connections"',
    );
  });
});

describe('social_ad_account_connections registration', () => {
  it('is registered in the agency datasource, where the tenants live', () => {
    expect(AgencyDataSource.options.migrations).toContain(
      CreateSocialAdAccountConnections1790200000000,
    );
  });

  it('is registered as an agency entity', () => {
    expect(agencyEntities).toContain(SocialAdAccountConnectionEntity);
  });
});
