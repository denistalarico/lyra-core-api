import { randomUUID } from 'crypto';
import { AgencyDataSource } from '../../database/agency-typeorm.datasource';
import { ContactAddressEntity } from '../contacts/entities/contact-address.entity';
import { ContactCompanyLinkEntity } from '../contacts/entities/contact-company-link.entity';
import { ContactEntity } from '../contacts/entities/contact.entity';
import { ContactListEntity } from '../contacts/entities/contact-list.entity';
import { ContactListMemberEntity } from '../contacts/entities/contact-list-member.entity';
import { ContactMethodEntity } from '../contacts/entities/contact-method.entity';
import { ContactSegmentEntity } from '../contacts/entities/contact-segment.entity';
import { ContactTagAssignmentEntity } from '../contacts/entities/contact-tag-assignment.entity';
import { ContactTagEntity } from '../contacts/entities/contact-tag.entity';
import {
  AgencyBankEntity,
  AgencyContactBankAccountEntity,
  AgencyContactIdentificationTypeEntity,
  AgencyContactProfileEntity,
  AgencyContactSourceEntity,
} from './entities/agency-contact-details.entities';
import { AgencyContactsService } from './agency-contacts.service';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { deleteFixtureTenant } from '../../testing/fixture-tenant';

const run = describePostgresIntegration();

run('AgencyContactsService permanent deletion PostgreSQL', () => {
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  const ctx = { tenantId, workspaceId, userId: randomUUID() };
  let service: AgencyContactsService;

  const resetFixtures = () =>
    deleteFixtureTenant(AgencyDataSource, tenantId, [
      'inbox_domain_outbox',
      'leadflow_event_deliveries',
      'platform_permission_audit_events',
      'inbox_messages',
      'inbox_conversations',
      'crm_opportunities',
      'crm_stages',
      'crm_pipelines',
      'contacts',
    ]);

  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
    service = new AgencyContactsService(
      AgencyDataSource,
      AgencyDataSource.getRepository(ContactEntity),
      AgencyDataSource.getRepository(ContactListEntity),
      AgencyDataSource.getRepository(ContactListMemberEntity),
      AgencyDataSource.getRepository(ContactMethodEntity),
      AgencyDataSource.getRepository(ContactAddressEntity),
      AgencyDataSource.getRepository(ContactTagEntity),
      AgencyDataSource.getRepository(ContactSegmentEntity),
      AgencyDataSource.getRepository(ContactTagAssignmentEntity),
      AgencyDataSource.getRepository(ContactCompanyLinkEntity),
      AgencyDataSource.getRepository(AgencyContactProfileEntity),
      AgencyDataSource.getRepository(AgencyContactIdentificationTypeEntity),
      AgencyDataSource.getRepository(AgencyContactSourceEntity),
      AgencyDataSource.getRepository(AgencyBankEntity),
      AgencyDataSource.getRepository(AgencyContactBankAccountEntity),
      {} as never,
    );
  });

  afterAll(async () => {
    if (AgencyDataSource.isInitialized) {
      await resetFixtures();
      await AgencyDataSource.destroy();
    }
  });

  beforeEach(resetFixtures);

  async function insertContact(targetWorkspace = workspaceId) {
    const id = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO contacts (id,tenant_id,workspace_id,type,display_name)
       VALUES ($1,$2,$3,'person','Disposable contact')`,
      [id, tenantId, targetWorkspace],
    );
    return id;
  }

  it('removes an unreferenced contact atomically on the first request', async () => {
    const contactId = await insertContact();
    await expect(
      service.permanentlyDeleteContact(ctx, contactId),
    ).resolves.toEqual({
      deleted: true,
    });
    const [row] = await AgencyDataSource.query<Array<{ count: string }>>(
      'SELECT count(*)::text count FROM contacts WHERE id=$1',
      [contactId],
    );
    expect(row.count).toBe('0');
    await expect(
      service.permanentlyDeleteContact(ctx, contactId),
    ).rejects.toThrow('Contact not found.');
  });

  it('refuses contacts linked to an Inbox conversation', async () => {
    const contactId = await insertContact();
    await AgencyDataSource.query(
      `INSERT INTO inbox_conversations
        (tenant_id,workspace_id,contact_id,status,source,business_mode,
         ai_enabled,ownership_state,ownership_version,qualification_status)
       VALUES ($1,$2,$3,'open','whatsapp','general',false,'paused',1,'unknown')`,
      [tenantId, workspaceId, contactId],
    );
    await expect(
      service.permanentlyDeleteContact(ctx, contactId),
    ).rejects.toThrow('conversas ou mensagens vinculadas');
    expect(
      await AgencyDataSource.getRepository(ContactEntity).existsBy({
        id: contactId,
      }),
    ).toBe(true);
  });

  it('refuses contacts linked to a CRM opportunity', async () => {
    const contactId = await insertContact();
    const pipelineId = randomUUID();
    const stageId = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO crm_pipelines (id,tenant_id,workspace_id,name)
       VALUES ($1,$2,$3,'Pipeline')`,
      [pipelineId, tenantId, workspaceId],
    );
    await AgencyDataSource.query(
      `INSERT INTO crm_stages (id,tenant_id,workspace_id,pipeline_id,name)
       VALUES ($1,$2,$3,$4,'Novo')`,
      [stageId, tenantId, workspaceId, pipelineId],
    );
    await AgencyDataSource.query(
      `INSERT INTO crm_opportunities
        (tenant_id,workspace_id,pipeline_id,stage_id,contact_id,title)
       VALUES ($1,$2,$3,$4,$5,'Opportunity')`,
      [tenantId, workspaceId, pipelineId, stageId, contactId],
    );
    await expect(
      service.permanentlyDeleteContact(ctx, contactId),
    ).rejects.toThrow('oportunidades ou atividades de CRM vinculadas');
  });

  it('does not expose or delete a contact from another workspace', async () => {
    const contactId = await insertContact(randomUUID());
    await expect(
      service.permanentlyDeleteContact(ctx, contactId),
    ).rejects.toThrow('Contact not found.');
    expect(
      await AgencyDataSource.getRepository(ContactEntity).existsBy({
        id: contactId,
      }),
    ).toBe(true);
  });

  it('serializes concurrent deletion attempts without false success', async () => {
    const contactId = await insertContact();
    const attempts = await Promise.allSettled([
      service.permanentlyDeleteContact(ctx, contactId),
      service.permanentlyDeleteContact(ctx, contactId),
    ]);
    expect(attempts.filter((item) => item.status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(attempts.filter((item) => item.status === 'rejected')).toHaveLength(
      1,
    );
    expect(
      await AgencyDataSource.getRepository(ContactEntity).existsBy({
        id: contactId,
      }),
    ).toBe(false);
  });
});
