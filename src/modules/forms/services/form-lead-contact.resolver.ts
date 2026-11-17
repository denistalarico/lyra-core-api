import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, type EntityManager } from 'typeorm';
import { ContactEntity } from '../../contacts/entities/contact.entity';
import { ContactListEntity } from '../../contacts/entities/contact-list.entity';
import { ContactListMemberEntity } from '../../contacts/entities/contact-list-member.entity';
import { ContactMethodEntity } from '../../contacts/entities/contact-method.entity';
import { LeadFlowContactCompanyEntity } from '../../contacts/entities/leadflow-contact-company.entity';
import { phoneMatchVariants } from '../form-submission.normalizer';
import type { NormalizedLead } from '../forms.types';

export type FormContactScope = {
  tenantId: string;
  workspaceId: string;
  /** Both null = the agency's own contacts; both set = a LeadFlow client company. */
  agencyClientId: string | null;
  companyContextId: string | null;
};

export const FORMS_CONTACT_LIST_NAME = 'Formulários';

/**
 * Finds or creates the lead's contact in the right scope (§5.1).
 *
 * Scope mirrors what the CRMs accept (`assertLeadFlowContactCompany`):
 * - client company: the contact must be linked to that company in
 *   `leadflow_contact_companies`;
 * - agency: the contact must not belong to any LeadFlow company.
 * Deduplication only looks inside that scope, so a lead never crosses clients.
 */
@Injectable()
export class FormLeadContactResolver {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
  ) {}

  /** A contact needs a name and a way to reach it; otherwise only the opportunity is created. */
  static hasEnoughData(lead: NormalizedLead): boolean {
    return Boolean(lead.name && (lead.email || lead.phone));
  }

  async findExisting(
    scope: FormContactScope,
    lead: NormalizedLead,
  ): Promise<string | null> {
    if (!lead.email && !lead.phone) return null;
    const params: unknown[] = [scope.tenantId, scope.workspaceId];
    const matches: string[] = [];
    if (lead.email) {
      params.push(lead.email);
      matches.push(`(m.type = 'email' AND LOWER(m.value) = $${params.length})`);
    }
    if (lead.phone) {
      params.push(phoneMatchVariants(lead.phone));
      matches.push(
        `(m.type IN ('phone', 'whatsapp') AND regexp_replace(m.value, '\\D', '', 'g') = ANY($${params.length}::text[]))`,
      );
    }
    let scopeSql: string;
    if (scope.companyContextId) {
      params.push(scope.agencyClientId, scope.companyContextId);
      scopeSql = `EXISTS (SELECT 1 FROM leadflow_contact_companies lc
        WHERE lc.contact_id = c.id AND lc.agency_client_id = $${params.length - 1}
          AND lc.company_context_id = $${params.length})`;
    } else {
      scopeSql = `NOT EXISTS (SELECT 1 FROM leadflow_contact_companies lc WHERE lc.contact_id = c.id)`;
    }
    const rows = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT c.id FROM contacts c
         JOIN contact_methods m
           ON m.contact_id = c.id AND m.tenant_id = c.tenant_id AND m.workspace_id = c.workspace_id
        WHERE c.tenant_id = $1 AND c.workspace_id = $2 AND c.status <> 'archived'
          AND (${matches.join(' OR ')})
          AND ${scopeSql}
        ORDER BY (m.type = 'email') DESC, c.updated_at DESC
        LIMIT 1`,
      params,
    );
    return rows[0]?.id ?? null;
  }

  async create(
    scope: FormContactScope,
    lead: NormalizedLead,
    input: { formName: string; ownerUserId: string | null },
  ): Promise<string> {
    const name = lead.name ?? lead.email ?? lead.phone ?? 'Lead de formulário';
    const [firstName, ...rest] = name.split(/\s+/).filter(Boolean);
    const contactId = await this.dataSource.transaction(async (manager) => {
      const contact = await manager.getRepository(ContactEntity).save(
        manager.getRepository(ContactEntity).create({
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          type: 'person',
          displayName: name.slice(0, 200),
          firstName: firstName ?? null,
          lastName: rest.length ? rest.join(' ') : null,
          jobTitle: lead.position,
          source: 'form',
          businessMode: 'agency_service',
          lifecycleStage: 'lead',
          lifecycleStages: ['lead'],
          status: 'active',
          ownerUserId: input.ownerUserId,
          createdByUserId: null,
          notes: [
            `Contato criado automaticamente pelo formulário "${input.formName}".`,
            lead.company ? `Empresa informada: ${lead.company}` : null,
          ]
            .filter(Boolean)
            .join('\n'),
        }),
      );
      const methods: Array<Partial<ContactMethodEntity>> = [];
      if (lead.email)
        methods.push({ type: 'email', value: lead.email, isPrimary: true });
      if (lead.phone)
        methods.push({ type: 'phone', value: lead.phone, isPrimary: true });
      for (const method of methods)
        await manager.getRepository(ContactMethodEntity).save(
          manager.getRepository(ContactMethodEntity).create({
            tenantId: scope.tenantId,
            workspaceId: scope.workspaceId,
            contactId: contact.id,
            ...method,
          }),
        );
      if (scope.agencyClientId && scope.companyContextId)
        await manager.getRepository(LeadFlowContactCompanyEntity).save({
          contactId: contact.id,
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          agencyClientId: scope.agencyClientId,
          companyContextId: scope.companyContextId,
          scopeKind: 'company',
        });
      return contact.id;
    });

    await this.addToLists(scope, contactId);
    return contactId;
  }

  /**
   * "Formulários" system list (the separate folder in Contacts) and, for a
   * client company, the LeadFlow company sublist when it already exists — the
   * LeadFlow contacts screen creates it with the company's real name, so this
   * never invents one.
   */
  private async addToLists(scope: FormContactScope, contactId: string) {
    const manager = this.dataSource.manager;
    const formsList = await this.ensureFormsList(manager, scope);
    const listIds = [formsList.id];
    if (scope.companyContextId) {
      const companyList = await manager
        .getRepository(ContactListEntity)
        .findOne({
          where: {
            tenantId: scope.tenantId,
            workspaceId: scope.workspaceId,
            sourceProduct: 'leadflow',
            sourceContext: `company:${scope.companyContextId}`,
          },
        });
      if (companyList) {
        listIds.push(companyList.id);
        if (companyList.parentListId) listIds.push(companyList.parentListId);
      }
    }
    const members = manager.getRepository(ContactListMemberEntity);
    for (const listId of listIds) {
      const existing = await members.findOne({
        where: {
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          listId,
          contactId,
        },
      });
      if (!existing)
        await members.save(
          members.create({
            tenantId: scope.tenantId,
            workspaceId: scope.workspaceId,
            listId,
            contactId,
          }),
        );
    }
  }

  private async ensureFormsList(
    manager: EntityManager,
    scope: FormContactScope,
  ) {
    const lists = manager.getRepository(ContactListEntity);
    const where = {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      sourceProduct: 'forms',
      sourceContext: 'form_leads',
    };
    const existing = await lists.findOne({ where });
    if (existing) return existing;
    const build = (name: string) =>
      lists.create({
        ...where,
        name,
        description:
          'Lista protegida com os contatos criados automaticamente pelos formulários.',
        color: '#7C3AED',
        parentListId: null,
        visibility: 'workspace',
        isSystem: true,
        isProtected: true,
        createdByUserId: null,
      });
    try {
      return await lists.save(build(FORMS_CONTACT_LIST_NAME));
    } catch (error) {
      const raced = await lists.findOne({ where });
      if (raced) return raced;
      // (workspace, name) is unique: a user list may already be called "Formulários".
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string }).code === '23505'
      )
        return lists.save(build(`${FORMS_CONTACT_LIST_NAME} (automático)`));
      throw error;
    }
  }
}
