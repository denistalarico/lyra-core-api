import { agencyEntities } from '../../config/typeorm.config';
import {
  SocialOrganicAssetEntity,
  SocialOrganicConnectionEntity,
} from '../../modules/social-organic/entities';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { CreateSocialOrganicConnections1791500000000 } from './1791500000000-create-social-organic-connections';

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

describe('social organic schema migration', () => {
  it('creates connection and asset tables with tenant scope', async () => {
    const joined = await collectSql((queryRunner) =>
      new CreateSocialOrganicConnections1791500000000().up(queryRunner),
    );

    expect(joined).toContain('social_organic_connections');
    expect(joined).toContain('social_organic_assets');
    expect(joined).toContain('"tenant_id" uuid NOT NULL');
    expect(joined).toContain('"workspace_id" uuid NOT NULL');
    expect(joined).toContain('"agency_client_id" uuid');
    expect(joined).toContain(
      '("tenant_id", "workspace_id", "agency_client_id")',
    );
  });

  it('creates the asset foreign key and scoped external-asset uniqueness', async () => {
    const joined = await collectSql((queryRunner) =>
      new CreateSocialOrganicConnections1791500000000().up(queryRunner),
    );

    expect(joined).toContain('FK_social_organic_assets_connection');
    expect(joined).toContain(
      'FOREIGN KEY ("connection_id")\n          REFERENCES "social_organic_connections" ("id")',
    );
    expect(joined).toContain('UQ_social_organic_assets_external_asset');
    expect(joined).toContain(
      'UNIQUE ("tenant_id", "workspace_id", "provider", "external_asset_id")',
    );
  });

  it('stores only encrypted credential columns', async () => {
    const joined = await collectSql((queryRunner) =>
      new CreateSocialOrganicConnections1791500000000().up(queryRunner),
    );

    expect(joined).toContain('"access_token_encrypted" text');
    expect(joined).toContain('"refresh_token_encrypted" text');
    expect(joined).toContain('"asset_token_encrypted" text');
    expect(joined).not.toMatch(/"(?:access|refresh|asset)_token"\s+text/);
  });

  it('hardcodes no provider in a constraint or default', async () => {
    const joined = await collectSql((queryRunner) =>
      new CreateSocialOrganicConnections1791500000000().up(queryRunner),
    );
    const constraintsAndDefaults = joined
      .split('\n')
      .filter((line) => /\b(?:constraint|check|default)\b/i.test(line))
      .join('\n');

    expect(constraintsAndDefaults).not.toMatch(
      /['"](?:meta|tiktok|youtube|linkedin|facebook|instagram|x)['"]/i,
    );
    expect(joined).not.toMatch(/CHECK\s*\([^)]*"(?:provider|asset_type)"/i);
  });

  it('drops assets before connections on the way down', async () => {
    const joined = await collectSql((queryRunner) =>
      new CreateSocialOrganicConnections1791500000000().down(queryRunner),
    );

    expect(joined).toContain('DROP TABLE IF EXISTS "social_organic_assets"');
    expect(joined).toContain(
      'DROP TABLE IF EXISTS "social_organic_connections"',
    );
    expect(joined.indexOf('social_organic_assets')).toBeLessThan(
      joined.indexOf('social_organic_connections'),
    );
  });
});

describe('social organic schema registration', () => {
  it('registers the migration in the agency datasource', () => {
    expect(AgencyDataSource.options.migrations).toContain(
      CreateSocialOrganicConnections1791500000000,
    );
  });

  it('registers both entities in the agency entity list', () => {
    expect(agencyEntities).toEqual(
      expect.arrayContaining([
        SocialOrganicConnectionEntity,
        SocialOrganicAssetEntity,
      ]),
    );
  });
});
