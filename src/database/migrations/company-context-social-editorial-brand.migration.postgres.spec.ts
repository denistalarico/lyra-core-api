import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { ScopeSocialEditorialByCompany1794500000000 } from './1794500000000-scope-social-editorial-by-company';
import { ScopeBrandKitByCompany1794510000000 } from './1794510000000-scope-brand-kit-by-company';
import { ScopeCreativeStudioByCompany1794520000000 } from './1794520000000-scope-creative-studio-by-company';

const run = describePostgresIntegration();

run('CC2C social editorial and brand company scope migrations', () => {
  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
  });

  afterAll(async () => {
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  it('backfills only unambiguous roots, enforces inherited scope and runs up/down/up', async () => {
    const runner = AgencyDataSource.createQueryRunner();
    const schema = `cc2c_${process.pid}_${Date.now()}`;
    const planner = new ScopeSocialEditorialByCompany1794500000000();
    const brand = new ScopeBrandKitByCompany1794510000000();
    const creative = new ScopeCreativeStudioByCompany1794520000000();
    const tenantId = randomUUID();
    const workspaceId = randomUUID();
    const singleClientId = randomUUID();
    const emptyClientId = randomUUID();
    const multiClientId = randomUUID();
    const singleCompanyId = randomUUID();
    const multiCompanyAId = randomUUID();
    const multiCompanyBId = randomUUID();

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
          multiCompanyAId,
          multiCompanyBId,
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
        emptyClientId,
        multiClientId,
      });

      await planner.up(runner);
      await brand.up(runner);
      await creative.up(runner);

      const rootBackfill = (await runner.query(
        `SELECT table_name, company_context_id
         FROM (
           SELECT 'social_plans' AS table_name, company_context_id
             FROM social_plans WHERE id = '00000000-0000-4000-8000-000000000001'
           UNION ALL SELECT 'social_campaign_templates', company_context_id
             FROM social_campaign_templates
           UNION ALL SELECT 'social_campaign_instances', company_context_id
             FROM social_campaign_instances
           UNION ALL SELECT 'social_content_ideas', company_context_id
             FROM social_content_ideas
           UNION ALL SELECT 'social_planner_settings', company_context_id
             FROM social_planner_settings
           UNION ALL SELECT 'social_editorial_pillars', company_context_id
             FROM social_editorial_pillars
           UNION ALL SELECT 'social_publishing_cadences', company_context_id
             FROM social_publishing_cadences
           UNION ALL SELECT 'brand_kits', company_context_id FROM brand_kits
             WHERE id = '00000000-0000-4000-8000-000000000101'
           UNION ALL SELECT 'social_creative_folders', company_context_id
             FROM social_creative_folders
             WHERE id = '00000000-0000-4000-8000-000000000201'
           UNION ALL SELECT 'social_creative_assets', company_context_id
             FROM social_creative_assets
             WHERE id = '00000000-0000-4000-8000-000000000301'
         ) roots ORDER BY table_name`,
      )) as Array<{ table_name: string; company_context_id: string | null }>;
      expect(rootBackfill).toHaveLength(10);
      expect(
        rootBackfill.every((row) => row.company_context_id === singleCompanyId),
      ).toBe(true);

      const legacyDisposition = (await runner.query(
        `SELECT id, agency_client_id, company_context_id
         FROM social_plans
         WHERE id IN (
           '00000000-0000-4000-8000-000000000002',
           '00000000-0000-4000-8000-000000000003',
           '00000000-0000-4000-8000-000000000004'
         ) ORDER BY id`,
      )) as Array<{
        id: string;
        agency_client_id: string | null;
        company_context_id: string | null;
      }>;
      expect(legacyDisposition).toEqual([
        expect.objectContaining({
          agency_client_id: emptyClientId,
          company_context_id: null,
        }),
        expect.objectContaining({
          agency_client_id: multiClientId,
          company_context_id: null,
        }),
        expect.objectContaining({
          agency_client_id: null,
          company_context_id: null,
        }),
      ]);

      await expectViolation(runner, () =>
        runner.query(
          `INSERT INTO social_plans
            (id, tenant_id, workspace_id, agency_client_id, company_context_id,
             period_start, period_end)
           VALUES ($1,$2,$3,$4,$5,'2026-10-01','2026-10-31')`,
          [
            randomUUID(),
            tenantId,
            workspaceId,
            singleClientId,
            multiCompanyAId,
          ],
        ),
      );

      const multiKitAId = randomUUID();
      const multiKitBId = randomUUID();
      await runner.query(
        `INSERT INTO brand_kits
          (id, tenant_id, workspace_id, agency_client_id, company_context_id)
         VALUES ($1,$3,$4,$5,$6), ($2,$3,$4,$5,$7)`,
        [
          multiKitAId,
          multiKitBId,
          tenantId,
          workspaceId,
          multiClientId,
          multiCompanyAId,
          multiCompanyBId,
        ],
      );
      await expectViolation(runner, () =>
        runner.query(
          `INSERT INTO brand_kits
            (id, tenant_id, workspace_id, agency_client_id, company_context_id)
           VALUES ($1,$2,$3,$4,$5)`,
          [randomUUID(), tenantId, workspaceId, multiClientId, multiCompanyAId],
        ),
      );
      await expectViolation(runner, () =>
        runner.query(
          `INSERT INTO social_plans
            (id, tenant_id, workspace_id, agency_client_id, company_context_id,
             period_start, period_end)
           VALUES ($1,$2,$3,$4,$5,'2026-10-01','2026-10-31')`,
          [
            randomUUID(),
            randomUUID(),
            workspaceId,
            singleClientId,
            singleCompanyId,
          ],
        ),
      );
      await expectViolation(runner, () =>
        runner.query(
          `INSERT INTO social_plans
            (id, tenant_id, workspace_id, agency_client_id, company_context_id,
             period_start, period_end)
           VALUES ($1,$2,$3,$4,$5,'2026-10-01','2026-10-31')`,
          [
            randomUUID(),
            tenantId,
            randomUUID(),
            singleClientId,
            singleCompanyId,
          ],
        ),
      );
      await expectViolation(runner, () =>
        runner.query(
          `INSERT INTO brand_kit_assets
            (id, brand_kit_id, tenant_id, workspace_id, agency_client_id)
           VALUES ($1,'00000000-0000-4000-8000-000000000101',$2,$3,$4)`,
          [randomUUID(), tenantId, workspaceId, multiClientId],
        ),
      );

      const companyAPlanId = randomUUID();
      const companyBPlanId = randomUUID();
      const companyBContentId = randomUUID();
      const companyAFolderId = randomUUID();
      const companyBFolderId = randomUUID();
      await runner.query(
        `INSERT INTO social_plans
          (id, tenant_id, workspace_id, agency_client_id, company_context_id,
           period_start, period_end)
         VALUES ($1,$3,$4,$5,$6,'2026-11-01','2026-11-30'),
                ($2,$3,$4,$5,$7,'2026-12-01','2026-12-31')`,
        [
          companyAPlanId,
          companyBPlanId,
          tenantId,
          workspaceId,
          multiClientId,
          multiCompanyAId,
          multiCompanyBId,
        ],
      );
      await runner.query(
        `INSERT INTO social_content_items (id, plan_id) VALUES ($1,$2)`,
        [companyBContentId, companyBPlanId],
      );
      await runner.query(
        `INSERT INTO social_creative_folders
          (id, tenant_id, workspace_id, agency_client_id, company_context_id)
         VALUES ($1,$3,$4,$5,$6), ($2,$3,$4,$5,$7)`,
        [
          companyAFolderId,
          companyBFolderId,
          tenantId,
          workspaceId,
          multiClientId,
          multiCompanyAId,
          multiCompanyBId,
        ],
      );
      await expectViolation(runner, () =>
        runner.query(
          `UPDATE social_creative_folders SET parent_id=$1 WHERE id=$2`,
          [companyBFolderId, companyAFolderId],
        ),
      );
      await expectViolation(runner, () =>
        runner.query(
          `INSERT INTO social_creative_assets
            (id, tenant_id, workspace_id, agency_client_id, company_context_id,
             content_item_id, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,now())`,
          [
            randomUUID(),
            tenantId,
            workspaceId,
            multiClientId,
            multiCompanyAId,
            companyBContentId,
          ],
        ),
      );

      const untouched = (await runner.query(
        `SELECT table_name, count(*)::int AS company_columns
         FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name IN ('media_assets', 'social_creative_asset_versions')
           AND column_name = 'company_context_id'
         GROUP BY table_name`,
      )) as Array<{ table_name: string; company_columns: number }>;
      expect(untouched).toEqual([]);

      const indexes = (await runner.query(
        `SELECT indexname, indexdef
         FROM pg_indexes
         WHERE schemaname = current_schema()
           AND indexname IN (
             'IDX_social_plans_scope',
             'UQ_brand_kits_company_scope',
             'IDX_social_creative_assets_scope_created'
           ) ORDER BY indexname`,
      )) as Array<{ indexname: string; indexdef: string }>;
      expect(indexes).toHaveLength(3);
      expect(
        indexes.every((index) => index.indexdef.includes('company_context_id')),
      ).toBe(true);

      // The pre-CC2C client-wide unique index cannot coexist with the two
      // company rows above during rollback, so remove only this test fixture.
      await runner.query(`DELETE FROM brand_kits WHERE id IN ($1,$2)`, [
        multiKitAId,
        multiKitBId,
      ]);

      await creative.down(runner);
      await brand.down(runner);
      await planner.down(runner);
      const afterDown = (await runner.query(
        `SELECT count(*)::int AS count
         FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND column_name = 'company_context_id'`,
      )) as Array<{ count: number }>;
      expect(afterDown[0]?.count).toBe(0);

      await planner.up(runner);
      await brand.up(runner);
      await creative.up(runner);
      const afterSecondUp = (await runner.query(
        `SELECT count(*)::int AS count
         FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND column_name = 'company_context_id'`,
      )) as Array<{ count: number }>;
      expect(afterSecondUp[0]?.count).toBe(10);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });
});

async function createLegacySchema(runner: QueryRunner) {
  await runner.query(`
    CREATE TABLE agency_client_company_contexts (
      id uuid PRIMARY KEY,
      tenant_id uuid NOT NULL,
      workspace_id uuid NOT NULL,
      agency_client_id uuid NOT NULL
    );
    CREATE TABLE social_plans (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
      agency_client_id uuid, period_start date, period_end date
    );
    CREATE TABLE social_campaign_templates (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
      agency_client_id uuid, name varchar NOT NULL
    );
    CREATE TABLE social_campaign_instances (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
      agency_client_id uuid, name varchar NOT NULL, starts_on date, ends_on date
    );
    CREATE TABLE social_content_ideas (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
      agency_client_id uuid, status varchar, priority integer
    );
    CREATE TABLE social_planner_settings (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
      agency_client_id uuid
    );
    CREATE TABLE social_editorial_pillars (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
      agency_client_id uuid, key varchar NOT NULL
    );
    CREATE TABLE social_publishing_cadences (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
      agency_client_id uuid
    );
    CREATE TABLE brand_kits (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
      agency_client_id uuid
    );
    CREATE TABLE brand_kit_assets (
      id uuid PRIMARY KEY, brand_kit_id uuid NOT NULL, tenant_id uuid NOT NULL,
      workspace_id uuid NOT NULL, agency_client_id uuid
    );
    CREATE TABLE social_content_items (id uuid PRIMARY KEY, plan_id uuid NOT NULL);
    CREATE TABLE social_creative_folders (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
      agency_client_id uuid, parent_id uuid
    );
    CREATE TABLE social_creative_assets (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
      agency_client_id uuid, folder_id uuid, content_item_id uuid, created_at timestamptz
    );
    CREATE TABLE media_assets (id uuid PRIMARY KEY);
    CREATE TABLE social_creative_asset_versions (id uuid PRIMARY KEY);
  `);
}

async function seedLegacyRoots(
  runner: QueryRunner,
  scope: {
    tenantId: string;
    workspaceId: string;
    singleClientId: string;
    emptyClientId: string;
    multiClientId: string;
  },
) {
  const params = [scope.tenantId, scope.workspaceId, scope.singleClientId];
  await runner.query(
    `INSERT INTO social_plans
      (id, tenant_id, workspace_id, agency_client_id, period_start, period_end)
     VALUES
      ('00000000-0000-4000-8000-000000000001',$1,$2,$3,'2026-09-01','2026-09-30'),
      ('00000000-0000-4000-8000-000000000002',$1,$2,$4,'2026-09-01','2026-09-30'),
      ('00000000-0000-4000-8000-000000000003',$1,$2,$5,'2026-09-01','2026-09-30'),
      ('00000000-0000-4000-8000-000000000004',$1,$2,NULL,'2026-09-01','2026-09-30')`,
    [...params, scope.emptyClientId, scope.multiClientId],
  );
  await runner.query(
    `INSERT INTO social_campaign_templates VALUES
      ('00000000-0000-4000-8000-000000000011',$1,$2,$3,'template')`,
    params,
  );
  await runner.query(
    `INSERT INTO social_campaign_instances VALUES
      ('00000000-0000-4000-8000-000000000021',$1,$2,$3,'campaign',NULL,NULL)`,
    params,
  );
  await runner.query(
    `INSERT INTO social_content_ideas VALUES
      ('00000000-0000-4000-8000-000000000031',$1,$2,$3,'backlog',1)`,
    params,
  );
  await runner.query(
    `INSERT INTO social_planner_settings VALUES
      ('00000000-0000-4000-8000-000000000041',$1,$2,$3)`,
    params,
  );
  await runner.query(
    `INSERT INTO social_editorial_pillars VALUES
      ('00000000-0000-4000-8000-000000000051',$1,$2,$3,'pillar')`,
    params,
  );
  await runner.query(
    `INSERT INTO social_publishing_cadences VALUES
      ('00000000-0000-4000-8000-000000000061',$1,$2,$3)`,
    params,
  );
  await runner.query(
    `INSERT INTO brand_kits VALUES
      ('00000000-0000-4000-8000-000000000101',$1,$2,$3)`,
    params,
  );
  await runner.query(
    `INSERT INTO social_creative_folders VALUES
      ('00000000-0000-4000-8000-000000000201',$1,$2,$3,NULL)`,
    params,
  );
  await runner.query(
    `INSERT INTO social_creative_assets VALUES
      ('00000000-0000-4000-8000-000000000301',$1,$2,$3,NULL,NULL,now())`,
    params,
  );
}

async function expectViolation(
  runner: QueryRunner,
  operation: () => Promise<unknown>,
) {
  const savepoint = `cc2c_${randomUUID().replaceAll('-', '')}`;
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
