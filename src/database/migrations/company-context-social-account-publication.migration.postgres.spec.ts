import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { ScopeSocialOrganicAssetsByCompany1794700000000 } from './1794700000000-scope-social-organic-assets-by-company';
import { ScopeSocialAdConnectionsByCompany1794710000000 } from './1794710000000-scope-social-ad-connections-by-company';
import { ScopeSocialBoostTemplatesByCompany1794720000000 } from './1794720000000-scope-social-boost-templates-by-company';

const run = describePostgresIntegration();

run('CC2D social account and publication company scope migrations', () => {
  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
  });

  afterAll(async () => {
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  it('backfills only 1-company roots, rejects A/B parent mixing and runs up/down/up', async () => {
    const runner = AgencyDataSource.createQueryRunner();
    const schema = `cc2d_${process.pid}_${Date.now()}`;
    const organic = new ScopeSocialOrganicAssetsByCompany1794700000000();
    const ads = new ScopeSocialAdConnectionsByCompany1794710000000();
    const boosts = new ScopeSocialBoostTemplatesByCompany1794720000000();
    const tenantId = randomUUID();
    const workspaceId = randomUUID();
    const singleClientId = randomUUID();
    const zeroClientId = randomUUID();
    const multiClientId = randomUUID();
    const singleCompanyId = randomUUID();
    const companyAId = randomUUID();
    const companyBId = randomUUID();

    await runner.connect();
    await runner.startTransaction();

    try {
      await runner.query(`CREATE SCHEMA "${schema}"`);
      await runner.query(`SET LOCAL search_path TO "${schema}", public`);
      await createLegacySchema(runner);
      await runner.query(
        `INSERT INTO agency_client_company_contexts
          (id, tenant_id, workspace_id, agency_client_id)
         VALUES ($1,$4,$5,$6), ($2,$4,$5,$7), ($3,$4,$5,$7)`,
        [
          singleCompanyId,
          companyAId,
          companyBId,
          tenantId,
          workspaceId,
          singleClientId,
          multiClientId,
        ],
      );
      await seedLegacyRoots(runner, {
        tenantId,
        workspaceId,
        singleClientId,
        zeroClientId,
        multiClientId,
      });

      await organic.up(runner);
      await ads.up(runner);
      await boosts.up(runner);

      const backfilled = (await runner.query(
        `SELECT source, company_context_id
           FROM (
             SELECT 'asset' source, company_context_id
               FROM social_organic_assets WHERE id = $1
             UNION ALL
             SELECT 'ad', company_context_id
               FROM social_ad_account_connections WHERE id = $2
             UNION ALL
             SELECT 'template', company_context_id
               FROM social_boost_templates WHERE id = $3
           ) roots ORDER BY source`,
        [ROOT_ASSET, ROOT_AD_CONNECTION, ROOT_TEMPLATE],
      )) as Array<{ source: string; company_context_id: string | null }>;
      expect(backfilled).toHaveLength(3);
      expect(
        backfilled.every((row) => row.company_context_id === singleCompanyId),
      ).toBe(true);

      const ambiguous = (await runner.query(
        `SELECT company_context_id FROM social_organic_assets WHERE id IN ($1,$2)
         UNION ALL
         SELECT company_context_id FROM social_ad_account_connections WHERE id IN ($3,$4)
         UNION ALL
         SELECT company_context_id FROM social_boost_templates WHERE id IN ($5,$6)`,
        [ZERO_ASSET, MULTI_ASSET, ZERO_AD_CONNECTION, MULTI_AD_CONNECTION, ZERO_TEMPLATE, MULTI_TEMPLATE],
      )) as Array<{ company_context_id: string | null }>;
      expect(ambiguous).toHaveLength(6);
      expect(ambiguous.every((row) => row.company_context_id === null)).toBe(true);

      const organicConnectionId = randomUUID();
      const assetAId = randomUUID();
      const assetBId = randomUUID();
      const planAId = randomUUID();
      const planBId = randomUUID();
      const contentAId = randomUUID();
      const contentBId = randomUUID();
      const publicationAId = randomUUID();
      const adAId = randomUUID();
      const adBId = randomUUID();
      const templateAId = randomUUID();
      const templateBId = randomUUID();

      await runner.query(
        `INSERT INTO social_organic_connections (id) VALUES ($1)`,
        [organicConnectionId],
      );
      await runner.query(
        `INSERT INTO social_organic_assets
          (id, tenant_id, workspace_id, agency_client_id, company_context_id,
           connection_id, provider, external_asset_id)
         VALUES ($1,$3,$4,$5,$6,$7,'meta','page-a'),
                ($2,$3,$4,$5,$8,$7,'meta','page-b')`,
        [
          assetAId,
          assetBId,
          tenantId,
          workspaceId,
          multiClientId,
          companyAId,
          organicConnectionId,
          companyBId,
        ],
      );
      await runner.query(
        `INSERT INTO social_plans
          (id, tenant_id, workspace_id, agency_client_id, company_context_id)
         VALUES ($1,$3,$4,$5,$6), ($2,$3,$4,$5,$7)`,
        [planAId, planBId, tenantId, workspaceId, multiClientId, companyAId, companyBId],
      );
      await runner.query(
        `INSERT INTO social_content_items (id, plan_id) VALUES ($1,$3), ($2,$4)`,
        [contentAId, contentBId, planAId, planBId],
      );

      await runner.query(
        `INSERT INTO social_publications
          (id, tenant_id, workspace_id, agency_client_id, content_item_id,
           provider, connection_id, asset_id, external_asset_id)
         VALUES ($1,$2,$3,$4,$5,'meta',$6,$7,'page-a')`,
        [publicationAId, tenantId, workspaceId, multiClientId, contentAId, organicConnectionId, assetAId],
      );
      await expectViolation(runner, () =>
        runner.query(
          `INSERT INTO social_publications
            (id, tenant_id, workspace_id, agency_client_id, content_item_id,
             provider, connection_id, asset_id, external_asset_id)
           VALUES ($1,$2,$3,$4,$5,'meta',$6,$7,'page-b')`,
          [randomUUID(), tenantId, workspaceId, multiClientId, contentAId, organicConnectionId, assetBId],
        ),
      );

      await runner.query(
        `INSERT INTO social_ad_account_connections
          (id, tenant_id, workspace_id, agency_client_id, company_context_id,
           provider, external_account_id)
         VALUES ($1,$3,$4,$5,$6,'meta_ads','act_shared'),
                ($2,$3,$4,$5,$7,'meta_ads','act_shared')`,
        [adAId, adBId, tenantId, workspaceId, multiClientId, companyAId, companyBId],
      );
      await runner.query(
        `INSERT INTO social_boost_templates
          (id, tenant_id, workspace_id, agency_client_id, company_context_id,
           provider, name, is_default)
         VALUES ($1,$3,$4,$5,$6,'meta_ads','A',false),
                ($2,$3,$4,$5,$7,'meta_ads','B',false)`,
        [templateAId, templateBId, tenantId, workspaceId, multiClientId, companyAId, companyBId],
      );
      await runner.query(
        `INSERT INTO social_boost_requests
          (id, tenant_id, workspace_id, agency_client_id, connection_id,
           publication_id, content_item_id, boost_template_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [randomUUID(), tenantId, workspaceId, multiClientId, adAId, publicationAId, contentAId, templateAId],
      );
      await expectViolation(runner, () =>
        runner.query(
          `INSERT INTO social_boost_requests
            (id, tenant_id, workspace_id, agency_client_id, connection_id,
             publication_id, content_item_id, boost_template_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [randomUUID(), tenantId, workspaceId, multiClientId, adBId, publicationAId, contentAId, templateAId],
        ),
      );

      // The legacy workspace-wide unique index would reject this pair. CC2D
      // allows the same provider account once per explicit company context.
      const companyAdCount = (await runner.query(
        `SELECT count(*)::int AS count
           FROM social_ad_account_connections
          WHERE external_account_id = 'act_shared'`,
      )) as Array<{ count: number }>;
      expect(companyAdCount[0]?.count).toBe(2);

      await expectViolation(runner, () =>
        runner.query(
          `INSERT INTO social_boost_templates
            (id, tenant_id, workspace_id, agency_client_id, company_context_id,
             provider, name, is_default)
           VALUES ($1,$2,$3,$4,$5,'meta_ads','A',false)`,
          [randomUUID(), tenantId, workspaceId, multiClientId, companyAId],
        ),
      );

      // Rollback restores the pre-CC2D workspace-wide unique index, so remove
      // only the second fixture that exists to prove company-scoped reuse.
      await runner.query(`DELETE FROM social_ad_account_connections WHERE id = $1`, [
        adBId,
      ]);
      await boosts.down(runner);
      await ads.down(runner);
      await organic.down(runner);
      const afterDown = (await runner.query(
        `SELECT count(*)::int AS count
           FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name IN (
              'social_organic_assets', 'social_ad_account_connections',
              'social_boost_templates'
            )
            AND column_name = 'company_context_id'`,
      )) as Array<{ count: number }>;
      expect(afterDown[0]?.count).toBe(0);

      await organic.up(runner);
      await ads.up(runner);
      await boosts.up(runner);
      const afterSecondUp = (await runner.query(
        `SELECT count(*)::int AS count
           FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name IN (
              'social_organic_assets', 'social_ad_account_connections',
              'social_boost_templates'
            )
            AND column_name = 'company_context_id'`,
      )) as Array<{ count: number }>;
      expect(afterSecondUp[0]?.count).toBe(3);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });
});

const ROOT_ASSET = '00000000-0000-4000-8000-000000000001';
const ZERO_ASSET = '00000000-0000-4000-8000-000000000002';
const MULTI_ASSET = '00000000-0000-4000-8000-000000000003';
const ROOT_AD_CONNECTION = '00000000-0000-4000-8000-000000000011';
const ZERO_AD_CONNECTION = '00000000-0000-4000-8000-000000000012';
const MULTI_AD_CONNECTION = '00000000-0000-4000-8000-000000000013';
const ROOT_TEMPLATE = '00000000-0000-4000-8000-000000000021';
const ZERO_TEMPLATE = '00000000-0000-4000-8000-000000000022';
const MULTI_TEMPLATE = '00000000-0000-4000-8000-000000000023';

async function createLegacySchema(runner: QueryRunner) {
  await runner.query(`
    CREATE TABLE agency_client_company_contexts (
      id uuid PRIMARY KEY,
      tenant_id uuid NOT NULL,
      workspace_id uuid NOT NULL,
      agency_client_id uuid NOT NULL,
      UNIQUE (id, tenant_id, workspace_id, agency_client_id)
    );
    CREATE TABLE social_organic_connections (id uuid PRIMARY KEY);
    CREATE TABLE social_organic_assets (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
      agency_client_id uuid, connection_id uuid NOT NULL, provider varchar NOT NULL,
      external_asset_id varchar NOT NULL
    );
    CREATE INDEX "IDX_social_organic_assets_context"
      ON social_organic_assets (tenant_id, workspace_id, agency_client_id);
    CREATE TABLE social_ad_account_connections (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
      agency_client_id uuid, provider varchar, external_account_id varchar
    );
    CREATE INDEX "IDX_social_ad_account_connections_context"
      ON social_ad_account_connections (tenant_id, workspace_id, agency_client_id);
    CREATE UNIQUE INDEX "UQ_social_ad_account_connections_account"
      ON social_ad_account_connections (tenant_id, workspace_id, provider, external_account_id);
    CREATE TABLE social_boost_templates (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
      agency_client_id uuid, provider varchar NOT NULL, name varchar NOT NULL,
      is_default boolean NOT NULL DEFAULT false
    );
    CREATE INDEX "IDX_social_boost_templates_scope"
      ON social_boost_templates (tenant_id, workspace_id, agency_client_id, provider);
    CREATE UNIQUE INDEX "UQ_social_boost_templates_client_name"
      ON social_boost_templates (tenant_id, workspace_id, agency_client_id, lower(name))
      WHERE agency_client_id IS NOT NULL;
    CREATE UNIQUE INDEX "UQ_social_boost_templates_client_default"
      ON social_boost_templates (tenant_id, workspace_id, agency_client_id, provider)
      WHERE agency_client_id IS NOT NULL AND is_default = true;
    CREATE TABLE social_plans (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
      agency_client_id uuid, company_context_id uuid
    );
    CREATE TABLE social_content_items (id uuid PRIMARY KEY, plan_id uuid NOT NULL);
    CREATE TABLE social_content_destinations (id uuid PRIMARY KEY, content_item_id uuid NOT NULL);
    CREATE TABLE social_publications (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
      agency_client_id uuid, content_item_id uuid NOT NULL, destination_id uuid,
      provider varchar NOT NULL, connection_id uuid NOT NULL, asset_id uuid NOT NULL,
      external_asset_id varchar NOT NULL
    );
    CREATE TABLE social_boost_requests (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
      agency_client_id uuid, connection_id uuid NOT NULL, publication_id uuid NOT NULL,
      content_item_id uuid NOT NULL, boost_template_id uuid NOT NULL
    );
  `);
}

async function seedLegacyRoots(
  runner: QueryRunner,
  scope: {
    tenantId: string;
    workspaceId: string;
    singleClientId: string;
    zeroClientId: string;
    multiClientId: string;
  },
) {
  await runner.query(
    `INSERT INTO social_organic_connections (id) VALUES
      ('00000000-0000-4000-8000-000000000101')`,
  );
  await runner.query(
    `INSERT INTO social_organic_assets
      (id, tenant_id, workspace_id, agency_client_id, connection_id, provider, external_asset_id)
     VALUES ($4,$1,$2,$3,'00000000-0000-4000-8000-000000000101','meta','single'),
            ($5,$1,$2,$6,'00000000-0000-4000-8000-000000000101','meta','zero'),
            ($7,$1,$2,$8,'00000000-0000-4000-8000-000000000101','meta','multi')`,
    [
      scope.tenantId,
      scope.workspaceId,
      scope.singleClientId,
      ROOT_ASSET,
      ZERO_ASSET,
      scope.zeroClientId,
      MULTI_ASSET,
      scope.multiClientId,
    ],
  );
  await runner.query(
    `INSERT INTO social_ad_account_connections
      (id, tenant_id, workspace_id, agency_client_id)
     VALUES ($4,$1,$2,$3), ($5,$1,$2,$6), ($7,$1,$2,$8)`,
    [
      scope.tenantId,
      scope.workspaceId,
      scope.singleClientId,
      ROOT_AD_CONNECTION,
      ZERO_AD_CONNECTION,
      scope.zeroClientId,
      MULTI_AD_CONNECTION,
      scope.multiClientId,
    ],
  );
  await runner.query(
    `INSERT INTO social_boost_templates
      (id, tenant_id, workspace_id, agency_client_id, provider, name, is_default)
     VALUES ($4,$1,$2,$3,'meta_ads','single',false),
            ($5,$1,$2,$6,'meta_ads','zero',false),
            ($7,$1,$2,$8,'meta_ads','multi',false)`,
    [
      scope.tenantId,
      scope.workspaceId,
      scope.singleClientId,
      ROOT_TEMPLATE,
      ZERO_TEMPLATE,
      scope.zeroClientId,
      MULTI_TEMPLATE,
      scope.multiClientId,
    ],
  );
}

async function expectViolation(
  runner: QueryRunner,
  operation: () => Promise<unknown>,
) {
  const savepoint = `cc2d_${randomUUID().replaceAll('-', '')}`;
  await runner.query(`SAVEPOINT ${savepoint}`);
  let rejected = false;
  try {
    await operation();
  } catch {
    rejected = true;
  } finally {
    await runner.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await runner.query(`RELEASE SAVEPOINT ${savepoint}`);
  }
  expect(rejected).toBe(true);
}
