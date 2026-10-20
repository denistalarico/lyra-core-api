import { randomUUID } from 'node:crypto';
import { Table, type DataSource, type QueryRunner } from 'typeorm';
import { AgencyDataSource } from '../../database/agency-typeorm.datasource';
import { IsolateLeadflowContactsByCompany1800050000000 } from '../../database/migrations/1800050000000-isolate-leadflow-contacts-by-company';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { ContactEntity } from '../contacts/entities/contact.entity';
import { ContactListEntity } from '../contacts/entities/contact-list.entity';
import { ContactListMemberEntity } from '../contacts/entities/contact-list-member.entity';
import { ContactMethodEntity } from '../contacts/entities/contact-method.entity';
import { ContactAddressEntity } from '../contacts/entities/contact-address.entity';
import { ContactTagEntity } from '../contacts/entities/contact-tag.entity';
import { ContactSegmentEntity } from '../contacts/entities/contact-segment.entity';
import { ContactTagAssignmentEntity } from '../contacts/entities/contact-tag-assignment.entity';
import { ContactCompanyLinkEntity } from '../contacts/entities/contact-company-link.entity';
import {
  AgencyBankEntity,
  AgencyContactBankAccountEntity,
  AgencyContactIdentificationTypeEntity,
  AgencyContactProfileEntity,
  AgencyContactSourceEntity,
} from '../agency/entities/agency-contact-details.entities';
import { AgencyContactsService } from '../agency/agency-contacts.service';
import { AgencyClientCompanyContext } from '../clients/entities/agency-client-company-context.entity';
import { InboxChannelEntity } from '../inbox/entities/inbox-channel.entity';
import { InboxConversationEntity } from '../inbox/entities/inbox-conversation.entity';
import { InboxMediaAssetEntity } from '../inbox/entities/inbox-media-asset.entity';
import { InboxDomainOutboxEntity } from '../inbox/entities/inbox-domain-outbox.entity';
import { CrmOpportunityEntity } from '../crm/entities/crm-opportunity.entity';
import { CrmOpportunityEventEntity } from '../crm/entities/crm-opportunity-event.entity';
import { CrmPipelineEntity } from '../crm/entities/crm-pipeline.entity';
import { CrmStageEntity } from '../crm/entities/crm-stage.entity';
import { CrmTagEntity } from '../crm/entities/crm-tag.entity';
import { ScheduledItemEntity } from '../appointments/entities/scheduled-item.entity';
import { LeadFlowAgentEntity } from '../leadflow-agents/entities/leadflow-agent.entity';
import { PlatformPermissionAuditEventEntity } from '../permissions/entities/platform-permission-audit-event.entity';
import { LEADFLOW_CLIENT_SCOPE_SQL } from './leadflow-client-area-scope.service';
import { assertLeadFlowContactCompany } from '../contacts/leadflow-contact-company-scope';
import type { RequestContext } from '../../common/context/request-context.interface';

describePostgresIntegration()(
  'CA11 canonical contacts and scope SQL against real entity schemas',
  () => {
    let runner: QueryRunner, schema: string, service: AgencyContactsService;
    const tenantId = randomUUID(),
      workspaceId = randomUUID(),
      clientId = randomUUID(),
      userId = randomUUID(),
      a = randomUUID(),
      b = randomUUID();
    const context = (companyContextId: string): RequestContext => ({
      tenantId,
      workspaceId,
      userId,
      role: 'client_area_actor',
      managedContext: {
        productKey: 'leadflow',
        operatingMode: 'client',
        clientId,
        companyContextId,
        managedTenantId: null,
        clientName: 'Same client',
        companyName: 'Same company name',
      },
    });
    beforeAll(async () => {
      if (
        AgencyDataSource.options.type !== 'postgres' ||
        AgencyDataSource.options.database !== 'lyra_agency_test'
      )
        throw new Error('CA11 requires lyra_agency_test');
      if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
    });
    afterAll(async () => {
      await AgencyDataSource.destroy();
    });
    beforeEach(async () => {
      runner = AgencyDataSource.createQueryRunner();
      await runner.connect();
      schema = `ca11_domain_${randomUUID().replaceAll('-', '')}`;
      await runner.query(`CREATE SCHEMA "${schema}"`);
      await runner.query(`SET search_path TO "${schema}",public`);
      for (const entity of [
        ContactEntity,
        ContactListEntity,
        ContactListMemberEntity,
        ContactMethodEntity,
        ContactAddressEntity,
        ContactTagEntity,
        ContactSegmentEntity,
        ContactTagAssignmentEntity,
        ContactCompanyLinkEntity,
        AgencyContactProfileEntity,
        AgencyContactIdentificationTypeEntity,
        AgencyContactSourceEntity,
        AgencyBankEntity,
        AgencyContactBankAccountEntity,
        AgencyClientCompanyContext,
        InboxChannelEntity,
        InboxConversationEntity,
        InboxMediaAssetEntity,
        InboxDomainOutboxEntity,
        CrmOpportunityEntity,
        CrmOpportunityEventEntity,
        CrmPipelineEntity,
        CrmStageEntity,
        CrmTagEntity,
        ScheduledItemEntity,
        LeadFlowAgentEntity,
        PlatformPermissionAuditEventEntity,
      ])
        await runner.createTable(
          Table.create(
            AgencyDataSource.getMetadata(entity),
            AgencyDataSource.driver,
          ),
          false,
          false,
          false,
        );
      for (const company of [a, b])
        await runner.manager.getRepository(AgencyClientCompanyContext).save({
          id: company,
          tenantId,
          workspaceId,
          agencyClientId: clientId,
          companyContactId: randomUUID(),
        });
      await new IsolateLeadflowContactsByCompany1800050000000().up(runner);
      // All repository operations and transactions stay on this isolated schema's query runner.
      const scopedSource = {
        manager: runner.manager,
        transaction: <T>(fn: (manager: typeof runner.manager) => Promise<T>) =>
          runner.manager.transaction(fn),
      } as DataSource;
      service = new AgencyContactsService(
        scopedSource,
        runner.manager.getRepository(ContactEntity),
        runner.manager.getRepository(ContactListEntity),
        runner.manager.getRepository(ContactListMemberEntity),
        runner.manager.getRepository(ContactMethodEntity),
        runner.manager.getRepository(ContactAddressEntity),
        runner.manager.getRepository(ContactTagEntity),
        runner.manager.getRepository(ContactSegmentEntity),
        runner.manager.getRepository(ContactTagAssignmentEntity),
        runner.manager.getRepository(ContactCompanyLinkEntity),
        runner.manager.getRepository(AgencyContactProfileEntity),
        runner.manager.getRepository(AgencyContactIdentificationTypeEntity),
        runner.manager.getRepository(AgencyContactSourceEntity),
        runner.manager.getRepository(AgencyBankEntity),
        runner.manager.getRepository(AgencyContactBankAccountEntity),
        {} as never,
      );
    });
    afterEach(async () => {
      await runner.query('SET search_path TO public');
      await runner.query(`DROP SCHEMA "${schema}" CASCADE`);
      await runner.release();
    });
    it('executes every audited resource scope query against actual entity columns', async () => {
      for (const [kind, sql] of Object.entries(LEADFLOW_CLIENT_SCOPE_SQL)) {
        const rows: unknown = await runner.query(sql, [
          tenantId,
          workspaceId,
          clientId,
          a,
          randomUUID(),
        ]);
        expect({ kind, rows }).toEqual({ kind, rows: [] });
      }
    });
    it('creates one canonical row, isolates list/detail/mutation between sibling companies, and excludes unclassified legacy', async () => {
      const detail = await service.createLeadFlowContact(context(a), {
        type: 'person',
        displayName: 'Company A lead',
        email: 'lead@example.test',
      });
      const id = detail.contact.id;
      expect(
        (await service.listContacts(context(a))).items.map((row) => row.id),
      ).toContain(id);
      expect((await service.listContacts(context(b))).items).toEqual([]);
      await expect(
        service.getContactDetail(context(b), id),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        service.patchContact(context(b), id, { displayName: 'Foreign' }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        assertLeadFlowContactCompany(runner.manager, context(b), id),
      ).rejects.toMatchObject({ status: 404 });
      await service.patchContact(context(a), id, {
        displayName: 'Changed by client',
      });
      expect(
        (await service.getContact({ tenantId, workspaceId, userId }, id))
          .displayName,
      ).toBe('Changed by client');
      const legacy = await runner.manager.getRepository(ContactEntity).save({
        tenantId,
        workspaceId,
        type: 'person',
        displayName: 'Unclassified',
      });
      await expect(
        service.getContactDetail(context(a), legacy.id),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        service.createLeadFlowContact(context(a), {
          type: 'person',
          displayName: 'Forged',
          clientId: randomUUID(),
        }),
      ).rejects.toMatchObject({ status: 404 });
    });
    it('uses distinct company lists despite equal long names and an existing legacy client list', async () => {
      const legacy = {
        ...context(a),
        role: 'admin',
        managedContext: {
          ...context(a).managedContext!,
          companyContextId: null,
        },
      };
      const old = await service.getLeadFlowClientList(legacy);
      const long = (company: string) => ({
        ...context(company),
        managedContext: {
          ...context(company).managedContext!,
          companyName: 'X'.repeat(120),
        },
      });
      const first = await service.getLeadFlowClientList(long(a)),
        second = await service.getLeadFlowClientList(long(b));
      expect(new Set([old.id, first.id, second.id]).size).toBe(3);
      expect(first.sourceContext).toBe(`company:${a}`);
      expect(second.sourceContext).toBe(`company:${b}`);
      expect(second.name).toContain(b);
      expect(second.name.length).toBeLessThanOrEqual(120);
      expect((await service.getLeadFlowClientList(long(b))).id).toBe(second.id);
    });
    it('allows normal Agency permanent deletion of an unused owned contact and cascades its ownership', async () => {
      const { contact } = await service.createLeadFlowContact(context(a), {
        type: 'person',
        displayName: 'Unused',
      });
      await expect(
        service.permanentlyDeleteContact(
          { tenantId, workspaceId, userId, role: 'owner' },
          contact.id,
        ),
      ).resolves.toEqual({ deleted: true });
      expect(
        await runner.query(
          'SELECT contact_id FROM leadflow_contact_companies WHERE contact_id=$1',
          [contact.id],
        ),
      ).toEqual([]);
    });
  },
);
