import { randomUUID } from 'node:crypto';
import { IsNull, type QueryRunner } from 'typeorm';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import { describePostgresIntegration } from '../../../testing/postgres-integration';
import { SocialAdAccountConnectionEntity } from '../entities/social-ad-account-connection.entity';

/**
 * The projection rule both credential resolvers depend on, pinned against the
 * real driver.
 *
 * On 2026-09-22 every paid and organic sync in production stopped with
 * `connection_not_found` / `asset_not_found` while the rows were present,
 * connected and in scope. The cause was not the scope and not the provider:
 * TypeORM 0.3.28 hydrates `findOne` to **null** when every column named in
 * `select` is NULL in the matched row, which makes "this connection does not
 * exist" and "this connection exists and has no Company Context" the same
 * answer. `company_context_id` is NULL for every agency-owned account, so the
 * projection `select: ['companyContextId']` introduced with Company Context
 * scoping erased exactly the accounts it was meant to scope.
 *
 * A mocked repository cannot see this — the mock returns whatever row the spec
 * hands it and never reads `select` — so the guarantee is only real against
 * PostgreSQL. The fix is to always include the primary key, which is never
 * null; these assertions fail if someone narrows either projection again.
 */
const run = describePostgresIntegration();

run('Credential projections against PostgreSQL', () => {
  let queryRunner: QueryRunner;

  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  const connectionId = randomUUID();

  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
  });

  afterAll(async () => {
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  beforeEach(async () => {
    queryRunner = AgencyDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    // The shape that broke: an agency-owned connection, so both
    // `agency_client_id` and `company_context_id` are NULL.
    await queryRunner.query(`
      INSERT INTO "social_ad_account_connections"
        ("id", "tenant_id", "workspace_id", "agency_client_id",
         "company_context_id", "provider", "authorization_method",
         "external_account_id", "timezone", "connection_status")
      VALUES (
        '${connectionId}', '${tenantId}', '${workspaceId}', NULL,
        NULL, 'meta_ads', 'business_login',
        'act_1', 'America/Sao_Paulo', 'connected'
      )
    `);
  });

  afterEach(async () => {
    await queryRunner.rollbackTransaction();
    await queryRunner.release();
  });

  function findWith(select: Array<keyof SocialAdAccountConnectionEntity>) {
    return queryRunner.manager.findOne(SocialAdAccountConnectionEntity, {
      where: {
        id: connectionId,
        tenantId,
        workspaceId,
        agencyClientId: IsNull(),
      },
      select,
    });
  }

  it('finds an agency-owned connection when the projection includes the key', () => {
    return expect(findWith(['id', 'companyContextId'])).resolves.toMatchObject({
      id: connectionId,
      companyContextId: null,
    });
  });

  it('loses the row when the projection is only the null context column', async () => {
    // Documents the driver behaviour this guard exists for. If a future
    // TypeORM stops collapsing all-null projections this will fail, and the
    // `id` in both resolvers becomes redundant rather than load-bearing.
    await expect(findWith(['companyContextId'])).resolves.toBeNull();
  });
});
