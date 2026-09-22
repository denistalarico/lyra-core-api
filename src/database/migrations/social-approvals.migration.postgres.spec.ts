import { randomUUID } from 'crypto';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { CreateSocialApprovals1795100000000 } from './1795100000000-create-social-approvals';

const run = describePostgresIntegration();

run('AP1 approvals migration against PostgreSQL', () => {
  beforeAll(async () => { if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize(); });
  afterAll(async () => { if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy(); });

  it('runs up/down/up and enforces company scope, active uniqueness, actors, and append-only history', async () => {
    const migration = new CreateSocialApprovals1795100000000();
    const runner = AgencyDataSource.createQueryRunner();
    await runner.connect(); await runner.startTransaction();
    const tenant = randomUUID(), workspace = randomUUID(), client = randomUUID(), otherClient = randomUUID();
    const contactA = randomUUID(), contactB = randomUUID(), contactOtherClient = randomUUID();
    const companyA = randomUUID(), companyB = randomUUID(), actor = randomUUID();
    const asset = randomUUID(), revision = randomUUID();
    const reject = async (operation: () => Promise<unknown>) => {
      await runner.query('SAVEPOINT expected_failure');
      await expect(operation()).rejects.toThrow();
      await runner.query('ROLLBACK TO SAVEPOINT expected_failure');
    };
    const insertRequest = (id: string, overrides: Partial<{ tenant: string; workspace: string; client: string; company: string; status: string; revision: string }> = {}) => runner.query(
      `INSERT INTO social_approval_requests (id,tenant_id,workspace_id,agency_client_id,company_context_id,subject_type,subject_id,subject_revision_id,source_module,display_type,title,subject_version_label,status,current_stage,requested_by_user_id)
       VALUES ($1,$2,$3,$4,$5,'creative_version',$6,$7,'creative_studio','creative','Peça','v1',$8,'internal',$9)`,
      [id, overrides.tenant ?? tenant, overrides.workspace ?? workspace, overrides.client ?? client, overrides.company ?? companyA, asset, overrides.revision ?? revision, overrides.status ?? 'draft', actor],
    );
    try {
      await migration.down(runner); await migration.up(runner); await migration.down(runner); await migration.up(runner);
      await runner.query(
        `INSERT INTO contacts (id,tenant_id,workspace_id,type,display_name) VALUES
         ($1,$2,$3,'organization','Empresa A'),($4,$2,$3,'organization','Empresa B'),($5,$2,$3,'organization','Outra conta')`,
        [contactA, tenant, workspace, contactB, contactOtherClient],
      );
      await runner.query(
        `INSERT INTO agency_clients (id,tenant_id,workspace_id,contact_id,display_name) VALUES
         ($1,$2,$3,$4,'Conta'),($5,$2,$3,$6,'Outra conta')`,
        [client, tenant, workspace, contactA, otherClient, contactOtherClient],
      );
      await runner.query(
        `INSERT INTO agency_client_company_contexts (id,tenant_id,workspace_id,agency_client_id,company_contact_id,status,is_primary) VALUES
         ($1,$2,$3,$4,$5,'active',true),($6,$2,$3,$4,$7,'active',false)`,
        [companyA, tenant, workspace, client, contactA, companyB, contactB],
      );

      const approvalA = randomUUID(); await insertRequest(approvalA);
      await reject(() => insertRequest(randomUUID()));
      const clientRevision = randomUUID();
      await insertRequest(randomUUID(), { revision: clientRevision, status: 'awaiting_client' });
      await reject(() => insertRequest(randomUUID(), { revision: clientRevision, status: 'changes_requested' }));
      const terminalRevision = randomUUID();
      await insertRequest(randomUUID(), { revision: terminalRevision, status: 'approved' });
      await insertRequest(randomUUID(), { revision: terminalRevision, status: 'draft' });
      await insertRequest(randomUUID(), { company: companyB });
      await reject(() => insertRequest(randomUUID(), { client: otherClient }));
      await reject(() => insertRequest(randomUUID(), { tenant: randomUUID() }));
      await reject(() => insertRequest(randomUUID(), { workspace: randomUUID() }));

      const activeIndex = await runner.query(
        `SELECT indexdef FROM pg_indexes WHERE indexname = 'UQ_social_approval_requests_active_revision'`,
      ) as Array<{ indexdef: string }>;
      expect(activeIndex[0].indexdef).toContain("'awaiting_client'");
      expect(activeIndex[0].indexdef).toContain("'changes_requested'");

      await reject(() => runner.query(
        `INSERT INTO social_approval_comments (approval_request_id,actor_type,actor_user_id,body) VALUES ($1,'user',NULL,'texto')`, [approvalA],
      ));
      await reject(() => runner.query(
        `INSERT INTO social_approval_comments (approval_request_id,actor_type,actor_user_id,body) VALUES ($1,'system',$2,'texto')`, [approvalA, actor],
      ));
      await reject(() => runner.query(
        `INSERT INTO social_approval_comments (approval_request_id,actor_type,actor_user_id,body) VALUES ($1,'user',$2,'   ')`, [approvalA, actor],
      ));
      const [comment] = await runner.query(
        `INSERT INTO social_approval_comments (approval_request_id,actor_type,actor_user_id,body) VALUES ($1,'user',$2,'Ajustar') RETURNING id`, [approvalA, actor],
      );
      await reject(() => runner.query(
        `INSERT INTO social_approval_stage_decisions (approval_request_id,stage,decision,actor_type,actor_user_id,comment_id) VALUES ($1,'internal','changes_requested','user',NULL,$2)`, [approvalA, comment.id],
      ));
      await reject(() => runner.query(
        `INSERT INTO social_approval_stage_decisions (approval_request_id,stage,decision,actor_type,actor_user_id,comment_id) VALUES ($1,'internal','changes_requested','system',$2,$3)`, [approvalA, actor, comment.id],
      ));
      const [decision] = await runner.query(
        `INSERT INTO social_approval_stage_decisions (approval_request_id,stage,decision,actor_type,actor_user_id,comment_id) VALUES ($1,'internal','changes_requested','user',$2,$3) RETURNING id`, [approvalA, actor, comment.id],
      );
      await reject(() => runner.query(`UPDATE social_approval_comments SET body = 'editado' WHERE id = $1`, [comment.id]));
      await reject(() => runner.query(`DELETE FROM social_approval_comments WHERE id = $1`, [comment.id]));
      await reject(() => runner.query(`UPDATE social_approval_stage_decisions SET decision = 'approved' WHERE id = $1`, [decision.id]));
      await reject(() => runner.query(`DELETE FROM social_approval_stage_decisions WHERE id = $1`, [decision.id]));
    } finally {
      await runner.rollbackTransaction(); await runner.release();
    }
  });
});
