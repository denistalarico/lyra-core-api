import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  Brackets,
  DataSource,
  In,
  IsNull,
  Not,
  QueryFailedError,
  Repository,
} from 'typeorm';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { ContactCompanyLinkEntity } from '../../contacts/entities/contact-company-link.entity';
import { ContactEntity } from '../../contacts/entities/contact.entity';
import {
  CreateAgencyClientCompanyContextDto,
  UpdateAgencyClientCompanyContextDto,
} from '../dto';
import { AgencyClient, AgencyClientCompanyContext } from '../entities';
import { AgencyClientStatus } from '../enums';

const AGENCY_CONNECTION = 'agency';

export type AgencyClientCompanyProjection = {
  id: string;
  agencyClientId: string;
  company: {
    contactId: string;
    displayName: string;
    legalName: string | null;
    documentType: string | null;
    documentNumber: string | null;
  };
  status: AgencyClientCompanyContext['status'];
  isPrimary: boolean;
};

@Injectable()
export class AgencyClientCompanyContextService {
  constructor(
    @InjectDataSource(AGENCY_CONNECTION)
    private readonly dataSource: DataSource,
    @InjectRepository(AgencyClient, AGENCY_CONNECTION)
    private readonly clientsRepository: Repository<AgencyClient>,
    @InjectRepository(AgencyClientCompanyContext, AGENCY_CONNECTION)
    private readonly contextsRepository: Repository<AgencyClientCompanyContext>,
    @InjectRepository(ContactEntity, AGENCY_CONNECTION)
    private readonly contactsRepository: Repository<ContactEntity>,
    @InjectRepository(ContactCompanyLinkEntity, AGENCY_CONNECTION)
    private readonly companyLinksRepository: Repository<ContactCompanyLinkEntity>,
  ) {}

  async list(
    context: RequestContext,
    agencyClientId: string,
  ): Promise<AgencyClientCompanyProjection[]> {
    await this.findClientOrFail(
      this.clientsRepository,
      context,
      agencyClientId,
    );

    const contexts = await this.contextsRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        agencyClientId,
        status: Not('archived'),
        archivedAt: IsNull(),
      },
      order: { isPrimary: 'DESC', createdAt: 'ASC' },
    });

    return this.projectMany(contexts, this.contactsRepository);
  }

  async listOptions(
    context: RequestContext,
    agencyClientId: string,
    query?: string,
  ) {
    const client = await this.findClientOrFail(
      this.clientsRepository,
      context,
      agencyClientId,
    );
    const normalizedQuery = query?.trim();

    const builder = this.contactsRepository
      .createQueryBuilder('contact')
      .where('contact.tenant_id = :tenantId', { tenantId: context.tenantId })
      .andWhere('contact.workspace_id = :workspaceId', {
        workspaceId: context.workspaceId,
      })
      .andWhere("contact.type = 'organization'")
      .andWhere("contact.status <> 'archived'")
      .orderBy('contact.display_name', 'ASC')
      .take(50);

    if (normalizedQuery) {
      builder.andWhere(
        new Brackets((subQuery) => {
          subQuery
            .where('contact.display_name ILIKE :query', {
              query: `%${normalizedQuery}%`,
            })
            .orWhere('contact.legal_name ILIKE :query', {
              query: `%${normalizedQuery}%`,
            })
            .orWhere('contact.document_number ILIKE :query', {
              query: `%${normalizedQuery}%`,
            });
        }),
      );
    }

    const [companies, existingContexts] = await Promise.all([
      builder.getMany(),
      this.contextsRepository.find({
        where: {
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          agencyClientId,
          status: Not('archived'),
          archivedAt: IsNull(),
        },
      }),
    ]);
    const linkedIds = new Set(
      existingContexts.map((entry) => entry.companyContactId),
    );

    let suggestedIds = new Set<string>();
    if (client.contactId) {
      const person = await this.contactsRepository.findOne({
        where: {
          id: client.contactId,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          type: 'person',
        },
      });

      if (person) {
        const links = await this.companyLinksRepository.find({
          where: {
            tenantId: context.tenantId,
            workspaceId: context.workspaceId,
            personContactId: person.id,
            status: 'active',
          },
        });
        suggestedIds = new Set(links.map((entry) => entry.companyContactId));
      }
    }

    return companies
      .filter((company) => !linkedIds.has(company.id))
      .map((company) => ({
        contactId: company.id,
        displayName: company.displayName,
        legalName: company.legalName,
        documentType: company.documentType,
        documentNumber: company.documentNumber,
        suggested: suggestedIds.has(company.id),
      }))
      .sort(
        (left, right) =>
          Number(right.suggested) - Number(left.suggested) ||
          left.displayName.localeCompare(right.displayName, 'pt-BR'),
      );
  }

  async create(
    context: RequestContext,
    agencyClientId: string,
    dto: CreateAgencyClientCompanyContextDto,
  ): Promise<AgencyClientCompanyProjection> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const clients = manager.getRepository(AgencyClient);
        const contexts = manager.getRepository(AgencyClientCompanyContext);
        const contacts = manager.getRepository(ContactEntity);

        await this.findClientOrFail(clients, context, agencyClientId, true);
        const company = await this.findOrganizationOrFail(
          contacts,
          context,
          dto.companyContactId,
        );
        const duplicate = await contexts.findOne({
          where: { agencyClientId, companyContactId: company.id },
        });
        if (duplicate && duplicate.status !== 'archived') {
          throw new ConflictException(
            'This company is already linked to the client.',
          );
        }

        const activeCount = await contexts.count({
          where: {
            tenantId: context.tenantId,
            workspaceId: context.workspaceId,
            agencyClientId,
            status: 'active',
            archivedAt: IsNull(),
          },
        });
        const isPrimary = activeCount === 0 || dto.isPrimary === true;

        if (isPrimary && activeCount > 0) {
          await this.clearPrimary(contexts, context, agencyClientId);
        }

        const saved = await contexts.save(
          duplicate
            ? Object.assign(duplicate, {
                status: 'active' as const,
                isPrimary,
                archivedAt: null,
              })
            : contexts.create({
                tenantId: context.tenantId,
                workspaceId: context.workspaceId,
                agencyClientId,
                companyContactId: company.id,
                status: 'active',
                isPrimary,
                createdByUserId: context.userId ?? null,
                archivedAt: null,
              }),
        );

        return this.project(saved, company);
      });
    } catch (error) {
      this.rethrowUniqueViolation(error);
    }
  }

  async update(
    context: RequestContext,
    agencyClientId: string,
    contextId: string,
    dto: UpdateAgencyClientCompanyContextDto,
  ): Promise<AgencyClientCompanyProjection> {
    return this.dataSource.transaction(async (manager) => {
      const clients = manager.getRepository(AgencyClient);
      const contexts = manager.getRepository(AgencyClientCompanyContext);
      const contacts = manager.getRepository(ContactEntity);

      await this.findClientOrFail(clients, context, agencyClientId, true);
      const companyContext = await this.findContextOrFail(
        contexts,
        context,
        agencyClientId,
        contextId,
        true,
      );

      if (dto.status && dto.status !== companyContext.status) {
        companyContext.status = dto.status;
        if (dto.status !== 'active') companyContext.isPrimary = false;
        await contexts.save(companyContext);
        await this.ensurePrimary(contexts, context, agencyClientId);
      }

      const refreshed = await this.findContextOrFail(
        contexts,
        context,
        agencyClientId,
        contextId,
      );

      const company = await this.findOrganizationOrFail(
        contacts,
        context,
        refreshed.companyContactId,
      );
      return this.project(refreshed, company);
    });
  }

  async makePrimary(
    context: RequestContext,
    agencyClientId: string,
    contextId: string,
  ): Promise<AgencyClientCompanyProjection> {
    return this.dataSource.transaction(async (manager) => {
      const clients = manager.getRepository(AgencyClient);
      const contexts = manager.getRepository(AgencyClientCompanyContext);
      const contacts = manager.getRepository(ContactEntity);

      await this.findClientOrFail(clients, context, agencyClientId, true);
      const companyContext = await this.findContextOrFail(
        contexts,
        context,
        agencyClientId,
        contextId,
        true,
      );
      if (companyContext.status !== 'active' || companyContext.archivedAt) {
        throw new BadRequestException(
          'Only an active company context can be primary.',
        );
      }

      await this.clearPrimary(contexts, context, agencyClientId);
      companyContext.isPrimary = true;
      const saved = await contexts.save(companyContext);
      const company = await this.findOrganizationOrFail(
        contacts,
        context,
        saved.companyContactId,
      );
      return this.project(saved, company);
    });
  }

  async archive(
    context: RequestContext,
    agencyClientId: string,
    contextId: string,
  ): Promise<AgencyClientCompanyProjection> {
    return this.dataSource.transaction(async (manager) => {
      const clients = manager.getRepository(AgencyClient);
      const contexts = manager.getRepository(AgencyClientCompanyContext);
      const contacts = manager.getRepository(ContactEntity);

      await this.findClientOrFail(clients, context, agencyClientId, true);
      const companyContext = await this.findContextOrFail(
        contexts,
        context,
        agencyClientId,
        contextId,
        true,
      );

      companyContext.status = 'archived';
      companyContext.isPrimary = false;
      companyContext.archivedAt = companyContext.archivedAt ?? new Date();
      const saved = await contexts.save(companyContext);
      await this.ensurePrimary(contexts, context, agencyClientId);

      const company = await this.findOrganizationOrFail(
        contacts,
        context,
        saved.companyContactId,
      );
      return this.project(saved, company);
    });
  }

  private async findClientOrFail(
    repository: Repository<AgencyClient>,
    context: RequestContext,
    agencyClientId: string,
    lock = false,
  ) {
    const client = await repository.findOne({
      where: {
        id: agencyClientId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });

    if (
      !client ||
      client.archivedAt ||
      client.status === AgencyClientStatus.Archived
    ) {
      throw new NotFoundException('Client not found');
    }

    return client;
  }

  private async findOrganizationOrFail(
    repository: Repository<ContactEntity>,
    context: RequestContext,
    contactId: string,
  ) {
    const company = await repository.findOne({
      where: {
        id: contactId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (!company) throw new NotFoundException('Organization contact not found');
    if (company.type !== 'organization') {
      throw new BadRequestException(
        'Company context requires an organization contact.',
      );
    }
    if (company.status === 'archived') {
      throw new BadRequestException(
        'Archived organization contacts cannot be linked.',
      );
    }

    return company;
  }

  private async findContextOrFail(
    repository: Repository<AgencyClientCompanyContext>,
    context: RequestContext,
    agencyClientId: string,
    contextId: string,
    lock = false,
  ) {
    const companyContext = await repository.findOne({
      where: {
        id: contextId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        agencyClientId,
      },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });

    if (!companyContext) {
      throw new NotFoundException('Company context not found');
    }
    return companyContext;
  }

  private clearPrimary(
    repository: Repository<AgencyClientCompanyContext>,
    context: RequestContext,
    agencyClientId: string,
  ) {
    return repository.update(
      {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        agencyClientId,
        status: 'active',
        archivedAt: IsNull(),
      },
      { isPrimary: false },
    );
  }

  private async ensurePrimary(
    repository: Repository<AgencyClientCompanyContext>,
    context: RequestContext,
    agencyClientId: string,
  ) {
    const active = await repository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        agencyClientId,
        status: 'active',
        archivedAt: IsNull(),
      },
      order: { isPrimary: 'DESC', createdAt: 'ASC' },
    });
    if (active.length === 0 || active.some((entry) => entry.isPrimary)) return;

    active[0].isPrimary = true;
    await repository.save(active[0]);
  }

  private async projectMany(
    contexts: AgencyClientCompanyContext[],
    contactsRepository: Repository<ContactEntity>,
  ) {
    if (contexts.length === 0) return [];
    const contacts = await contactsRepository.find({
      where: {
        id: In(contexts.map((entry) => entry.companyContactId)),
        tenantId: contexts[0].tenantId,
        workspaceId: contexts[0].workspaceId,
      },
    });
    const contactsById = new Map(
      contacts.map((contact) => [contact.id, contact]),
    );

    return contexts.flatMap((entry) => {
      const company = contactsById.get(entry.companyContactId);
      return company ? [this.project(entry, company)] : [];
    });
  }

  private project(
    context: AgencyClientCompanyContext,
    company: ContactEntity,
  ): AgencyClientCompanyProjection {
    return {
      id: context.id,
      agencyClientId: context.agencyClientId,
      company: {
        contactId: company.id,
        displayName: company.displayName,
        legalName: company.legalName,
        documentType: company.documentType,
        documentNumber: company.documentNumber,
      },
      status: context.status,
      isPrimary: context.isPrimary,
    };
  }

  private rethrowUniqueViolation(error: unknown): never {
    if (
      error instanceof QueryFailedError &&
      (error.driverError as { code?: string } | undefined)?.code === '23505'
    ) {
      throw new ConflictException(
        'This company is already linked to the client.',
      );
    }
    throw error;
  }
}
