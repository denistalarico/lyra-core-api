import { randomUUID } from 'crypto';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { CreateClientAreaMemberships1797000000000 } from './1797000000000-create-client-area-memberships';
import { CreateClientAreaInvitations1797100000000 } from './1797100000000-create-client-area-invitations';
import { CreateClientAreaCrmIdentityRelationships1797300000000 } from './1797300000000-create-client-area-crm-identity-relationships';

const run = describePostgresIntegration();

run('CA4 CRM identity relationships migration against PostgreSQL', () => {
  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
  });
  afterAll(async () => {
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  it('runs up/down/up and rejects non-person, cross-workspace and duplicate active links', async () => {
    const memberships = new CreateClientAreaMemberships1797000000000();
    const invitations = new CreateClientAreaInvitations1797100000000();
    const migration =
      new CreateClientAreaCrmIdentityRelationships1797300000000();
    const runner = AgencyDataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    const tenant = randomUUID();
    const workspace = randomUUID();
    const otherWorkspace = randomUUID();
    const person = randomUUID();
    const organization = randomUUID();
    const crossWorkspacePerson = randomUUID();
    const user = randomUUID();
    const otherUser = randomUUID();
    const reject = async (work: () => Promise<unknown>) => {
      await runner.query('SAVEPOINT expected_failure');
      await expect(work()).rejects.toThrow();
      await runner.query('ROLLBACK TO SAVEPOINT expected_failure');
    };

    try {
      await memberships.up(runner);
      await invitations.up(runner);
      await migration.up(runner);
      await migration.down(runner);
      await migration.up(runner);
      await migration.up(runner);

      await runner.query(
        `INSERT INTO contacts (id,tenant_id,workspace_id,type,display_name) VALUES
         ($1,$4,$5,'person','Pessoa CRM'), ($2,$4,$5,'organization','Organização CRM'),
         ($3,$4,$6,'person','Pessoa de outro workspace')`,
        [
          person,
          organization,
          crossWorkspacePerson,
          tenant,
          workspace,
          otherWorkspace,
        ],
      );
      await runner.query(
        `INSERT INTO user_security_settings (tenant_id,user_id,current_email) VALUES
         ($1,$2,'pessoa@example.test'),($1,$3,'other@example.test')`,
        [tenant, user, otherUser],
      );

      await runner.query(
        `INSERT INTO client_area_identity_contacts (tenant_id,workspace_id,user_id,contact_id)
         VALUES ($1,$2,$3,$4)`,
        [tenant, workspace, user, person],
      );
      await reject(() =>
        runner.query(
          `INSERT INTO client_area_identity_contacts (tenant_id,workspace_id,user_id,contact_id)
           VALUES ($1,$2,$3,$4)`,
          [tenant, workspace, otherUser, person],
        ),
      );
      await reject(() =>
        runner.query(
          `INSERT INTO client_area_identity_contacts (tenant_id,workspace_id,user_id,contact_id)
           VALUES ($1,$2,$3,$4)`,
          [tenant, workspace, otherUser, organization],
        ),
      );
      await reject(() =>
        runner.query(
          `INSERT INTO client_area_identity_contacts (tenant_id,workspace_id,user_id,contact_id)
           VALUES ($1,$2,$3,$4)`,
          [tenant, workspace, otherUser, crossWorkspacePerson],
        ),
      );

      await runner.query(
        `INSERT INTO contact_company_links
          (tenant_id,workspace_id,person_contact_id,company_contact_id,status,linked_at)
         VALUES ($1,$2,$3,$4,'active',now())`,
        [tenant, workspace, person, organization],
      );
      await reject(() =>
        runner.query(
          `UPDATE contact_company_links SET status='inactive', unlinked_at=NULL
           WHERE tenant_id=$1 AND person_contact_id=$2`,
          [tenant, person],
        ),
      );
      await runner.query(
        `UPDATE contact_company_links SET status='inactive', unlinked_at=now()
         WHERE tenant_id=$1 AND person_contact_id=$2`,
        [tenant, person],
      );
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });
});
