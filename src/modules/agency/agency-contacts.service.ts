import {
  BadRequestException,
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { FilesService } from '../../common/files/files.service';
import { ContactEntity } from '../contacts/entities/contact.entity';
import { ContactListEntity } from '../contacts/entities/contact-list.entity';
import { ContactListMemberEntity } from '../contacts/entities/contact-list-member.entity';
import { CreateContactListDto } from '../contacts/dto/create-contact-list.dto';
import { PatchContactListDto } from '../contacts/dto/patch-contact-list.dto';
import type { RequestContext } from '../../common/context/request-context.interface';
import { CreateContactDto } from '../contacts/dto/create-contact.dto';
import { PatchContactDto } from '../contacts/dto/patch-contact.dto';
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
} from './entities/agency-contact-details.entities';
import {
  CreateAgencyBankDto,
  CreateAgencyContactBankAccountDto,
  CreateAgencyContactIdentificationTypeDto,
  CreateAgencyContactSourceDto,
  UpdateAgencyBankDto,
  UpdateAgencyContactBankAccountDto,
  UpdateAgencyContactIdentificationTypeDto,
  UpdateAgencyContactProfileDto,
  UpdateAgencyContactSourceDto,
} from './dto/agency-contact-details.dto';
import { CreateContactMethodDto } from '../contacts/dto/create-contact-method.dto';
import { PatchContactMethodDto } from '../contacts/dto/patch-contact-method.dto';
import { CreateContactAddressDto } from '../contacts/dto/create-contact-address.dto';
import { PatchContactAddressDto } from '../contacts/dto/patch-contact-address.dto';
import { CreateLeadFlowContactDto } from './dto/create-leadflow-contact.dto';
import { CreateContactTagDto } from '../contacts/dto/create-contact-tag.dto';
import { PatchContactTagDto } from '../contacts/dto/patch-contact-tag.dto';
import { CreateContactSegmentDto } from '../contacts/dto/create-contact-segment.dto';
import { PatchContactSegmentDto } from '../contacts/dto/patch-contact-segment.dto';

const AGENCY_CONNECTION = 'agency';

type ListAgencyContactsQuery = {
  q?: string;
  type?: string;
  status?: string;
  lifecycleStage?: string;
  source?: string;
  listId?: string;
  limit?: string;
  offset?: string;
};

type DeleteListOptions = {
  contactAction?: 'detach' | 'move';
  targetListId?: string;
};

@Injectable()
export class AgencyContactsService {
  constructor(
    @InjectRepository(ContactEntity, AGENCY_CONNECTION)
    private readonly contactsRepo: Repository<ContactEntity>,

    @InjectRepository(ContactListEntity, AGENCY_CONNECTION)
    private readonly listsRepo: Repository<ContactListEntity>,

    @InjectRepository(ContactListMemberEntity, AGENCY_CONNECTION)
    private readonly listMembersRepo: Repository<ContactListMemberEntity>,

    @InjectRepository(ContactMethodEntity, AGENCY_CONNECTION)
    private readonly methodsRepo: Repository<ContactMethodEntity>,

    @InjectRepository(ContactAddressEntity, AGENCY_CONNECTION)
    private readonly addressesRepo: Repository<ContactAddressEntity>,

    @InjectRepository(ContactTagEntity, AGENCY_CONNECTION)
    private readonly tagsRepo: Repository<ContactTagEntity>,

    @InjectRepository(ContactSegmentEntity, AGENCY_CONNECTION)
    private readonly segmentsRepo: Repository<ContactSegmentEntity>,

    @InjectRepository(ContactTagAssignmentEntity, AGENCY_CONNECTION)
    private readonly tagAssignmentsRepo: Repository<ContactTagAssignmentEntity>,

    @InjectRepository(ContactCompanyLinkEntity, AGENCY_CONNECTION)
    private readonly companyLinksRepo: Repository<ContactCompanyLinkEntity>,

    @InjectRepository(AgencyContactProfileEntity, AGENCY_CONNECTION)
    private readonly profilesRepo: Repository<AgencyContactProfileEntity>,

    @InjectRepository(AgencyContactIdentificationTypeEntity, AGENCY_CONNECTION)
    private readonly identificationTypesRepo: Repository<AgencyContactIdentificationTypeEntity>,

    @InjectRepository(AgencyContactSourceEntity, AGENCY_CONNECTION)
    private readonly contactSourcesRepo: Repository<AgencyContactSourceEntity>,

    @InjectRepository(AgencyBankEntity, AGENCY_CONNECTION)
    private readonly banksRepo: Repository<AgencyBankEntity>,

    @InjectRepository(AgencyContactBankAccountEntity, AGENCY_CONNECTION)
    private readonly bankAccountsRepo: Repository<AgencyContactBankAccountEntity>,

    private readonly filesService: FilesService,
  ) {}

  private requireWorkspaceId(ctx: RequestContext) {
    if (!ctx.workspaceId) {
      throw new BadRequestException('Workspace context is required.');
    }

    return ctx.workspaceId;
  }

  private optionalString(value?: string | null) {
    const normalized = value?.trim();

    return normalized ? normalized : null;
  }

  private nullableString(value?: string | null) {
    const normalized = value?.trim();

    return normalized ? normalized : null;
  }

  private normalizeCode(value: string) {
    return value.trim().toUpperCase().replace(/\s+/g, '_');
  }

  private async ensureDefaultIdentificationTypes(ctx: RequestContext) {
    const workspaceId = this.requireWorkspaceId(ctx);

    const defaults = [
      { name: 'CPF', code: 'CPF', position: 10 },
      { name: 'CNPJ', code: 'CNPJ', position: 20 },
      { name: 'EIN', code: 'EIN', position: 30 },
      { name: 'Passaporte', code: 'PASSPORT', position: 40 },
      { name: 'ID', code: 'ID', position: 50 },
    ];

    for (const item of defaults) {
      const existing = await this.identificationTypesRepo.findOne({
        where: {
          tenantId: ctx.tenantId,
          workspaceId,
          code: item.code,
        },
      });

      if (existing) {
        let changed = false;

        if (!existing.isSystem) {
          existing.isSystem = true;
          changed = true;
        }

        if (!existing.isProtected) {
          existing.isProtected = true;
          changed = true;
        }

        if (existing.position !== item.position) {
          existing.position = item.position;
          changed = true;
        }

        if (existing.name !== item.name) {
          existing.name = item.name;
          changed = true;
        }

        if (changed) {
          await this.identificationTypesRepo.save(existing);
        }

        continue;
      }

      await this.identificationTypesRepo.save(
        this.identificationTypesRepo.create({
          tenantId: ctx.tenantId,
          workspaceId,
          name: item.name,
          code: item.code,
          isSystem: true,
          isProtected: true,
          position: item.position,
        }),
      );
    }
  }

  private async ensureDefaultContactSources(ctx: RequestContext) {
    const workspaceId = this.requireWorkspaceId(ctx);

    const defaults = [
      { name: 'Manual', code: 'manual', position: 10 },
      { name: 'WhatsApp', code: 'whatsapp', position: 20 },
      { name: 'Instagram', code: 'instagram', position: 30 },
      { name: 'Facebook', code: 'facebook', position: 40 },
      { name: 'Meta Ads', code: 'meta_ads', position: 50 },
      { name: 'Google Ads', code: 'google_ads', position: 60 },
      { name: 'LinkedIn', code: 'linkedin', position: 70 },
      { name: 'TikTok', code: 'tiktok', position: 80 },
      { name: 'Webchat', code: 'webchat', position: 90 },
      { name: 'Formulário', code: 'form', position: 100 },
      { name: 'Importação', code: 'import', position: 110 },
      { name: 'Indicação', code: 'referral', position: 120 },
      { name: 'E-mail', code: 'email', position: 130 },
      { name: 'Outro', code: 'other', position: 140 },
    ];

    for (const item of defaults) {
      const existing = await this.contactSourcesRepo.findOne({
        where: {
          tenantId: ctx.tenantId,
          workspaceId,
          code: item.code,
        },
      });

      if (existing) {
        let changed = false;

        if (!existing.isSystem) {
          existing.isSystem = true;
          changed = true;
        }

        if (!existing.isProtected) {
          existing.isProtected = true;
          changed = true;
        }

        if (existing.position !== item.position) {
          existing.position = item.position;
          changed = true;
        }

        if (existing.name !== item.name) {
          existing.name = item.name;
          changed = true;
        }

        if (changed) {
          await this.contactSourcesRepo.save(existing);
        }

        continue;
      }

      await this.contactSourcesRepo.save(
        this.contactSourcesRepo.create({
          tenantId: ctx.tenantId,
          workspaceId,
          name: item.name,
          code: item.code,
          isSystem: true,
          isProtected: true,
          position: item.position,
        }),
      );
    }
  }

  async listContactSources(ctx: RequestContext) {
    await this.ensureDefaultContactSources(ctx);

    const workspaceId = this.requireWorkspaceId(ctx);

    return this.contactSourcesRepo.find({
      where: { tenantId: ctx.tenantId, workspaceId },
      order: { position: 'ASC', name: 'ASC' },
    });
  }

  async createContactSource(ctx: RequestContext, dto: CreateAgencyContactSourceDto) {
    const workspaceId = this.requireWorkspaceId(ctx);

    const code = this.normalizeCode(dto.code);

    return this.contactSourcesRepo.save(
      this.contactSourcesRepo.create({
        tenantId: ctx.tenantId,
        workspaceId,
        name: dto.name.trim(),
        code,
        isSystem: false,
        isProtected: false,
        position: 1000,
      }),
    );
  }

  async updateContactSource(
    ctx: RequestContext,
    id: string,
    dto: UpdateAgencyContactSourceDto,
  ) {
    const workspaceId = this.requireWorkspaceId(ctx);

    const item = await this.contactSourcesRepo.findOne({
      where: { id, tenantId: ctx.tenantId, workspaceId },
    });

    if (!item) {
      throw new NotFoundException('Contact source not found.');
    }

    if (item.isProtected) {
      throw new BadRequestException(
        'This contact source is protected and cannot be edited.',
      );
    }

    if (dto.name !== undefined) item.name = dto.name.trim();
    if (dto.code !== undefined) item.code = this.normalizeCode(dto.code);

    return this.contactSourcesRepo.save(item);
  }

  async deleteContactSource(ctx: RequestContext, id: string) {
    const workspaceId = this.requireWorkspaceId(ctx);

    const item = await this.contactSourcesRepo.findOne({
      where: { id, tenantId: ctx.tenantId, workspaceId },
    });

    if (!item) {
      throw new NotFoundException('Contact source not found.');
    }

    if (item.isProtected) {
      throw new BadRequestException(
        'This contact source is protected and cannot be deleted.',
      );
    }

    await this.contactSourcesRepo.delete({
      id,
      tenantId: ctx.tenantId,
      workspaceId,
    });

    return { deleted: true };
  }

  private async ensureValidContactSource(ctx: RequestContext, code: string) {
    await this.ensureDefaultContactSources(ctx);

    const workspaceId = this.requireWorkspaceId(ctx);

    const exists = await this.contactSourcesRepo.findOne({
      where: { tenantId: ctx.tenantId, workspaceId, code },
    });

    if (!exists) {
      throw new BadRequestException(`Unknown contact source: ${code}`);
    }
  }

  async getDefaults(ctx: RequestContext) {
    await this.ensureDefaultIdentificationTypes(ctx);
    await this.ensureDefaultContactSources(ctx);

    const workspaceId = this.requireWorkspaceId(ctx);

    const [identificationTypes, contactSources, tags, segments, banks] =
      await Promise.all([
        this.identificationTypesRepo.find({
          where: { tenantId: ctx.tenantId, workspaceId },
          order: { position: 'ASC', name: 'ASC' },
        }),
        this.contactSourcesRepo.find({
          where: { tenantId: ctx.tenantId, workspaceId },
          order: { position: 'ASC', name: 'ASC' },
        }),
        this.listTags(ctx),
        this.segmentsRepo.find({
          where: { tenantId: ctx.tenantId, workspaceId },
          order: { name: 'ASC' },
        }),
        this.banksRepo.find({
          where: { tenantId: ctx.tenantId, workspaceId },
          order: { name: 'ASC' },
        }),
      ]);

    return {
      identificationTypes,
      contactSources,
      tags,
      segments,
      banks,
      billingChannels: ['email', 'sms', 'whatsapp'],
      currencies: ['BRL', 'ARS', 'USD'],
      languages: ['pt-BR', 'en', 'es'],
      tagColors: [
        '#2563EB',
        '#7C3AED',
        '#16A34A',
        '#F59E0B',
        '#EA580C',
        '#DC2626',
        '#DB2777',
        '#64748B',
        '#0F172A',
        '#FFFFFF',
        '#06B6D4',
        '#84CC16',
        '#4F46E5',
        '#92400E',
        '',
      ],
    };
  }

  private async findContactOrFail(ctx: RequestContext, contactId: string) {
    const workspaceId = this.requireWorkspaceId(ctx);

    const contact = await this.contactsRepo.findOne({
      where: {
        id: contactId,
        tenantId: ctx.tenantId,
        workspaceId,
      },
    });

    if (!contact) {
      throw new NotFoundException('Contact not found.');
    }

    return contact;
  }

  private async ensureContactExists(ctx: RequestContext, contactId: string) {
    await this.findContactOrFail(ctx, contactId);
  }

  private normalizeLimit(value?: string) {
    const parsed = Number(value ?? 50);
    if (!Number.isFinite(parsed)) return 50;
    return Math.min(Math.max(parsed, 1), 100);
  }

  private normalizeOffset(value?: string) {
    const parsed = Number(value ?? 0);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(parsed, 0);
  }

  private async ensureLeadFlowSystemList(ctx: RequestContext) {
    const workspaceId = this.requireWorkspaceId(ctx);

    const existing = await this.listsRepo.findOne({
      where: {
        tenantId: ctx.tenantId,
        workspaceId,
        name: 'LeadFlow',
      },
    });

    if (existing) {
      let changed = false;

      if (!existing.isSystem) {
        existing.isSystem = true;
        changed = true;
      }

      if (!existing.isProtected) {
        existing.isProtected = true;
        changed = true;
      }

      if (existing.sourceProduct !== 'leadflow') {
        existing.sourceProduct = 'leadflow';
        changed = true;
      }

      if (existing.sourceContext !== 'shared_contacts') {
        existing.sourceContext = 'shared_contacts';
        changed = true;
      }

      if (existing.visibility !== 'workspace') {
        existing.visibility = 'workspace';
        changed = true;
      }

      if (existing.parentListId !== null) {
        existing.parentListId = null;
        changed = true;
      }

      return changed ? this.listsRepo.save(existing) : existing;
    }

    const leadFlowList = this.listsRepo.create({
      tenantId: ctx.tenantId,
      workspaceId,
      name: 'LeadFlow',
      description:
        'Lista protegida para contatos compartilhados ou espelhados do Lyra LeadFlow.',
      color: '#2563EB',
      parentListId: null,
      visibility: 'workspace',
      isSystem: true,
      isProtected: true,
      sourceProduct: 'leadflow',
      sourceContext: 'shared_contacts',
      createdByUserId: ctx.userId ?? null,
    });

    return this.listsRepo.save(leadFlowList);
  }

  // Per-client sublist under the "LeadFlow" system list, so each client's
  // contacts stay separated. Idempotent, keyed by sourceContext=client:<id>.
  private async ensureLeadFlowClientList(
    ctx: RequestContext,
    clientId: string,
    clientName?: string | null,
  ) {
    const workspaceId = this.requireWorkspaceId(ctx);
    const parent = await this.ensureLeadFlowSystemList(ctx);
    const sourceContext = `client:${clientId}`;

    const existing = await this.listsRepo.findOne({
      where: {
        tenantId: ctx.tenantId,
        workspaceId,
        parentListId: parent.id,
        sourceContext,
      },
    });

    if (existing) {
      return existing;
    }

    const baseName = (clientName?.trim() || `Cliente ${clientId.slice(0, 8)}`).slice(
      0,
      120,
    );

    const buildList = (name: string) =>
      this.listsRepo.create({
        tenantId: ctx.tenantId,
        workspaceId,
        name,
        description: 'Contatos do LeadFlow deste cliente.',
        color: '#2563EB',
        parentListId: parent.id,
        visibility: 'workspace',
        isSystem: true,
        isProtected: true,
        sourceProduct: 'leadflow',
        sourceContext,
        createdByUserId: ctx.userId ?? null,
      });

    try {
      return await this.listsRepo.save(buildList(baseName));
    } catch {
      // The (workspace, name) uniqueness may collide with another list; fall
      // back to a name suffixed with the client id.
      const suffixed = `${baseName} (${clientId.slice(0, 6)})`.slice(0, 120);
      return this.listsRepo.save(buildList(suffixed));
    }
  }

  private async ensureListMembership(
    ctx: RequestContext,
    listId: string,
    contactId: string,
  ) {
    const workspaceId = this.requireWorkspaceId(ctx);
    const existing = await this.listMembersRepo.findOne({
      where: { tenantId: ctx.tenantId, workspaceId, listId, contactId },
    });

    if (existing) {
      return existing;
    }

    return this.listMembersRepo.save(
      this.listMembersRepo.create({
        tenantId: ctx.tenantId,
        workspaceId,
        listId,
        contactId,
      }),
    );
  }

  async createLeadFlowContact(
    ctx: RequestContext,
    dto: CreateLeadFlowContactDto,
  ) {
    const workspaceId = this.requireWorkspaceId(ctx);

    const contact = await this.contactsRepo.save(
      this.contactsRepo.create({
        tenantId: ctx.tenantId,
        workspaceId,
        type: dto.type,
        displayName: dto.displayName.trim(),
        documentType: this.optionalString(dto.documentType),
        documentNumber: this.optionalString(dto.documentNumber),
        source: 'manual',
        businessMode: 'agency_service',
        lifecycleStage: 'lead',
        lifecycleStages: ['lead'],
        status: 'active',
        ownerUserId: ctx.userId ?? null,
        createdByUserId: ctx.userId ?? null,
      }),
    );

    const methods: Array<Partial<ContactMethodEntity>> = [];
    if (dto.email?.trim()) {
      methods.push({ type: 'email', value: dto.email.trim(), isPrimary: true });
    }
    if (dto.phone?.trim()) {
      methods.push({
        type: 'phone',
        value: dto.phone.trim(),
        label: this.optionalString(dto.phoneLabel),
        isPrimary: true,
      });
    }
    if (dto.website?.trim()) {
      methods.push({ type: 'website', value: dto.website.trim() });
    }

    for (const method of methods) {
      await this.methodsRepo.save(
        this.methodsRepo.create({
          tenantId: ctx.tenantId,
          workspaceId,
          contactId: contact.id,
          ...method,
        }),
      );
    }

    const address = dto.address;
    const hasAddress =
      address &&
      Object.values(address).some(
        (value) => typeof value === 'string' && value.trim(),
      );

    if (hasAddress && address) {
      await this.addressesRepo.save(
        this.addressesRepo.create({
          tenantId: ctx.tenantId,
          workspaceId,
          contactId: contact.id,
          type: 'main',
          street: this.optionalString(address.street ?? undefined),
          number: this.optionalString(address.number ?? undefined),
          complement: this.optionalString(address.complement ?? undefined),
          district: this.optionalString(address.district ?? undefined),
          city: this.optionalString(address.city ?? undefined),
          state: this.optionalString(address.state ?? undefined),
          postalCode: this.optionalString(address.postalCode ?? undefined),
          country: this.optionalString(address.country ?? undefined),
        }),
      );
    }

    const parent = await this.ensureLeadFlowSystemList(ctx);
    await this.ensureListMembership(ctx, parent.id, contact.id);

    if (dto.clientId) {
      const clientList = await this.ensureLeadFlowClientList(
        ctx,
        dto.clientId,
        dto.clientName,
      );
      await this.ensureListMembership(ctx, clientList.id, contact.id);
    }

    return this.getContactDetail(ctx, contact.id);
  }

  async createContact(ctx: RequestContext, dto: CreateContactDto) {
    const workspaceId = this.requireWorkspaceId(ctx);

    if (dto.companyContactId) {
      await this.ensureContactExists(ctx, dto.companyContactId);
    }

    const source = dto.source ?? 'manual';
    await this.ensureValidContactSource(ctx, source);

    const lifecycleStages =
      dto.lifecycleStages && dto.lifecycleStages.length > 0
        ? dto.lifecycleStages
        : [dto.lifecycleStage ?? 'lead'];

    const contact = this.contactsRepo.create({
      tenantId: ctx.tenantId,
      workspaceId,
      type: dto.type,
      displayName: dto.displayName.trim(),
      firstName: this.optionalString(dto.firstName),
      lastName: this.optionalString(dto.lastName),
      legalName: this.optionalString(dto.legalName),
      documentType: this.optionalString(dto.documentType),
      documentNumber: this.optionalString(dto.documentNumber),
      jobTitle: this.optionalString(dto.jobTitle),
      companyContactId: dto.companyContactId ?? null,
      source,
      businessMode: dto.businessMode ?? 'agency_service',
      lifecycleStage: lifecycleStages[0],
      lifecycleStages,
      status: dto.status ?? 'active',
      ownerUserId: dto.ownerUserId ?? ctx.userId ?? null,
      createdByUserId: ctx.userId ?? null,
      notes: this.optionalString(dto.notes),
    });

    const saved = await this.contactsRepo.save(contact);

    if (dto.companyContactId) {
      await this.companyLinksRepo.save(
        this.companyLinksRepo.create({
          tenantId: ctx.tenantId,
          workspaceId,
          personContactId: saved.id,
          companyContactId: dto.companyContactId,
        }),
      );
    }

    return saved;
  }

  async getContact(ctx: RequestContext, contactId: string) {
    return this.findContactOrFail(ctx, contactId);
  }

  async getContactDetail(ctx: RequestContext, contactId: string) {
    const workspaceId = this.requireWorkspaceId(ctx);
    const contact = await this.findContactOrFail(ctx, contactId);

    const [
      profile,
      methods,
      addresses,
      bankAccounts,
      tagAssignments,
      companyLinksAsCompany,
      companyLinksAsPerson,
    ] = await Promise.all([
      this.profilesRepo.findOne({
        where: { tenantId: ctx.tenantId, workspaceId, contactId },
      }),
      this.methodsRepo.find({
        where: { tenantId: ctx.tenantId, workspaceId, contactId },
        order: { isPrimary: 'DESC', createdAt: 'ASC' },
      }),
      this.addressesRepo.find({
        where: { tenantId: ctx.tenantId, workspaceId, contactId },
        order: { createdAt: 'ASC' },
      }),
      this.bankAccountsRepo.find({
        where: { tenantId: ctx.tenantId, workspaceId, contactId },
        order: { createdAt: 'ASC' },
      }),
      this.tagAssignmentsRepo.find({
        where: { tenantId: ctx.tenantId, workspaceId, contactId },
      }),
      this.companyLinksRepo.find({
        where: { tenantId: ctx.tenantId, workspaceId, companyContactId: contactId },
        order: { createdAt: 'ASC' },
      }),
      this.companyLinksRepo.find({
        where: { tenantId: ctx.tenantId, workspaceId, personContactId: contactId },
        order: { createdAt: 'ASC' },
      }),
    ]);

    const relatedContactIds = companyLinksAsCompany.map((link) => link.personContactId);

    const relatedContacts =
      relatedContactIds.length > 0
        ? await this.contactsRepo.find({
            where: {
              tenantId: ctx.tenantId,
              workspaceId,
              id: In(relatedContactIds),
            },
            order: { displayName: 'ASC' },
          })
        : [];

    const relatedCompanyIds = companyLinksAsPerson.map((link) => link.companyContactId);

    const relatedCompanies =
      relatedCompanyIds.length > 0
        ? await this.contactsRepo.find({
            where: {
              tenantId: ctx.tenantId,
              workspaceId,
              id: In(relatedCompanyIds),
            },
            order: { displayName: 'ASC' },
          })
        : [];

    const tagIds = tagAssignments.map((assignment) => assignment.tagId);

    const tags =
      tagIds.length > 0
        ? await this.tagsRepo.find({
            where: {
              tenantId: ctx.tenantId,
              workspaceId,
              id: In(tagIds),
            },
            order: { name: 'ASC' },
          })
        : [];

    const bankIds = bankAccounts
      .map((account) => account.bankId)
      .filter((bankId): bankId is string => Boolean(bankId));

    const banks =
      bankIds.length > 0
        ? await this.banksRepo.find({
            where: {
              tenantId: ctx.tenantId,
              workspaceId,
              id: In(bankIds),
            },
          })
        : [];

    return {
      contact,
      profile,
      methods,
      addresses,
      tags,
      bankAccounts,
      banks,
      relatedContacts,
      relatedCompanies,
    };
  }

  async updateContactProfile(
    ctx: RequestContext,
    contactId: string,
    dto: UpdateAgencyContactProfileDto,
  ) {
    const workspaceId = this.requireWorkspaceId(ctx);

    await this.findContactOrFail(ctx, contactId);

    let profile = await this.profilesRepo.findOne({
      where: {
        tenantId: ctx.tenantId,
        workspaceId,
        contactId,
      },
    });

    if (!profile) {
      profile = this.profilesRepo.create({
        tenantId: ctx.tenantId,
        workspaceId,
        contactId,
        avatarObjectKey: null,
        avatarUrl: null,
        language: null,
        billingChannel: null,
      });
    }

    if (dto.avatarObjectKey !== undefined) {
      profile.avatarObjectKey = this.nullableString(dto.avatarObjectKey);
    }

    if (dto.avatarUrl !== undefined) {
      profile.avatarUrl = this.nullableString(dto.avatarUrl);
    }

    if (dto.language !== undefined) {
      profile.language = this.nullableString(dto.language);
    }

    if (dto.billingChannel !== undefined) {
      profile.billingChannel = dto.billingChannel ?? null;
    }

    return this.profilesRepo.save(profile);
  }

  async uploadContactAvatar(
    ctx: RequestContext,
    contactId: string,
    file: Express.Multer.File,
  ) {
    const workspaceId = this.requireWorkspaceId(ctx);

    await this.findContactOrFail(ctx, contactId);

    const stored = await this.filesService.uploadImageAsset({
      file,
      path: `agency/tenants/${ctx.tenantId}/workspaces/${workspaceId}/contacts/${contactId}/avatar-${Date.now()}.webp`,
      maxDimension: 512,
    });

    return this.updateContactProfile(ctx, contactId, {
      avatarObjectKey: stored.path,
      avatarUrl: stored.url,
    });
  }

  async patchContact(
    ctx: RequestContext,
    contactId: string,
    dto: PatchContactDto,
  ) {
    const contact = await this.findContactOrFail(ctx, contactId);

    if (dto.companyContactId !== undefined && dto.companyContactId !== null) {
      if (dto.companyContactId === contactId) {
        throw new BadRequestException('A contact cannot be its own company.');
      }

      await this.ensureContactExists(ctx, dto.companyContactId);
      contact.companyContactId = dto.companyContactId;
    }

    if (dto.companyContactId === null) {
      contact.companyContactId = null;
    }

    if (dto.type !== undefined) contact.type = dto.type;
    if (dto.displayName !== undefined) {
      contact.displayName = dto.displayName.trim();
    }
    if (dto.firstName !== undefined) {
      contact.firstName = this.nullableString(dto.firstName);
    }
    if (dto.lastName !== undefined) {
      contact.lastName = this.nullableString(dto.lastName);
    }
    if (dto.legalName !== undefined) {
      contact.legalName = this.nullableString(dto.legalName);
    }
    if (dto.documentType !== undefined) {
      contact.documentType = this.nullableString(dto.documentType);
    }
    if (dto.documentNumber !== undefined) {
      contact.documentNumber = this.nullableString(dto.documentNumber);
    }
    if (dto.jobTitle !== undefined) {
      contact.jobTitle = this.nullableString(dto.jobTitle);
    }
    if (dto.source !== undefined) {
      await this.ensureValidContactSource(ctx, dto.source);
      contact.source = dto.source;
    }
    if (dto.businessMode !== undefined) contact.businessMode = dto.businessMode;
    if (dto.lifecycleStages !== undefined) {
      const stages = dto.lifecycleStages.length > 0 ? dto.lifecycleStages : ['lead' as const];
      contact.lifecycleStages = stages;
      contact.lifecycleStage = stages[0];
    } else if (dto.lifecycleStage !== undefined) {
      contact.lifecycleStage = dto.lifecycleStage;
      contact.lifecycleStages = [dto.lifecycleStage];
    }
    if (dto.status !== undefined) contact.status = dto.status;
    if (dto.ownerUserId !== undefined) contact.ownerUserId = dto.ownerUserId;
    if (dto.notes !== undefined) {
      contact.notes = this.nullableString(dto.notes);
    }

    return this.contactsRepo.save(contact);
  }

  async deleteContact(ctx: RequestContext, contactId: string) {
    const contact = await this.findContactOrFail(ctx, contactId);

    contact.status = 'archived';

    return this.contactsRepo.save(contact);
  }

  async permanentlyDeleteContact(ctx: RequestContext, contactId: string) {
    const workspaceId = this.requireWorkspaceId(ctx);
    const contact = await this.findContactOrFail(ctx, contactId);

    await this.contactsRepo.update(
      {
        tenantId: ctx.tenantId,
        workspaceId,
        companyContactId: contact.id,
      },
      { companyContactId: null },
    );

    await Promise.all([
      this.profilesRepo.delete({
        tenantId: ctx.tenantId,
        workspaceId,
        contactId: contact.id,
      }),
      this.methodsRepo.delete({
        tenantId: ctx.tenantId,
        workspaceId,
        contactId: contact.id,
      }),
      this.addressesRepo.delete({
        tenantId: ctx.tenantId,
        workspaceId,
        contactId: contact.id,
      }),
      this.bankAccountsRepo.delete({
        tenantId: ctx.tenantId,
        workspaceId,
        contactId: contact.id,
      }),
      this.tagAssignmentsRepo.delete({
        tenantId: ctx.tenantId,
        workspaceId,
        contactId: contact.id,
      }),
      this.listMembersRepo.delete({
        tenantId: ctx.tenantId,
        workspaceId,
        contactId: contact.id,
      }),
      this.companyLinksRepo.delete({
        tenantId: ctx.tenantId,
        workspaceId,
        personContactId: contact.id,
      }),
      this.companyLinksRepo.delete({
        tenantId: ctx.tenantId,
        workspaceId,
        companyContactId: contact.id,
      }),
    ]);

    await this.contactsRepo.delete({
      id: contact.id,
      tenantId: ctx.tenantId,
      workspaceId,
    });

    return { deleted: true };
  }

  async listContacts(ctx: RequestContext, query: ListAgencyContactsQuery = {}) {
    const workspaceId = this.requireWorkspaceId(ctx);
    const limit = this.normalizeLimit(query.limit);
    const offset = this.normalizeOffset(query.offset);

    const builder = this.contactsRepo
      .createQueryBuilder('contact')
      .where('contact.tenantId = :tenantId', { tenantId: ctx.tenantId })
      .andWhere('contact.workspaceId = :workspaceId', {
        workspaceId,
      })
      .orderBy('contact.updatedAt', 'DESC')
      .take(limit)
      .skip(offset);

    if (query.q?.trim()) {
      builder.andWhere('contact.displayName ILIKE :q', {
        q: `%${query.q.trim()}%`,
      });
    }

    if (query.type) {
      builder.andWhere('contact.type = :type', { type: query.type });
    }

    if (query.status) {
      builder.andWhere('contact.status = :status', { status: query.status });
    }

    if (query.lifecycleStage) {
      builder.andWhere(':lifecycleStage = ANY(contact.lifecycleStages)', {
        lifecycleStage: query.lifecycleStage,
      });
    }

    if (query.source) {
      builder.andWhere('contact.source = :source', { source: query.source });
    }

    if (query.listId) {
      builder.innerJoin(
        ContactListMemberEntity,
        'listMember',
        'listMember.contactId = contact.id AND listMember.listId = :listId',
        { listId: query.listId },
      );
    }

    const [contacts, total] = await builder.getManyAndCount();
    const contactIds = contacts.map((contact) => contact.id);

    if (contactIds.length === 0) {
      return {
        items: [],
        total,
        limit,
        offset,
      };
    }

    const [profiles, methods, tagAssignments] = await Promise.all([
      this.profilesRepo.find({
        where: {
          tenantId: ctx.tenantId,
          workspaceId,
          contactId: In(contactIds),
        },
      }),
      this.methodsRepo.find({
        where: {
          tenantId: ctx.tenantId,
          workspaceId,
          contactId: In(contactIds),
        },
        order: { isPrimary: 'DESC', createdAt: 'ASC' },
      }),
      this.tagAssignmentsRepo.find({
        where: {
          tenantId: ctx.tenantId,
          workspaceId,
          contactId: In(contactIds),
        },
      }),
    ]);

    const tagIds = [...new Set(tagAssignments.map((assignment) => assignment.tagId))];
    const tags =
      tagIds.length > 0
        ? await this.tagsRepo.find({
            where: {
              tenantId: ctx.tenantId,
              workspaceId,
              id: In(tagIds),
            },
            order: { name: 'ASC' },
          })
        : [];

    const profileByContactId = new Map(
      profiles.map((profile) => [profile.contactId, profile]),
    );
    const methodsByContactId = new Map<string, ContactMethodEntity[]>();
    const tagsById = new Map(tags.map((tag) => [tag.id, tag]));
    const tagsByContactId = new Map<string, ContactTagEntity[]>();

    methods.forEach((method) => {
      const current = methodsByContactId.get(method.contactId) ?? [];
      current.push(method);
      methodsByContactId.set(method.contactId, current);
    });

    tagAssignments.forEach((assignment) => {
      const tag = tagsById.get(assignment.tagId);
      if (!tag) return;

      const current = tagsByContactId.get(assignment.contactId) ?? [];
      current.push(tag);
      tagsByContactId.set(assignment.contactId, current);
    });

    const items = contacts.map((contact) => {
      const contactMethods = methodsByContactId.get(contact.id) ?? [];
      const primaryEmail = contactMethods.find(
        (method) => method.type === 'email',
      );
      const primaryPhone =
        contactMethods.find((method) => method.type === 'whatsapp') ??
        contactMethods.find((method) => method.type === 'phone');
      const profile = profileByContactId.get(contact.id);

      return {
        ...contact,
        avatarUrl: profile?.avatarUrl ?? null,
        tags: tagsByContactId.get(contact.id) ?? [],
        primaryEmail: primaryEmail?.value ?? null,
        primaryPhone: primaryPhone?.value ?? null,
      };
    });

    return {
      items,
      total,
      limit,
      offset,
    };
  }

  async listLists(ctx: RequestContext) {
    const workspaceId = this.requireWorkspaceId(ctx);

    await this.ensureLeadFlowSystemList(ctx);

    return this.listsRepo.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId,
      },
      order: {
        name: 'ASC',
      },
    });
  }

  async createList(ctx: RequestContext, dto: CreateContactListDto) {
    const workspaceId = this.requireWorkspaceId(ctx);
    const parentListId = await this.resolveParentListId(
      ctx,
      null,
      dto.parentListId,
    );

    const list = this.listsRepo.create({
      tenantId: ctx.tenantId,
      workspaceId,
      name: dto.name.trim(),
      description: dto.description?.trim() || null,
      color: dto.color ?? '#2563EB',
      parentListId,
      visibility: dto.visibility ?? 'workspace',
      isSystem: false,
      isProtected: false,
      sourceProduct: null,
      sourceContext: null,
      createdByUserId: ctx.userId ?? null,
    });

    return this.listsRepo.save(list);
  }

  async patchList(
    ctx: RequestContext,
    listId: string,
    dto: PatchContactListDto,
  ) {
    const list = await this.findListOrFail(ctx, listId);

    if (list.isProtected) {
      const attemptsToChangeProtectedFields =
        dto.name !== undefined ||
        dto.parentListId !== undefined ||
        dto.visibility !== undefined;

      if (attemptsToChangeProtectedFields) {
        throw new BadRequestException(
          'This contact list is protected and cannot be renamed, moved or have its visibility changed.',
        );
      }
    }

    if (dto.name !== undefined) list.name = dto.name.trim();
    if (dto.description !== undefined) {
      list.description = dto.description?.trim() || null;
    }
    if (dto.color !== undefined) list.color = dto.color;
    if (dto.parentListId !== undefined) {
      list.parentListId = await this.resolveParentListId(
        ctx,
        list.id,
        dto.parentListId,
      );
    }
    if (dto.visibility !== undefined) list.visibility = dto.visibility;

    return this.listsRepo.save(list);
  }

  async deleteList(
    ctx: RequestContext,
    listId: string,
    options: DeleteListOptions = {},
  ) {
    const workspaceId = this.requireWorkspaceId(ctx);
    const list = await this.findListOrFail(ctx, listId);

    if (list.isProtected) {
      throw new BadRequestException(
        'This contact list is protected and cannot be deleted.',
      );
    }

    const members = await this.listMembersRepo.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId,
        listId: list.id,
      },
    });

    if (options.contactAction === 'move') {
      if (!options.targetListId) {
        throw new BadRequestException('Target list is required.');
      }

      if (options.targetListId === list.id) {
        throw new BadRequestException('Target list must be different.');
      }

      await this.findListOrFail(ctx, options.targetListId);

      for (const member of members) {
        const existing = await this.listMembersRepo.findOne({
          where: {
            tenantId: ctx.tenantId,
            workspaceId,
            listId: options.targetListId,
            contactId: member.contactId,
          },
        });

        if (!existing) {
          await this.listMembersRepo.save(
            this.listMembersRepo.create({
              tenantId: ctx.tenantId,
              workspaceId,
              listId: options.targetListId,
              contactId: member.contactId,
              addedByUserId: ctx.userId ?? null,
            }),
          );
        }
      }
    }

    await this.listMembersRepo.delete({
      tenantId: ctx.tenantId,
      workspaceId,
      listId: list.id,
    });

    await this.listsRepo.update(
      {
        tenantId: ctx.tenantId,
        workspaceId,
        parentListId: list.id,
      },
      { parentListId: null },
    );

    await this.listsRepo.delete({
      id: list.id,
      tenantId: ctx.tenantId,
      workspaceId,
    });

    return { deleted: true };
  }

  private async findListOrFail(ctx: RequestContext, listId: string) {
    const workspaceId = this.requireWorkspaceId(ctx);

    const list = await this.listsRepo.findOne({
      where: {
        id: listId,
        tenantId: ctx.tenantId,
        workspaceId,
      },
    });

    if (!list) {
      throw new NotFoundException('Contact list not found.');
    }

    return list;
  }

  private async resolveParentListId(
    ctx: RequestContext,
    currentListId: string | null,
    parentListId?: string | null,
  ) {
    if (!parentListId) return null;

    if (currentListId && parentListId === currentListId) {
      throw new BadRequestException('A list cannot be its own parent.');
    }

    const parent = await this.findListOrFail(ctx, parentListId);

    if (parent.isProtected && parent.sourceProduct === 'leadflow') {
      return parent.id;
    }

    return parent.id;
  }

  async listIdentificationTypes(ctx: RequestContext) {
    await this.ensureDefaultIdentificationTypes(ctx);

    const workspaceId = this.requireWorkspaceId(ctx);

    return this.identificationTypesRepo.find({
      where: { tenantId: ctx.tenantId, workspaceId },
      order: { position: 'ASC', name: 'ASC' },
    });
  }

  async createIdentificationType(
    ctx: RequestContext,
    dto: CreateAgencyContactIdentificationTypeDto,
  ) {
    const workspaceId = this.requireWorkspaceId(ctx);

    const code = this.normalizeCode(dto.code);

    return this.identificationTypesRepo.save(
      this.identificationTypesRepo.create({
        tenantId: ctx.tenantId,
        workspaceId,
        name: dto.name.trim(),
        code,
        isSystem: false,
        isProtected: false,
        position: 100,
      }),
    );
  }

  async updateIdentificationType(
    ctx: RequestContext,
    id: string,
    dto: UpdateAgencyContactIdentificationTypeDto,
  ) {
    const workspaceId = this.requireWorkspaceId(ctx);

    const item = await this.identificationTypesRepo.findOne({
      where: { id, tenantId: ctx.tenantId, workspaceId },
    });

    if (!item) {
      throw new NotFoundException('Identification type not found.');
    }

    if (item.isProtected) {
      throw new BadRequestException(
        'This identification type is protected and cannot be edited.',
      );
    }

    if (dto.name !== undefined) item.name = dto.name.trim();
    if (dto.code !== undefined) item.code = this.normalizeCode(dto.code);

    return this.identificationTypesRepo.save(item);
  }

  async deleteIdentificationType(ctx: RequestContext, id: string) {
    const workspaceId = this.requireWorkspaceId(ctx);

    const item = await this.identificationTypesRepo.findOne({
      where: { id, tenantId: ctx.tenantId, workspaceId },
    });

    if (!item) {
      throw new NotFoundException('Identification type not found.');
    }

    if (item.isProtected) {
      throw new BadRequestException(
        'This identification type is protected and cannot be deleted.',
      );
    }

    await this.identificationTypesRepo.delete({
      id,
      tenantId: ctx.tenantId,
      workspaceId,
    });

    return { deleted: true };
  }

  async listBanks(ctx: RequestContext) {
    const workspaceId = this.requireWorkspaceId(ctx);

    return this.banksRepo.find({
      where: { tenantId: ctx.tenantId, workspaceId },
      order: { name: 'ASC' },
    });
  }

  async createBank(ctx: RequestContext, dto: CreateAgencyBankDto) {
    const workspaceId = this.requireWorkspaceId(ctx);

    return this.banksRepo.save(
      this.banksRepo.create({
        tenantId: ctx.tenantId,
        workspaceId,
        name: dto.name.trim(),
        bicSwift: this.optionalString(dto.bicSwift),
        street: this.optionalString(dto.street),
        number: this.optionalString(dto.number),
        complement: this.optionalString(dto.complement),
        district: this.optionalString(dto.district),
        city: this.optionalString(dto.city),
        state: this.optionalString(dto.state),
        postalCode: this.optionalString(dto.postalCode),
        country: this.optionalString(dto.country),
        phone: this.optionalString(dto.phone),
        email: this.optionalString(dto.email),
      }),
    );
  }

  async updateBank(ctx: RequestContext, id: string, dto: UpdateAgencyBankDto) {
    const workspaceId = this.requireWorkspaceId(ctx);

    const bank = await this.banksRepo.findOne({
      where: { id, tenantId: ctx.tenantId, workspaceId },
    });

    if (!bank) {
      throw new NotFoundException('Bank not found.');
    }

    if (dto.name !== undefined) bank.name = dto.name.trim();
    if (dto.bicSwift !== undefined)
      bank.bicSwift = this.nullableString(dto.bicSwift);
    if (dto.street !== undefined) bank.street = this.nullableString(dto.street);
    if (dto.number !== undefined) bank.number = this.nullableString(dto.number);
    if (dto.complement !== undefined) {
      bank.complement = this.nullableString(dto.complement);
    }
    if (dto.district !== undefined)
      bank.district = this.nullableString(dto.district);
    if (dto.city !== undefined) bank.city = this.nullableString(dto.city);
    if (dto.state !== undefined) bank.state = this.nullableString(dto.state);
    if (dto.postalCode !== undefined) {
      bank.postalCode = this.nullableString(dto.postalCode);
    }
    if (dto.country !== undefined)
      bank.country = this.nullableString(dto.country);
    if (dto.phone !== undefined) bank.phone = this.nullableString(dto.phone);
    if (dto.email !== undefined) bank.email = this.nullableString(dto.email);

    return this.banksRepo.save(bank);
  }

  async deleteBank(ctx: RequestContext, id: string) {
    const workspaceId = this.requireWorkspaceId(ctx);

    await this.banksRepo.delete({
      id,
      tenantId: ctx.tenantId,
      workspaceId,
    });

    return { deleted: true };
  }
  async listBankAccounts(ctx: RequestContext, contactId?: string) {
    const workspaceId = this.requireWorkspaceId(ctx);

    return this.bankAccountsRepo.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId,
        ...(contactId ? { contactId } : {}),
      },
      order: { createdAt: 'DESC' },
    });
  }

  async createBankAccount(
    ctx: RequestContext,
    dto: CreateAgencyContactBankAccountDto,
  ) {
    const workspaceId = this.requireWorkspaceId(ctx);

    await this.findContactOrFail(ctx, dto.contactId);

    if (dto.bankId) {
      await this.findBankOrFail(ctx, dto.bankId);
    }

    return this.bankAccountsRepo.save(
      this.bankAccountsRepo.create({
        tenantId: ctx.tenantId,
        workspaceId,
        contactId: dto.contactId,
        bankId: dto.bankId ?? null,
        accountNumber: dto.accountNumber.trim(),
        agencyNumber: this.optionalString(dto.agencyNumber),
        holderName: dto.holderName.trim(),
        canSendMoney: dto.canSendMoney ?? false,
        currency: dto.currency ?? 'BRL',
        iban: this.optionalString(dto.iban),
        notes: this.optionalString(dto.notes),
      }),
    );
  }

  async updateBankAccount(
    ctx: RequestContext,
    id: string,
    dto: UpdateAgencyContactBankAccountDto,
  ) {
    const workspaceId = this.requireWorkspaceId(ctx);

    const account = await this.bankAccountsRepo.findOne({
      where: { id, tenantId: ctx.tenantId, workspaceId },
    });

    if (!account) {
      throw new NotFoundException('Bank account not found.');
    }

    if (dto.contactId !== undefined) {
      await this.findContactOrFail(ctx, dto.contactId);
      account.contactId = dto.contactId;
    }

    if (dto.bankId !== undefined) {
      if (dto.bankId) {
        await this.findBankOrFail(ctx, dto.bankId);
      }

      account.bankId = dto.bankId ?? null;
    }

    if (dto.accountNumber !== undefined) {
      account.accountNumber = dto.accountNumber.trim();
    }
    if (dto.agencyNumber !== undefined) {
      account.agencyNumber = this.nullableString(dto.agencyNumber);
    }
    if (dto.holderName !== undefined) {
      account.holderName = dto.holderName.trim();
    }
    if (dto.canSendMoney !== undefined) {
      account.canSendMoney = dto.canSendMoney;
    }
    if (dto.currency !== undefined) {
      account.currency = dto.currency;
    }
    if (dto.iban !== undefined) {
      account.iban = this.nullableString(dto.iban);
    }
    if (dto.notes !== undefined) {
      account.notes = this.nullableString(dto.notes);
    }

    return this.bankAccountsRepo.save(account);
  }

  async deleteBankAccount(ctx: RequestContext, id: string) {
    const workspaceId = this.requireWorkspaceId(ctx);

    await this.bankAccountsRepo.delete({
      id,
      tenantId: ctx.tenantId,
      workspaceId,
    });

    return { deleted: true };
  }

  private async findBankOrFail(ctx: RequestContext, bankId: string) {
    const workspaceId = this.requireWorkspaceId(ctx);

    const bank = await this.banksRepo.findOne({
      where: {
        id: bankId,
        tenantId: ctx.tenantId,
        workspaceId,
      },
    });

    if (!bank) {
      throw new NotFoundException('Bank not found.');
    }

    return bank;
  }

  private async clearPrimaryMethods(
    ctx: RequestContext,
    contactId: string,
    type: string,
  ) {
    const workspaceId = this.requireWorkspaceId(ctx);

    await this.methodsRepo.update(
      {
        tenantId: ctx.tenantId,
        workspaceId,
        contactId,
        type: type as any,
        isPrimary: true,
      },
      {
        isPrimary: false,
      },
    );
  }

  async listMethods(ctx: RequestContext, contactId: string) {
    const workspaceId = this.requireWorkspaceId(ctx);

    await this.findContactOrFail(ctx, contactId);

    return this.methodsRepo.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId,
        contactId,
      },
      order: {
        isPrimary: 'DESC',
        createdAt: 'ASC',
      },
    });
  }

  async createMethod(
    ctx: RequestContext,
    contactId: string,
    dto: CreateContactMethodDto,
  ) {
    const workspaceId = this.requireWorkspaceId(ctx);

    await this.findContactOrFail(ctx, contactId);

    if (dto.isPrimary) {
      await this.clearPrimaryMethods(ctx, contactId, dto.type);
    }

    const method = this.methodsRepo.create({
      tenantId: ctx.tenantId,
      workspaceId,
      contactId,
      type: dto.type,
      value: dto.value.trim(),
      label: this.optionalString(dto.label),
      isPrimary: dto.isPrimary ?? false,
    });

    return this.methodsRepo.save(method);
  }

  async patchMethod(
    ctx: RequestContext,
    contactId: string,
    methodId: string,
    dto: PatchContactMethodDto,
  ) {
    const workspaceId = this.requireWorkspaceId(ctx);

    await this.findContactOrFail(ctx, contactId);

    const method = await this.methodsRepo.findOne({
      where: {
        id: methodId,
        tenantId: ctx.tenantId,
        workspaceId,
        contactId,
      },
    });

    if (!method) {
      throw new NotFoundException('Contact method not found.');
    }

    const nextType = dto.type ?? method.type;

    if (dto.isPrimary) {
      await this.clearPrimaryMethods(ctx, contactId, nextType);
    }

    if (dto.type !== undefined) method.type = dto.type;
    if (dto.value !== undefined) method.value = dto.value.trim();
    if (dto.label !== undefined) {
      method.label = this.nullableString(dto.label);
    }
    if (dto.isPrimary !== undefined) method.isPrimary = dto.isPrimary;

    return this.methodsRepo.save(method);
  }

  async deleteMethod(ctx: RequestContext, contactId: string, methodId: string) {
    const workspaceId = this.requireWorkspaceId(ctx);

    await this.findContactOrFail(ctx, contactId);

    await this.methodsRepo.delete({
      id: methodId,
      tenantId: ctx.tenantId,
      workspaceId,
      contactId,
    });

    return { deleted: true };
  }

  async listAddresses(ctx: RequestContext, contactId: string) {
    const workspaceId = this.requireWorkspaceId(ctx);

    await this.findContactOrFail(ctx, contactId);

    return this.addressesRepo.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId,
        contactId,
      },
      order: {
        createdAt: 'ASC',
      },
    });
  }

  async createAddress(
    ctx: RequestContext,
    contactId: string,
    dto: CreateContactAddressDto,
  ) {
    const workspaceId = this.requireWorkspaceId(ctx);

    await this.findContactOrFail(ctx, contactId);

    const address = this.addressesRepo.create({
      tenantId: ctx.tenantId,
      workspaceId,
      contactId,
      type: dto.type ?? 'main',
      street: this.optionalString(dto.street),
      number: this.optionalString(dto.number),
      complement: this.optionalString(dto.complement),
      district: this.optionalString(dto.district),
      city: this.optionalString(dto.city),
      state: this.optionalString(dto.state),
      postalCode: this.optionalString(dto.postalCode),
      country: this.optionalString(dto.country),
    });

    return this.addressesRepo.save(address);
  }

  async patchAddress(
    ctx: RequestContext,
    contactId: string,
    addressId: string,
    dto: PatchContactAddressDto,
  ) {
    const workspaceId = this.requireWorkspaceId(ctx);

    await this.findContactOrFail(ctx, contactId);

    const address = await this.addressesRepo.findOne({
      where: {
        id: addressId,
        tenantId: ctx.tenantId,
        workspaceId,
        contactId,
      },
    });

    if (!address) {
      throw new NotFoundException('Contact address not found.');
    }

    if (dto.type !== undefined) address.type = dto.type;
    if (dto.street !== undefined)
      address.street = this.nullableString(dto.street);
    if (dto.number !== undefined)
      address.number = this.nullableString(dto.number);
    if (dto.complement !== undefined) {
      address.complement = this.nullableString(dto.complement);
    }
    if (dto.district !== undefined) {
      address.district = this.nullableString(dto.district);
    }
    if (dto.city !== undefined) address.city = this.nullableString(dto.city);
    if (dto.state !== undefined) address.state = this.nullableString(dto.state);
    if (dto.postalCode !== undefined) {
      address.postalCode = this.nullableString(dto.postalCode);
    }
    if (dto.country !== undefined) {
      address.country = this.nullableString(dto.country);
    }

    return this.addressesRepo.save(address);
  }

  async deleteAddress(
    ctx: RequestContext,
    contactId: string,
    addressId: string,
  ) {
    const workspaceId = this.requireWorkspaceId(ctx);

    await this.findContactOrFail(ctx, contactId);

    await this.addressesRepo.delete({
      id: addressId,
      tenantId: ctx.tenantId,
      workspaceId,
      contactId,
    });

    return { deleted: true };
  }

  async listTags(ctx: RequestContext) {
    const workspaceId = this.requireWorkspaceId(ctx);

    return this.tagsRepo
      .createQueryBuilder('tag')
      .leftJoin(
        'contact_tag_assignments',
        'assignment',
        'assignment.tag_id = tag.id',
      )
      .where('tag.tenantId = :tenantId', { tenantId: ctx.tenantId })
      .andWhere('tag.workspaceId = :workspaceId', { workspaceId })
      .groupBy('tag.id')
      .orderBy('COUNT(assignment.id)', 'DESC')
      .addOrderBy('tag.name', 'ASC')
      .getMany();
  }

  async createTag(ctx: RequestContext, dto: CreateContactTagDto) {
    const workspaceId = this.requireWorkspaceId(ctx);

    const tag = this.tagsRepo.create({
      tenantId: ctx.tenantId,
      workspaceId,
      name: dto.name.trim(),
      color: dto.color ?? '#64748B',
    });

    try {
      return await this.tagsRepo.save(tag);
    } catch (error) {
      throw new ConflictException(
        'A contact tag with this name already exists.',
      );
    }
  }

  async patchTag(ctx: RequestContext, tagId: string, dto: PatchContactTagDto) {
    const workspaceId = this.requireWorkspaceId(ctx);

    const tag = await this.tagsRepo.findOne({
      where: {
        id: tagId,
        tenantId: ctx.tenantId,
        workspaceId,
      },
    });

    if (!tag) {
      throw new NotFoundException('Contact tag not found.');
    }

    if (dto.name !== undefined) tag.name = dto.name.trim();
    if (dto.color !== undefined) tag.color = dto.color;

    return this.tagsRepo.save(tag);
  }

  async deleteTag(ctx: RequestContext, tagId: string) {
    const workspaceId = this.requireWorkspaceId(ctx);

    await this.tagsRepo.delete({
      id: tagId,
      tenantId: ctx.tenantId,
      workspaceId,
    });

    return { deleted: true };
  }

  async addTagToContact(ctx: RequestContext, contactId: string, tagId: string) {
    const workspaceId = this.requireWorkspaceId(ctx);

    await this.findContactOrFail(ctx, contactId);

    const tag = await this.tagsRepo.findOne({
      where: {
        id: tagId,
        tenantId: ctx.tenantId,
        workspaceId,
      },
    });

    if (!tag) {
      throw new NotFoundException('Contact tag not found.');
    }

    const existing = await this.tagAssignmentsRepo.findOne({
      where: {
        tenantId: ctx.tenantId,
        workspaceId,
        contactId,
        tagId,
      },
    });

    if (existing) {
      return existing;
    }

    const assignment = this.tagAssignmentsRepo.create({
      tenantId: ctx.tenantId,
      workspaceId,
      contactId,
      tagId,
    });

    return this.tagAssignmentsRepo.save(assignment);
  }

  async removeTagFromContact(
    ctx: RequestContext,
    contactId: string,
    tagId: string,
  ) {
    const workspaceId = this.requireWorkspaceId(ctx);

    await this.findContactOrFail(ctx, contactId);

    await this.tagAssignmentsRepo.delete({
      tenantId: ctx.tenantId,
      workspaceId,
      contactId,
      tagId,
    });

    return { deleted: true };
  }

  private async syncPrimaryCompany(
    ctx: RequestContext,
    personContactId: string,
  ) {
    const workspaceId = this.requireWorkspaceId(ctx);

    const remainingLinks = await this.companyLinksRepo.find({
      where: { tenantId: ctx.tenantId, workspaceId, personContactId },
      order: { createdAt: 'ASC' },
    });

    await this.contactsRepo.update(
      { id: personContactId, tenantId: ctx.tenantId, workspaceId },
      { companyContactId: remainingLinks[0]?.companyContactId ?? null },
    );
  }

  async addCompanyLink(
    ctx: RequestContext,
    personContactId: string,
    companyContactId: string,
  ) {
    const workspaceId = this.requireWorkspaceId(ctx);

    if (personContactId === companyContactId) {
      throw new BadRequestException('A contact cannot be its own company.');
    }

    await this.findContactOrFail(ctx, personContactId);
    await this.findContactOrFail(ctx, companyContactId);

    const existing = await this.companyLinksRepo.findOne({
      where: {
        tenantId: ctx.tenantId,
        workspaceId,
        personContactId,
        companyContactId,
      },
    });

    if (!existing) {
      await this.companyLinksRepo.save(
        this.companyLinksRepo.create({
          tenantId: ctx.tenantId,
          workspaceId,
          personContactId,
          companyContactId,
        }),
      );

      await this.syncPrimaryCompany(ctx, personContactId);
    }

    return { linked: true };
  }

  async removeCompanyLink(
    ctx: RequestContext,
    personContactId: string,
    companyContactId: string,
  ) {
    const workspaceId = this.requireWorkspaceId(ctx);

    await this.findContactOrFail(ctx, personContactId);

    await this.companyLinksRepo.delete({
      tenantId: ctx.tenantId,
      workspaceId,
      personContactId,
      companyContactId,
    });

    await this.syncPrimaryCompany(ctx, personContactId);

    return { deleted: true };
  }

  async listSegments(ctx: RequestContext) {
    const workspaceId = this.requireWorkspaceId(ctx);

    return this.segmentsRepo.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId,
      },
      order: {
        name: 'ASC',
      },
    });
  }

  async createSegment(ctx: RequestContext, dto: CreateContactSegmentDto) {
    const workspaceId = this.requireWorkspaceId(ctx);

    const segment = this.segmentsRepo.create({
      tenantId: ctx.tenantId,
      workspaceId,
      name: dto.name.trim(),
      description: this.optionalString(dto.description),
      rulesJson: dto.rulesJson ?? {},
      createdByUserId: ctx.userId ?? null,
    });

    try {
      return await this.segmentsRepo.save(segment);
    } catch (error) {
      throw new ConflictException(
        'A contact segment with this name already exists.',
      );
    }
  }

  async patchSegment(
    ctx: RequestContext,
    segmentId: string,
    dto: PatchContactSegmentDto,
  ) {
    const workspaceId = this.requireWorkspaceId(ctx);

    const segment = await this.segmentsRepo.findOne({
      where: {
        id: segmentId,
        tenantId: ctx.tenantId,
        workspaceId,
      },
    });

    if (!segment) {
      throw new NotFoundException('Contact segment not found.');
    }

    if (dto.name !== undefined) segment.name = dto.name.trim();
    if (dto.description !== undefined) {
      segment.description = this.nullableString(dto.description);
    }
    if (dto.rulesJson !== undefined) {
      segment.rulesJson = dto.rulesJson;
    }

    return this.segmentsRepo.save(segment);
  }

  async deleteSegment(ctx: RequestContext, segmentId: string) {
    const workspaceId = this.requireWorkspaceId(ctx);

    await this.segmentsRepo.delete({
      id: segmentId,
      tenantId: ctx.tenantId,
      workspaceId,
    });

    return { deleted: true };
  }
}
