import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { ContactEntity } from '../contacts/entities/contact.entity';
import { ContactListEntity } from '../contacts/entities/contact-list.entity';
import { ContactListMemberEntity } from '../contacts/entities/contact-list-member.entity';
import { CreateContactListDto } from '../contacts/dto/create-contact-list.dto';
import { PatchContactListDto } from '../contacts/dto/patch-contact-list.dto';
import type { RequestContext } from '../../common/context/request-context.interface';
import { CreateContactDto } from '../contacts/dto/create-contact.dto';
import { PatchContactDto } from '../contacts/dto/patch-contact.dto';

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

@Injectable()
export class AgencyContactsService {
  constructor(
    @InjectRepository(ContactEntity, AGENCY_CONNECTION)
    private readonly contactsRepo: Repository<ContactEntity>,

    @InjectRepository(ContactListEntity, AGENCY_CONNECTION)
    private readonly listsRepo: Repository<ContactListEntity>,

    @InjectRepository(ContactListMemberEntity, AGENCY_CONNECTION)
    private readonly listMembersRepo: Repository<ContactListMemberEntity>,
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

    async createContact(ctx: RequestContext, dto: CreateContactDto) {
    const workspaceId = this.requireWorkspaceId(ctx);

    if (dto.companyContactId) {
      await this.ensureContactExists(ctx, dto.companyContactId);
    }

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
      source: dto.source ?? 'manual',
      businessMode: dto.businessMode ?? 'agency_service',
      lifecycleStage: dto.lifecycleStage ?? 'lead',
      status: dto.status ?? 'active',
      ownerUserId: dto.ownerUserId ?? ctx.userId ?? null,
      createdByUserId: ctx.userId ?? null,
      notes: this.optionalString(dto.notes),
    });

    return this.contactsRepo.save(contact);
  }

  async getContact(ctx: RequestContext, contactId: string) {
    return this.findContactOrFail(ctx, contactId);
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
    if (dto.source !== undefined) contact.source = dto.source;
    if (dto.businessMode !== undefined) contact.businessMode = dto.businessMode;
    if (dto.lifecycleStage !== undefined) {
      contact.lifecycleStage = dto.lifecycleStage;
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
      builder.andWhere('contact.lifecycleStage = :lifecycleStage', {
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

    const [items, total] = await builder.getManyAndCount();

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

  async deleteList(ctx: RequestContext, listId: string) {
    const workspaceId = this.requireWorkspaceId(ctx);
    const list = await this.findListOrFail(ctx, listId);

    if (list.isProtected) {
      throw new BadRequestException(
        'This contact list is protected and cannot be deleted.',
      );
    }

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
}
