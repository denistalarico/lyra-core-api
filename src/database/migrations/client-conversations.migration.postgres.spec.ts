import { randomUUID } from 'crypto';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { CreateClientAreaMemberships1797000000000 } from './1797000000000-create-client-area-memberships';
import { CreateClientAreaInvitations1797100000000 } from './1797100000000-create-client-area-invitations';
import { CreateClientAreaManagement1797150000000 } from './1797150000000-create-client-area-management';
import { CreateClientConversations1797500000000 } from './1797500000000-create-client-conversations';

const run = describePostgresIntegration();

/**
 * CCOM1 §55/§56 — the constraints the database itself must enforce.
 *
 * Every rejection here is a mistake application code could otherwise make
 * silently: a client seat with no membership, a message attributed to a client
 * with no person behind it, two active conversations for one company, an
 * attachment pointing at a conversation it does not belong to. They are
 * asserted against real PostgreSQL because a CHECK constraint that exists only
 * in a migration file is a comment.
 */
run('CCOM1 client conversations migration against PostgreSQL', () => {
  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
  });
  afterAll(async () => {
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  it('runs up/down/up and enforces scope, surface and uniqueness', async () => {
    const runner = AgencyDataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();

    const tenant = randomUUID();
    const workspace = randomUUID();
    const org = randomUUID();
    const client = randomUUID();
    const company = randomUUID();
    const otherCompany = randomUUID();
    const otherOrg = randomUUID();
    const user = randomUUID();
    const operator = randomUUID();

    const reject = async (operation: () => Promise<unknown>) => {
      await runner.query('SAVEPOINT expected_failure');
      await expect(operation()).rejects.toThrow();
      await runner.query('ROLLBACK TO SAVEPOINT expected_failure');
    };

    try {
      await new CreateClientAreaMemberships1797000000000().up(runner);
      await new CreateClientAreaInvitations1797100000000().up(runner);
      await new CreateClientAreaManagement1797150000000().up(runner);

      const migration = new CreateClientConversations1797500000000();
      await migration.up(runner);
      await migration.down(runner);
      await migration.up(runner);
      // Idempotent: every statement is IF NOT EXISTS / ADD COLUMN IF NOT
      // EXISTS, so a re-run on a partially migrated database is safe.
      await migration.up(runner);

      await runner.query(
        `INSERT INTO contacts (id,tenant_id,workspace_id,type,display_name) VALUES ($1,$3,$4,'organization','Empresa A'),($2,$3,$4,'organization','Empresa B')`,
        [org, otherOrg, tenant, workspace],
      );
      await runner.query(
        `INSERT INTO agency_clients (id,tenant_id,workspace_id,contact_id,display_name) VALUES ($1,$2,$3,$4,'Rotulo interno')`,
        [client, tenant, workspace, org],
      );
      await runner.query(
        `INSERT INTO agency_client_company_contexts (id,tenant_id,workspace_id,agency_client_id,company_contact_id,status,is_primary) VALUES
          ($1,$3,$4,$5,$6,'active',true),($2,$3,$4,$5,$7,'active',false)`,
        [company, otherCompany, tenant, workspace, client, org, otherOrg],
      );
      await runner.query(
        `INSERT INTO client_area_memberships (id,tenant_id,workspace_id,agency_client_id,company_context_id,user_id,role,status,granted_at)
         VALUES ($1,$2,$3,$4,$5,$6,'client_operator','active',now())`,
        [randomUUID(), tenant, workspace, client, company, user],
      );
      const [membership] = (await runner.query(
        `SELECT id FROM client_area_memberships WHERE user_id = $1`,
        [user],
      )) as Array<{ id: string }>;

      // §19 — the settings switch landed on the existing tables, defaulting off.
      const [companySettings] = (await runner.query(
        `INSERT INTO client_area_company_settings (tenant_id,workspace_id,agency_client_id,company_context_id,enabled)
         VALUES ($1,$2,$3,$4,true) RETURNING conversations_enabled`,
        [tenant, workspace, client, company],
      )) as Array<{ conversations_enabled: boolean }>;
      expect(companySettings.conversations_enabled).toBe(false);

      const [agencySettings] = (await runner.query(
        `INSERT INTO client_area_settings (tenant_id,workspace_id,enabled) VALUES ($1,$2,true)
         RETURNING conversations_default_enabled`,
        [tenant, workspace],
      )) as Array<{ conversations_default_enabled: boolean }>;
      expect(agencySettings.conversations_default_enabled).toBe(false);

      const conversation = randomUUID();
      await runner.query(
        `INSERT INTO client_conversations (id,tenant_id,workspace_id,agency_client_id,company_context_id) VALUES ($1,$2,$3,$4,$5)`,
        [conversation, tenant, workspace, client, company],
      );

      // §4 — one active default conversation per company.
      await reject(() =>
        runner.query(
          `INSERT INTO client_conversations (id,tenant_id,workspace_id,agency_client_id,company_context_id) VALUES ($1,$2,$3,$4,$5)`,
          [randomUUID(), tenant, workspace, client, company],
        ),
      );

      // ...but archiving the first frees the slot, so history survives a re-open.
      await runner.query(
        `UPDATE client_conversations SET status='archived', archived_at=now() WHERE id=$1`,
        [conversation],
      );
      const reopened = randomUUID();
      await runner.query(
        `INSERT INTO client_conversations (id,tenant_id,workspace_id,agency_client_id,company_context_id) VALUES ($1,$2,$3,$4,$5)`,
        [reopened, tenant, workspace, client, company],
      );
      await runner.query(
        `UPDATE client_conversations SET status='active', archived_at=NULL WHERE id=$1`,
        [reopened],
      );
      await runner.query(`DELETE FROM client_conversations WHERE id=$1`, [
        reopened,
      ]);
      await runner.query(
        `UPDATE client_conversations SET status='active', archived_at=NULL WHERE id=$1`,
        [conversation],
      );

      // §3 — the four scope columns must describe ONE real company.
      await reject(() =>
        runner.query(
          `INSERT INTO client_conversations (id,tenant_id,workspace_id,agency_client_id,company_context_id) VALUES ($1,$2,$3,$4,$5)`,
          [randomUUID(), tenant, workspace, randomUUID(), company],
        ),
      );
      await reject(() =>
        runner.query(
          `INSERT INTO client_conversations (id,tenant_id,workspace_id,agency_client_id,company_context_id) VALUES ($1,$2,$3,$4,$5)`,
          [randomUUID(), randomUUID(), workspace, client, company],
        ),
      );

      // 'archived' and `archived_at` must agree.
      await reject(() =>
        runner.query(
          `INSERT INTO client_conversations (id,tenant_id,workspace_id,agency_client_id,company_context_id,status) VALUES ($1,$2,$3,$4,$5,'archived')`,
          [randomUUID(), tenant, workspace, client, otherCompany],
        ),
      );

      // §8 — a client seat must cite its membership.
      await reject(() =>
        runner.query(
          `INSERT INTO client_conversation_participants (tenant_id,workspace_id,conversation_id,company_context_id,participant_surface,user_id)
           VALUES ($1,$2,$3,$4,'client_area',$5)`,
          [tenant, workspace, conversation, company, user],
        ),
      );
      // §7 — an agency seat must NOT carry one.
      await reject(() =>
        runner.query(
          `INSERT INTO client_conversation_participants (tenant_id,workspace_id,conversation_id,company_context_id,participant_surface,user_id,membership_id)
           VALUES ($1,$2,$3,$4,'agency',$5,$6)`,
          [tenant, workspace, conversation, company, operator, membership.id],
        ),
      );
      await reject(() =>
        runner.query(
          `INSERT INTO client_conversation_participants (tenant_id,workspace_id,conversation_id,company_context_id,participant_surface,user_id)
           VALUES ($1,$2,$3,$4,'somewhere_else',$5)`,
          [tenant, workspace, conversation, company, user],
        ),
      );

      await runner.query(
        `INSERT INTO client_conversation_participants (tenant_id,workspace_id,conversation_id,company_context_id,participant_surface,user_id,membership_id)
         VALUES ($1,$2,$3,$4,'client_area',$5,$6)`,
        [tenant, workspace, conversation, company, user, membership.id],
      );
      await runner.query(
        `INSERT INTO client_conversation_participants (tenant_id,workspace_id,conversation_id,company_context_id,participant_surface,user_id)
         VALUES ($1,$2,$3,$4,'agency',$5)`,
        [tenant, workspace, conversation, company, operator],
      );

      /**
       * §54 — the SAME user id may hold both seats without colliding, because
       * the surface is part of the participant's identity.
       */
      await runner.query(
        `INSERT INTO client_conversation_participants (tenant_id,workspace_id,conversation_id,company_context_id,participant_surface,user_id)
         VALUES ($1,$2,$3,$4,'agency',$5)`,
        [tenant, workspace, conversation, company, user],
      );
      const [seats] = (await runner.query(
        `SELECT count(*)::int AS total FROM client_conversation_participants WHERE conversation_id=$1 AND user_id=$2`,
        [conversation, user],
      )) as Array<{ total: number }>;
      expect(seats.total).toBe(2);

      // §5 — but not the same seat twice.
      await reject(() =>
        runner.query(
          `INSERT INTO client_conversation_participants (tenant_id,workspace_id,conversation_id,company_context_id,participant_surface,user_id,membership_id)
           VALUES ($1,$2,$3,$4,'client_area',$5,$6)`,
          [tenant, workspace, conversation, company, user, membership.id],
        ),
      );

      // §10 — a client-attributed message always has a person behind it.
      await reject(() =>
        runner.query(
          `INSERT INTO client_conversation_messages (tenant_id,workspace_id,agency_client_id,company_context_id,conversation_id,sender_surface,body)
           VALUES ($1,$2,$3,$4,$5,'client_area','sem autor')`,
          [tenant, workspace, client, company, conversation],
        ),
      );
      // ...while the platform may speak with no author, as 'agency'.
      await runner.query(
        `INSERT INTO client_conversation_messages (tenant_id,workspace_id,agency_client_id,company_context_id,conversation_id,sender_surface,body,kind)
         VALUES ($1,$2,$3,$4,$5,'agency','Conversa iniciada.','system')`,
        [tenant, workspace, client, company, conversation],
      );

      // §11 — only the three V1 kinds exist.
      await reject(() =>
        runner.query(
          `INSERT INTO client_conversation_messages (tenant_id,workspace_id,agency_client_id,company_context_id,conversation_id,sender_surface,sender_user_id,body,kind)
           VALUES ($1,$2,$3,$4,$5,'client_area',$6,'oi','approval_card')`,
          [tenant, workspace, client, company, conversation, user],
        ),
      );

      // A text message may not be blank.
      await reject(() =>
        runner.query(
          `INSERT INTO client_conversation_messages (tenant_id,workspace_id,agency_client_id,company_context_id,conversation_id,sender_surface,sender_user_id,body)
           VALUES ($1,$2,$3,$4,$5,'client_area',$6,'   ')`,
          [tenant, workspace, client, company, conversation, user],
        ),
      );

      const [message] = (await runner.query(
        `INSERT INTO client_conversation_messages (tenant_id,workspace_id,agency_client_id,company_context_id,conversation_id,sender_surface,sender_user_id,body)
         VALUES ($1,$2,$3,$4,$5,'client_area',$6,'Bom dia, podemos alterar a data da campanha?') RETURNING id`,
        [tenant, workspace, client, company, conversation, user],
      )) as Array<{ id: string }>;

      // §55 — an attachment cannot escape the conversation it belongs to.
      await runner.query(
        `INSERT INTO client_conversation_attachments (tenant_id,workspace_id,agency_client_id,company_context_id,conversation_id,message_id,uploaded_by_surface,uploaded_by_user_id,kind,file_name,mime_type,size_bytes,storage_key)
         VALUES ($1,$2,$3,$4,$5,$6,'client_area',$7,'image','brief.png','image/png',1024,'tenants/x/y.png')`,
        [tenant, workspace, client, company, conversation, message.id, user],
      );
      await reject(() =>
        runner.query(
          `INSERT INTO client_conversation_attachments (tenant_id,workspace_id,agency_client_id,company_context_id,conversation_id,uploaded_by_surface,uploaded_by_user_id,kind,file_name,mime_type,size_bytes,storage_key)
           VALUES ($1,$2,$3,$4,$5,'client_area',$6,'image','x.png','image/png',1024,'k')`,
          [tenant, workspace, client, company, randomUUID(), user],
        ),
      );
      await reject(() =>
        runner.query(
          `INSERT INTO client_conversation_attachments (tenant_id,workspace_id,agency_client_id,company_context_id,conversation_id,uploaded_by_surface,uploaded_by_user_id,kind,file_name,mime_type,size_bytes,storage_key)
           VALUES ($1,$2,$3,$4,$5,'client_area',$6,'spreadsheet','x.png','image/png',1024,'k')`,
          [tenant, workspace, client, company, conversation, user],
        ),
      );
      await reject(() =>
        runner.query(
          `INSERT INTO client_conversation_attachments (tenant_id,workspace_id,agency_client_id,company_context_id,conversation_id,uploaded_by_surface,uploaded_by_user_id,kind,file_name,mime_type,size_bytes,storage_key)
           VALUES ($1,$2,$3,$4,$5,'client_area',$6,'image','x.png','image/png',0,'k')`,
          [tenant, workspace, client, company, conversation, user],
        ),
      );

      // Nothing cascades a conversation away: it is a record of what was said.
      await reject(() =>
        runner.query(`DELETE FROM client_conversations WHERE id = $1`, [
          conversation,
        ]),
      );

      // §2 — defaults the entity relies on.
      const [row] = (await runner.query(
        `SELECT kind, status, archived_at, last_message_at FROM client_conversations WHERE id=$1`,
        [conversation],
      )) as Array<Record<string, unknown>>;
      expect(row).toMatchObject({
        kind: 'default',
        status: 'active',
        archived_at: null,
        last_message_at: null,
      });

      // §45 — the watermark columns exist and start empty.
      const [seat] = (await runner.query(
        `SELECT last_read_at, left_at, role FROM client_conversation_participants WHERE conversation_id=$1 AND participant_surface='client_area'`,
        [conversation],
      )) as Array<Record<string, unknown>>;
      expect(seat).toMatchObject({
        last_read_at: null,
        left_at: null,
        role: 'member',
      });
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  }, 120000);
});
