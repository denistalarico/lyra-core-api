import { randomUUID } from 'crypto';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import { describePostgresIntegration } from '../../../testing/postgres-integration';
import { deleteFixtureTenant } from '../../../testing/fixture-tenant';
import { InboxWebchatLeadService } from './inbox-webchat-lead.service';

const run = describePostgresIntegration();

run('InboxWebchatLeadService PostgreSQL', () => {
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  const scope = { tenantId, workspaceId };
  // Without the CRM command service the opportunity step is skipped, which
  // isolates the contact linkage this spec covers.
  let service: InboxWebchatLeadService;

  const resetFixtures = () =>
    deleteFixtureTenant(AgencyDataSource, tenantId, [
      'inbox_channel_contact_identities',
      'inbox_conversations',
      'inbox_channels',
      'contacts',
    ]);

  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
    service = new InboxWebchatLeadService(AgencyDataSource);
  });

  afterAll(async () => {
    if (AgencyDataSource.isInitialized) {
      await AgencyDataSource.query(
        `DELETE FROM contact_list_members WHERE tenant_id = $1`,
        [tenantId],
      );
      await AgencyDataSource.query(
        `DELETE FROM contact_lists WHERE tenant_id = $1`,
        [tenantId],
      );
      await resetFixtures();
      await AgencyDataSource.destroy();
    }
  });

  beforeEach(async () => {
    await AgencyDataSource.query(
      `DELETE FROM contact_list_members WHERE tenant_id = $1`,
      [tenantId],
    );
    await resetFixtures();
  });

  async function insertWebchatConversation() {
    const channelId = randomUUID();
    const webchatConversationId = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO inbox_channels
         (id, tenant_id, workspace_id, name, type, provider, status,
          connection_status, lifecycle_version, credential_version,
          ai_enabled, settings, metadata, scope_kind)
       VALUES ($1, $2, $3, 'Webchat', 'webchat', 'lyra', 'active',
               'connected', 1, 1, false, '{}'::jsonb, '{}'::jsonb, 'agency')`,
      [channelId, tenantId, workspaceId],
    );
    const [conversation] = await AgencyDataSource.query<Array<{ id: string }>>(
      `INSERT INTO inbox_conversations
        (tenant_id,workspace_id,channel_id,external_thread_id,status,source,
         business_mode,ai_enabled,ownership_state,ownership_version,
         qualification_status,scope_kind)
       VALUES ($1,$2,$3,$4,'open','webchat','general',false,'paused',1,
               'pending','agency')
       RETURNING id`,
      [tenantId, workspaceId, channelId, webchatConversationId],
    );
    return { conversationId: conversation.id, webchatConversationId };
  }

  const contactOf = async (conversationId: string) => {
    const [row] = await AgencyDataSource.query<
      Array<{ contact_id: string | null }>
    >('SELECT contact_id FROM inbox_conversations WHERE id = $1', [
      conversationId,
    ]);
    return row.contact_id;
  };

  it('creates a LeadFlow contact from name and phone', async () => {
    const { conversationId, webchatConversationId } =
      await insertWebchatConversation();

    const outcome = await service.captureLead(scope, webchatConversationId, {
      name: 'Maria Lead',
      phone: '+55 (11) 98888-7777',
      email: 'Maria@Example.com',
    });

    expect(outcome).toMatchObject({ status: 'captured', opportunityId: null });
    const contactId = await contactOf(conversationId);
    expect(contactId).toBeTruthy();
    const methods = await AgencyDataSource.query<
      Array<{ type: string; value: string }>
    >(
      'SELECT type, value FROM contact_methods WHERE contact_id = $1 ORDER BY type',
      [contactId],
    );
    expect(methods).toEqual([
      { type: 'email', value: 'maria@example.com' },
      { type: 'phone', value: '+5511988887777' },
    ]);
    const [membership] = await AgencyDataSource.query<
      Array<{ name: string }>
    >(
      `SELECT list.name FROM contact_list_members member
         JOIN contact_lists list ON list.id = member.list_id
        WHERE member.contact_id = $1`,
      [contactId],
    );
    expect(membership.name).toBe('LeadFlow');
  });

  it('reuses the contact that already has the phone', async () => {
    const existingId = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO contacts (id,tenant_id,workspace_id,type,display_name)
       VALUES ($1,$2,$3,'person','Maria já cadastrada')`,
      [existingId, tenantId, workspaceId],
    );
    await AgencyDataSource.query(
      `INSERT INTO contact_methods
        (tenant_id,workspace_id,contact_id,type,value,is_primary)
       VALUES ($1,$2,$3,'whatsapp','5511988887777',true)`,
      [tenantId, workspaceId, existingId],
    );
    const { conversationId, webchatConversationId } =
      await insertWebchatConversation();

    await service.captureLead(scope, webchatConversationId, {
      name: 'Maria',
      phone: '55 11 98888-7777',
    });

    expect(await contactOf(conversationId)).toBe(existingId);
  });

  it('skips incomplete leads and stays idempotent', async () => {
    const { conversationId, webchatConversationId } =
      await insertWebchatConversation();

    await expect(
      service.captureLead(scope, webchatConversationId, { name: 'Sem fone' }),
    ).resolves.toEqual({ status: 'skipped', reason: 'lead_incomplete' });
    expect(await contactOf(conversationId)).toBeNull();

    const lead = { name: 'João', phone: '+55 21 97777-6666' };
    await service.captureLead(scope, webchatConversationId, lead);
    const first = await contactOf(conversationId);
    await service.captureLead(scope, webchatConversationId, lead);
    expect(await contactOf(conversationId)).toBe(first);
    const [count] = await AgencyDataSource.query<Array<{ count: string }>>(
      'SELECT count(*)::text count FROM contacts WHERE tenant_id = $1',
      [tenantId],
    );
    expect(count.count).toBe('1');
  });
});
