import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager, In, IsNull } from 'typeorm';
import { AgencyContactsService } from '../../agency/agency-contacts.service';
import { ContactCompanyLinkEntity } from '../../contacts/entities/contact-company-link.entity';
import { ContactEntity } from '../../contacts/entities/contact.entity';
import { AgencyClient, AgencyClientCompanyContext } from '../entities';

@Injectable()
export class ClientCompanySetupService {
  constructor(
    @InjectDataSource('agency') private readonly db: DataSource,
    private readonly contacts: AgencyContactsService,
  ) {}

  async apply(
    manager: EntityManager,
    client: AgencyClient,
    selected?: string[],
    actorUserId: string | null = null,
  ): Promise<void> {
    if (!client.contactId) return; // Legacy clients remain supported.
    const scope = {
      tenantId: client.tenantId,
      workspaceId: client.workspaceId,
    };
    const contact = await manager.getRepository(ContactEntity).findOne({
      where: { ...scope, id: client.contactId, status: 'active' },
      lock: { mode: 'pessimistic_write' },
    });
    if (!contact) throw new NotFoundException('Contact not found.');
    let companyIds: string[];
    if (contact.type === 'organization') companyIds = [contact.id];
    else {
      const links = await manager.getRepository(ContactCompanyLinkEntity).find({
        where: {
          ...scope,
          personContactId: contact.id,
          status: 'active',
          unlinkedAt: IsNull(),
        },
        order: { isPrimary: 'DESC', createdAt: 'ASC' },
      });
      const linked = links.length
        ? await manager.getRepository(ContactEntity).find({
            where: {
              ...scope,
              id: In(links.map((link) => link.companyContactId)),
              type: 'organization',
              status: 'active',
            },
          })
        : [];
      const linkedIds = new Set(linked.map((company) => company.id));
      if (!selected?.length && linkedIds.size !== 1) {
        this.selectionError(
          linkedIds.size > 1
            ? 'client_company_selection_required'
            : 'client_company_required',
        );
      }
      companyIds = selected?.length ? [...new Set(selected)] : [...linkedIds];
      if (linkedIds.size > 1 && companyIds.some((id) => !linkedIds.has(id)))
        this.selectionError('client_company_selection_required');
      // Validate all targets before creating any links. Everything uses the
      // caller's manager, including the canonical CRM service and contexts.
      const companies = await manager.getRepository(ContactEntity).find({
        where: {
          ...scope,
          id: In(companyIds),
          type: 'organization',
          status: 'active',
        },
      });
      if (companies.length !== companyIds.length)
        throw new NotFoundException('Organization contact not found.');
      for (const id of companyIds) {
        if (!linkedIds.has(id))
          await this.contacts.addCompanyLink(
            { ...scope, userId: actorUserId ?? undefined },
            contact.id,
            id,
            {},
            manager,
          );
      }
    }
    const repo = manager.getRepository(AgencyClientCompanyContext);
    await repo.update(
      { ...scope, agencyClientId: client.id, isPrimary: true },
      { isPrimary: false },
    );
    for (const [index, companyContactId] of companyIds.entries()) {
      const current = await repo.findOne({
        where: { ...scope, agencyClientId: client.id, companyContactId },
      });
      await repo.save(
        current
          ? Object.assign(current, {
              status: 'active',
              archivedAt: null,
              isPrimary: index === 0,
            })
          : repo.create({
              ...scope,
              agencyClientId: client.id,
              companyContactId,
              status: 'active',
              archivedAt: null,
              isPrimary: index === 0,
              createdByUserId: actorUserId,
            }),
      );
    }
  }

  /** Batch projection: a PF must have a live company context AND CRM link. */
  async pendingForClients(clients: AgencyClient[]): Promise<Set<string>> {
    if (!clients.length) return new Set();
    const scope = {
      tenantId: clients[0].tenantId,
      workspaceId: clients[0].workspaceId,
    };
    const people = await this.db.getRepository(ContactEntity).find({
      where: {
        ...scope,
        id: In(clients.flatMap((c) => (c.contactId ? [c.contactId] : []))),
        type: 'person',
      },
    });
    const personIds = new Set(people.map((person) => person.id));
    const candidates = clients.filter(
      (client) => !!client.contactId && personIds.has(client.contactId),
    );
    if (!candidates.length) return new Set();
    const active = await this.db
      .getRepository(AgencyClientCompanyContext)
      .createQueryBuilder('company')
      .innerJoin(
        ContactEntity,
        'org',
        "org.id = company.company_contact_id AND org.tenant_id = company.tenant_id AND org.workspace_id = company.workspace_id AND org.type = 'organization' AND org.status = 'active'",
      )
      .innerJoin(
        AgencyClient,
        'client',
        'client.id = company.agency_client_id AND client.tenant_id = company.tenant_id AND client.workspace_id = company.workspace_id',
      )
      .innerJoin(
        ContactCompanyLinkEntity,
        'link',
        "link.person_contact_id = client.contact_id AND link.company_contact_id = org.id AND link.tenant_id = company.tenant_id AND link.workspace_id = company.workspace_id AND link.status = 'active' AND link.unlinked_at IS NULL",
      )
      .where(
        'company.tenant_id = :tenantId AND company.workspace_id = :workspaceId',
        scope,
      )
      .andWhere('company.agency_client_id IN (:...ids)', {
        ids: candidates.map((c) => c.id),
      })
      .andWhere("company.status = 'active' AND company.archived_at IS NULL")
      .getMany();
    const configured = new Set(active.map((company) => company.agencyClientId));
    return new Set(
      candidates
        .filter((client) => !configured.has(client.id))
        .map((client) => client.id),
    );
  }

  private selectionError(code: string): never {
    throw new UnprocessableEntityException({
      statusCode: 422,
      error: 'Unprocessable Entity',
      code,
      message:
        code === 'client_company_required'
          ? 'Associate at least one company.'
          : 'Select at least one linked company.',
    });
  }
}
