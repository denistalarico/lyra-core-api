import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { RequestContext } from '../../common/context/request-context.interface';
import { AddContactListMemberDto } from './dto/add-contact-list-member.dto';
import { CreateContactBusinessModeDto } from './dto/create-contact-business-mode.dto';
import { CreateContactCustomFieldDto } from './dto/create-contact-custom-field.dto';
import { CreateContactSegmentDto } from './dto/create-contact-segment.dto';
import { PatchContactBusinessModeDto } from './dto/patch-contact-business-mode.dto';
import { PatchContactCustomFieldDto } from './dto/patch-contact-custom-field.dto';
import { PatchContactSegmentDto } from './dto/patch-contact-segment.dto';
import { UpsertContactCustomFieldValueDto } from './dto/upsert-contact-custom-field-value.dto';
import { UpsertContactViewPreferenceDto } from './dto/upsert-contact-view-preference.dto';
import { CreateContactAddressDto } from './dto/create-contact-address.dto';
import { CreateContactListDto } from './dto/create-contact-list.dto';
import { CreateContactMethodDto } from './dto/create-contact-method.dto';
import { CreateContactTagDto } from './dto/create-contact-tag.dto';
import { CreateContactDto } from './dto/create-contact.dto';
import { PatchContactAddressDto } from './dto/patch-contact-address.dto';
import { PatchContactListDto } from './dto/patch-contact-list.dto';
import { PatchContactMethodDto } from './dto/patch-contact-method.dto';
import { PatchContactTagDto } from './dto/patch-contact-tag.dto';
import { PatchContactDto } from './dto/patch-contact.dto';
import { ContactBusinessModeEntity } from './entities/contact-business-mode.entity';
import { ContactCustomFieldValueEntity } from './entities/contact-custom-field-value.entity';
import { ContactCustomFieldEntity } from './entities/contact-custom-field.entity';
import { ContactSegmentEntity } from './entities/contact-segment.entity';
import { ContactViewPreferenceEntity } from './entities/contact-view-preference.entity';
import { ContactAddressEntity } from './entities/contact-address.entity';
import { ContactListMemberEntity } from './entities/contact-list-member.entity';
import { ContactListEntity } from './entities/contact-list.entity';
import { ContactMethodEntity } from './entities/contact-method.entity';
import { ContactTagAssignmentEntity } from './entities/contact-tag-assignment.entity';
import { ContactTagEntity } from './entities/contact-tag.entity';
import { ContactEntity } from './entities/contact.entity';

type ListContactsFilters = {
  q?: string;
  type?: string;
  status?: string;
  lifecycleStage?: string;
  source?: string;
  listId?: string;
  tagId?: string;
  limit?: string;
  offset?: string;
};

@Injectable()
export class ContactsService {
  constructor(
    @InjectRepository(ContactEntity)
    private readonly contactsRepository: Repository<ContactEntity>,

    @InjectRepository(ContactMethodEntity)
    private readonly contactMethodsRepository: Repository<ContactMethodEntity>,

    @InjectRepository(ContactAddressEntity)
    private readonly contactAddressesRepository: Repository<ContactAddressEntity>,

    @InjectRepository(ContactListEntity)
    private readonly contactListsRepository: Repository<ContactListEntity>,

    @InjectRepository(ContactListMemberEntity)
    private readonly contactListMembersRepository: Repository<ContactListMemberEntity>,

    @InjectRepository(ContactTagEntity)
    private readonly contactTagsRepository: Repository<ContactTagEntity>,

    @InjectRepository(ContactTagAssignmentEntity)
    private readonly contactTagAssignmentsRepository: Repository<ContactTagAssignmentEntity>,

    @InjectRepository(ContactCustomFieldEntity)
    private readonly contactCustomFieldsRepository: Repository<ContactCustomFieldEntity>,

    @InjectRepository(ContactCustomFieldValueEntity)
    private readonly contactCustomFieldValuesRepository: Repository<ContactCustomFieldValueEntity>,

    @InjectRepository(ContactSegmentEntity)
    private readonly contactSegmentsRepository: Repository<ContactSegmentEntity>,

    @InjectRepository(ContactBusinessModeEntity)
    private readonly contactBusinessModesRepository: Repository<ContactBusinessModeEntity>,

    @InjectRepository(ContactViewPreferenceEntity)
    private readonly contactViewPreferencesRepository: Repository<ContactViewPreferenceEntity>,
  ) {}

  async listContacts(ctx: RequestContext, filters: ListContactsFilters = {}) {
    const workspaceId = this.requireWorkspaceId(ctx);

    const limit = this.normalizeLimit(filters.limit);
    const offset = this.normalizeOffset(filters.offset);

    const query = this.contactsRepository
      .createQueryBuilder('contact')
      .where('contact.tenantId = :tenantId', { tenantId: ctx.tenantId })
      .andWhere('contact.workspaceId = :workspaceId', { workspaceId })
      .orderBy('contact.updatedAt', 'DESC')
      .take(limit)
      .skip(offset);

    if (filters.q) {
      query.andWhere('contact.displayName ILIKE :q', {
        q: `%${filters.q.trim()}%`,
      });
    }

    if (filters.type) {
      query.andWhere('contact.type = :type', { type: filters.type });
    }

    if (filters.status) {
      query.andWhere('contact.status = :status', { status: filters.status });
    }

    if (filters.lifecycleStage) {
      query.andWhere('contact.lifecycleStage = :lifecycleStage', {
        lifecycleStage: filters.lifecycleStage,
      });
    }

    if (filters.source) {
      query.andWhere('contact.source = :source', { source: filters.source });
    }

    if (filters.listId) {
      query.innerJoin(
        ContactListMemberEntity,
        'listMember',
        'listMember.contactId = contact.id AND listMember.listId = :listId',
        { listId: filters.listId },
      );
    }

    if (filters.tagId) {
      query.innerJoin(
        ContactTagAssignmentEntity,
        'tagAssignment',
        'tagAssignment.contactId = contact.id AND tagAssignment.tagId = :tagId',
        { tagId: filters.tagId },
      );
    }

    const [items, total] = await query.getManyAndCount();

    return {
      items,
      total,
      limit,
      offset,
    };
  }

  async createContact(ctx: RequestContext, dto: CreateContactDto) {
    const workspaceId = this.requireWorkspaceId(ctx);

    if (dto.companyContactId) {
      await this.ensureContactExists(ctx, dto.companyContactId);
    }

    const contact = this.contactsRepository.create({
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
      businessMode: dto.businessMode ?? 'general',
      lifecycleStage: dto.lifecycleStage ?? 'lead',
      status: dto.status ?? 'active',
      ownerUserId: dto.ownerUserId ?? ctx.userId ?? null,
      createdByUserId: ctx.userId ?? null,
      notes: this.optionalString(dto.notes),
    });

    return this.contactsRepository.save(contact);
  }

  async getContact(ctx: RequestContext, contactId: string) {
    const contact = await this.findContactOrFail(ctx, contactId);

    const [
      methods,
      addresses,
      listMemberships,
      tagAssignments,
      customFieldValues,
    ] = await Promise.all([
      this.contactMethodsRepository.find({
        where: {
          tenantId: ctx.tenantId,
          workspaceId: contact.workspaceId,
          contactId,
        },
        order: { isPrimary: 'DESC', createdAt: 'ASC' },
      }),
      this.contactAddressesRepository.find({
        where: {
          tenantId: ctx.tenantId,
          workspaceId: contact.workspaceId,
          contactId,
        },
        order: { createdAt: 'ASC' },
      }),
      this.contactListMembersRepository.find({
        where: {
          tenantId: ctx.tenantId,
          workspaceId: contact.workspaceId,
          contactId,
        },
        order: { addedAt: 'DESC' },
      }),
      this.contactTagAssignmentsRepository.find({
        where: {
          tenantId: ctx.tenantId,
          workspaceId: contact.workspaceId,
          contactId,
        },
        order: { createdAt: 'DESC' },
      }),
      this.contactCustomFieldValuesRepository.find({
        where: {
          tenantId: ctx.tenantId,
          workspaceId: contact.workspaceId,
          contactId,
        },
        order: { createdAt: 'ASC' },
      }),
    ]);

    return {
      ...contact,
      methods,
      addresses,
      listMemberships,
      tagAssignments,
      customFieldValues,
    };
  }

  async patchContact(ctx: RequestContext, contactId: string, dto: PatchContactDto) {
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
    if (dto.displayName !== undefined) contact.displayName = dto.displayName.trim();
    if (dto.firstName !== undefined) contact.firstName = this.nullableString(dto.firstName);
    if (dto.lastName !== undefined) contact.lastName = this.nullableString(dto.lastName);
    if (dto.legalName !== undefined) contact.legalName = this.nullableString(dto.legalName);
    if (dto.documentType !== undefined) {
      contact.documentType = this.nullableString(dto.documentType);
    }
    if (dto.documentNumber !== undefined) {
      contact.documentNumber = this.nullableString(dto.documentNumber);
    }
    if (dto.jobTitle !== undefined) contact.jobTitle = this.nullableString(dto.jobTitle);
    if (dto.source !== undefined) contact.source = dto.source;
    if (dto.businessMode !== undefined) contact.businessMode = dto.businessMode;
    if (dto.lifecycleStage !== undefined) contact.lifecycleStage = dto.lifecycleStage;
    if (dto.status !== undefined) contact.status = dto.status;
    if (dto.ownerUserId !== undefined) contact.ownerUserId = dto.ownerUserId;
    if (dto.notes !== undefined) contact.notes = this.nullableString(dto.notes);

    return this.contactsRepository.save(contact);
  }

  async deleteContact(ctx: RequestContext, contactId: string) {
    const contact = await this.findContactOrFail(ctx, contactId);

    contact.status = 'archived';

    return this.contactsRepository.save(contact);
  }

  async createMethod(
    ctx: RequestContext,
    contactId: string,
    dto: CreateContactMethodDto,
  ) {
    const contact = await this.findContactOrFail(ctx, contactId);

    if (dto.isPrimary) {
      await this.clearPrimaryMethods(ctx, contactId, dto.type);
    }

    const method = this.contactMethodsRepository.create({
      tenantId: ctx.tenantId,
      workspaceId: contact.workspaceId,
      contactId,
      type: dto.type,
      value: dto.value.trim(),
      label: this.optionalString(dto.label),
      isPrimary: dto.isPrimary ?? false,
    });

    return this.contactMethodsRepository.save(method);
  }

  async patchMethod(
    ctx: RequestContext,
    contactId: string,
    methodId: string,
    dto: PatchContactMethodDto,
  ) {
    await this.findContactOrFail(ctx, contactId);

    const method = await this.contactMethodsRepository.findOne({
      where: {
        id: methodId,
        tenantId: ctx.tenantId,
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
    if (dto.label !== undefined) method.label = this.nullableString(dto.label);
    if (dto.isPrimary !== undefined) method.isPrimary = dto.isPrimary;

    return this.contactMethodsRepository.save(method);
  }

  async deleteMethod(ctx: RequestContext, contactId: string, methodId: string) {
    await this.findContactOrFail(ctx, contactId);

    const result = await this.contactMethodsRepository.delete({
      id: methodId,
      tenantId: ctx.tenantId,
      contactId,
    });

    if (!result.affected) {
      throw new NotFoundException('Contact method not found.');
    }

    return { deleted: true };
  }

  async createAddress(
    ctx: RequestContext,
    contactId: string,
    dto: CreateContactAddressDto,
  ) {
    const contact = await this.findContactOrFail(ctx, contactId);

    const address = this.contactAddressesRepository.create({
      tenantId: ctx.tenantId,
      workspaceId: contact.workspaceId,
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

    return this.contactAddressesRepository.save(address);
  }

  async patchAddress(
    ctx: RequestContext,
    contactId: string,
    addressId: string,
    dto: PatchContactAddressDto,
  ) {
    await this.findContactOrFail(ctx, contactId);

    const address = await this.contactAddressesRepository.findOne({
      where: {
        id: addressId,
        tenantId: ctx.tenantId,
        contactId,
      },
    });

    if (!address) {
      throw new NotFoundException('Contact address not found.');
    }

    if (dto.type !== undefined) address.type = dto.type;
    if (dto.street !== undefined) address.street = this.nullableString(dto.street);
    if (dto.number !== undefined) address.number = this.nullableString(dto.number);
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

    return this.contactAddressesRepository.save(address);
  }

  async deleteAddress(ctx: RequestContext, contactId: string, addressId: string) {
    await this.findContactOrFail(ctx, contactId);

    const result = await this.contactAddressesRepository.delete({
      id: addressId,
      tenantId: ctx.tenantId,
      contactId,
    });

    if (!result.affected) {
      throw new NotFoundException('Contact address not found.');
    }

    return { deleted: true };
  }

  async listLists(ctx: RequestContext) {
    const workspaceId = this.requireWorkspaceId(ctx);

    return this.contactListsRepository.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId,
      },
      order: { name: 'ASC' },
    });
  }

  async createList(ctx: RequestContext, dto: CreateContactListDto) {
    const workspaceId = this.requireWorkspaceId(ctx);

    const list = this.contactListsRepository.create({
      tenantId: ctx.tenantId,
      workspaceId,
      name: dto.name.trim(),
      description: this.optionalString(dto.description),
      color: dto.color ?? '#2563EB',
      visibility: dto.visibility ?? 'workspace',
      createdByUserId: ctx.userId ?? null,
    });

    try {
      return await this.contactListsRepository.save(list);
    } catch (error) {
      this.throwConflictIfUniqueViolation(error, 'A contact list with this name already exists.');
      throw error;
    }
  }

  async patchList(ctx: RequestContext, listId: string, dto: PatchContactListDto) {
    const list = await this.findListOrFail(ctx, listId);

    if (dto.name !== undefined) list.name = dto.name.trim();
    if (dto.description !== undefined) {
      list.description = this.nullableString(dto.description);
    }
    if (dto.color !== undefined) list.color = dto.color;
    if (dto.visibility !== undefined) list.visibility = dto.visibility;

    try {
      return await this.contactListsRepository.save(list);
    } catch (error) {
      this.throwConflictIfUniqueViolation(error, 'A contact list with this name already exists.');
      throw error;
    }
  }

  async deleteList(ctx: RequestContext, listId: string) {
    const list = await this.findListOrFail(ctx, listId);

    await this.contactListsRepository.delete({
      id: list.id,
      tenantId: ctx.tenantId,
      workspaceId: list.workspaceId,
    });

    return { deleted: true };
  }

  async addListMember(
    ctx: RequestContext,
    listId: string,
    dto: AddContactListMemberDto,
  ) {
    const list = await this.findListOrFail(ctx, listId);
    await this.findContactOrFail(ctx, dto.contactId);

    const member = this.contactListMembersRepository.create({
      tenantId: ctx.tenantId,
      workspaceId: list.workspaceId,
      listId,
      contactId: dto.contactId,
      addedByUserId: ctx.userId ?? null,
    });

    try {
      return await this.contactListMembersRepository.save(member);
    } catch (error) {
      this.throwConflictIfUniqueViolation(error, 'This contact is already in this list.');
      throw error;
    }
  }

  async removeListMember(ctx: RequestContext, listId: string, contactId: string) {
    await this.findListOrFail(ctx, listId);

    const result = await this.contactListMembersRepository.delete({
      tenantId: ctx.tenantId,
      listId,
      contactId,
    });

    if (!result.affected) {
      throw new NotFoundException('Contact list member not found.');
    }

    return { deleted: true };
  }

  async listTags(ctx: RequestContext) {
    const workspaceId = this.requireWorkspaceId(ctx);

    return this.contactTagsRepository.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId,
      },
      order: { name: 'ASC' },
    });
  }

  async createTag(ctx: RequestContext, dto: CreateContactTagDto) {
    const workspaceId = this.requireWorkspaceId(ctx);

    const tag = this.contactTagsRepository.create({
      tenantId: ctx.tenantId,
      workspaceId,
      name: dto.name.trim(),
      color: dto.color ?? '#64748B',
    });

    try {
      return await this.contactTagsRepository.save(tag);
    } catch (error) {
      this.throwConflictIfUniqueViolation(error, 'A contact tag with this name already exists.');
      throw error;
    }
  }

  async patchTag(ctx: RequestContext, tagId: string, dto: PatchContactTagDto) {
    const tag = await this.findTagOrFail(ctx, tagId);

    if (dto.name !== undefined) tag.name = dto.name.trim();
    if (dto.color !== undefined) tag.color = dto.color;

    try {
      return await this.contactTagsRepository.save(tag);
    } catch (error) {
      this.throwConflictIfUniqueViolation(error, 'A contact tag with this name already exists.');
      throw error;
    }
  }

  async deleteTag(ctx: RequestContext, tagId: string) {
    const tag = await this.findTagOrFail(ctx, tagId);

    await this.contactTagsRepository.delete({
      id: tag.id,
      tenantId: ctx.tenantId,
      workspaceId: tag.workspaceId,
    });

    return { deleted: true };
  }

  async assignTag(ctx: RequestContext, contactId: string, tagId: string) {
    const contact = await this.findContactOrFail(ctx, contactId);
    await this.findTagOrFail(ctx, tagId);

    const assignment = this.contactTagAssignmentsRepository.create({
      tenantId: ctx.tenantId,
      workspaceId: contact.workspaceId,
      contactId,
      tagId,
    });

    try {
      return await this.contactTagAssignmentsRepository.save(assignment);
    } catch (error) {
      this.throwConflictIfUniqueViolation(error, 'This tag is already assigned to this contact.');
      throw error;
    }
  }

  async removeTag(ctx: RequestContext, contactId: string, tagId: string) {
    await this.findContactOrFail(ctx, contactId);

    const result = await this.contactTagAssignmentsRepository.delete({
      tenantId: ctx.tenantId,
      contactId,
      tagId,
    });

    if (!result.affected) {
      throw new NotFoundException('Contact tag assignment not found.');
    }

    return { deleted: true };
  }



  getImportTemplateCsv() {
    return this.buildCsv([
      [
        'type',
        'displayName',
        'firstName',
        'lastName',
        'legalName',
        'jobTitle',
        'email',
        'phone',
        'whatsapp',
        'source',
        'businessMode',
        'lifecycleStage',
        'status',
        'notes',
      ],
      [
        'person',
        'Maria Silva',
        'Maria',
        'Silva',
        '',
        'Gerente',
        'maria@email.com',
        '+551633333333',
        '+5516999999999',
        'manual',
        'general',
        'lead',
        'active',
        'Exemplo de contato pessoa',
      ],
      [
        'organization',
        'Empresa Exemplo LTDA',
        '',
        '',
        'Empresa Exemplo LTDA',
        '',
        'contato@empresa.com',
        '+551633333334',
        '',
        'manual',
        'service_quote',
        'prospect',
        'active',
        'Exemplo de contato empresa',
      ],
    ]);
  }

  async exportContactsCsv(ctx: RequestContext) {
    const workspaceId = this.requireWorkspaceId(ctx);

    const contacts = await this.contactsRepository.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId,
      },
      order: { createdAt: 'DESC' },
      take: 10000,
    });

    const contactIds = contacts.map((contact) => contact.id);

    const methods =
      contactIds.length > 0
        ? await this.contactMethodsRepository
            .createQueryBuilder('method')
            .where('method.tenantId = :tenantId', { tenantId: ctx.tenantId })
            .andWhere('method.workspaceId = :workspaceId', { workspaceId })
            .andWhere('method.contactId IN (:...contactIds)', { contactIds })
            .orderBy('method.isPrimary', 'DESC')
            .addOrderBy('method.createdAt', 'ASC')
            .getMany()
        : [];

    const methodMap = new Map<
      string,
      { email?: string; phone?: string; whatsapp?: string }
    >();

    for (const method of methods) {
      const current = methodMap.get(method.contactId) ?? {};

      if (method.type === 'email' && !current.email) {
        current.email = method.value;
      }

      if (method.type === 'phone' && !current.phone) {
        current.phone = method.value;
      }

      if (method.type === 'whatsapp' && !current.whatsapp) {
        current.whatsapp = method.value;
      }

      methodMap.set(method.contactId, current);
    }

    const rows = [
      [
        'id',
        'type',
        'displayName',
        'firstName',
        'lastName',
        'legalName',
        'jobTitle',
        'email',
        'phone',
        'whatsapp',
        'source',
        'businessMode',
        'lifecycleStage',
        'status',
        'notes',
        'createdAt',
        'updatedAt',
      ],
      ...contacts.map((contact) => {
        const mappedMethods = methodMap.get(contact.id) ?? {};

        return [
          contact.id,
          contact.type,
          contact.displayName,
          contact.firstName ?? '',
          contact.lastName ?? '',
          contact.legalName ?? '',
          contact.jobTitle ?? '',
          mappedMethods.email ?? '',
          mappedMethods.phone ?? '',
          mappedMethods.whatsapp ?? '',
          contact.source,
          contact.businessMode,
          contact.lifecycleStage,
          contact.status,
          contact.notes ?? '',
          contact.createdAt.toISOString(),
          contact.updatedAt.toISOString(),
        ];
      }),
    ];

    return this.buildCsv(rows);
  }

  async importContactsCsv(
    ctx: RequestContext,
    file: { originalname: string; mimetype?: string; buffer: Buffer; size: number },
  ) {
    const workspaceId = this.requireWorkspaceId(ctx);

    if (!file) {
      throw new BadRequestException('CSV file is required.');
    }

    if (!file.originalname.toLowerCase().endsWith('.csv')) {
      throw new BadRequestException('Only CSV files are allowed.');
    }

    if (!file.buffer || file.size <= 0) {
      throw new BadRequestException('CSV file is empty.');
    }

    const content = file.buffer.toString('utf8').replace(/^\uFEFF/, '');
    const rows = this.parseCsv(content);

    if (rows.length < 2) {
      throw new BadRequestException('CSV must have a header and at least one row.');
    }

    const headers = rows[0].map((header) => header.trim());
    const dataRows = rows.slice(1).filter((row) =>
      row.some((value) => value.trim().length > 0),
    );

    const created: ContactEntity[] = [];
    const errors: Array<{ row: number; message: string }> = [];

    for (let index = 0; index < dataRows.length; index++) {
      const rowNumber = index + 2;
      const row = dataRows[index];
      const record = this.mapCsvRow(headers, row);

      try {
        const type = this.normalizeImportedContactType(record.type);
        const displayName = this.normalizeRequiredImportedString(
          record.displayName,
          'displayName',
        );

        const contact = this.contactsRepository.create({
          tenantId: ctx.tenantId,
          workspaceId,
          type,
          displayName,
          firstName: this.optionalString(record.firstName),
          lastName: this.optionalString(record.lastName),
          legalName: this.optionalString(record.legalName),
          documentType: null,
          documentNumber: null,
          jobTitle: this.optionalString(record.jobTitle),
          companyContactId: null,
          source: this.normalizeImportedSource(record.source),
          businessMode: this.normalizeImportedBusinessMode(record.businessMode),
          lifecycleStage: this.normalizeImportedLifecycleStage(
            record.lifecycleStage,
          ),
          status: this.normalizeImportedStatus(record.status),
          ownerUserId: ctx.userId ?? null,
          createdByUserId: ctx.userId ?? null,
          notes: this.optionalString(record.notes),
        });

        const savedContact = await this.contactsRepository.save(contact);

        await this.createImportedMethodIfPresent(
          ctx,
          savedContact,
          'email',
          record.email,
        );

        await this.createImportedMethodIfPresent(
          ctx,
          savedContact,
          'phone',
          record.phone,
        );

        await this.createImportedMethodIfPresent(
          ctx,
          savedContact,
          'whatsapp',
          record.whatsapp,
        );

        created.push(savedContact);
      } catch (error) {
        errors.push({
          row: rowNumber,
          message:
            error instanceof Error
              ? error.message
              : 'Unknown error while importing contact.',
        });
      }
    }

    return {
      created: created.length,
      failed: errors.length,
      totalRows: dataRows.length,
      errors,
      items: created,
    };
  }

  async listCustomFields(ctx: RequestContext) {
    const workspaceId = this.requireWorkspaceId(ctx);

    return this.contactCustomFieldsRepository.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId,
      },
      order: { createdAt: 'ASC' },
    });
  }

  async createCustomField(ctx: RequestContext, dto: CreateContactCustomFieldDto) {
    const workspaceId = this.requireWorkspaceId(ctx);

    const field = this.contactCustomFieldsRepository.create({
      tenantId: ctx.tenantId,
      workspaceId,
      name: dto.name.trim(),
      key: dto.key.trim(),
      type: dto.type,
      required: dto.required ?? false,
      options: dto.options ?? null,
      isActive: dto.isActive ?? true,
      createdByUserId: ctx.userId ?? null,
    });

    try {
      return await this.contactCustomFieldsRepository.save(field);
    } catch (error) {
      this.throwConflictIfUniqueViolation(
        error,
        'A custom field with this key already exists.',
      );
      throw error;
    }
  }

  async patchCustomField(
    ctx: RequestContext,
    fieldId: string,
    dto: PatchContactCustomFieldDto,
  ) {
    const field = await this.findCustomFieldOrFail(ctx, fieldId);

    if (dto.name !== undefined) field.name = dto.name.trim();
    if (dto.key !== undefined) field.key = dto.key.trim();
    if (dto.type !== undefined) field.type = dto.type;
    if (dto.required !== undefined) field.required = dto.required;
    if (dto.options !== undefined) field.options = dto.options;
    if (dto.isActive !== undefined) field.isActive = dto.isActive;

    try {
      return await this.contactCustomFieldsRepository.save(field);
    } catch (error) {
      this.throwConflictIfUniqueViolation(
        error,
        'A custom field with this key already exists.',
      );
      throw error;
    }
  }

  async deleteCustomField(ctx: RequestContext, fieldId: string) {
    const field = await this.findCustomFieldOrFail(ctx, fieldId);

    field.isActive = false;

    return this.contactCustomFieldsRepository.save(field);
  }

  async upsertCustomFieldValue(
    ctx: RequestContext,
    contactId: string,
    dto: UpsertContactCustomFieldValueDto,
  ) {
    const contact = await this.findContactOrFail(ctx, contactId);
    const field = await this.findCustomFieldOrFail(ctx, dto.fieldId);

    if (field.workspaceId !== contact.workspaceId) {
      throw new BadRequestException('Custom field does not belong to this workspace.');
    }

    let value = await this.contactCustomFieldValuesRepository.findOne({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: contact.workspaceId,
        contactId,
        fieldId: dto.fieldId,
      },
    });

    if (!value) {
      value = this.contactCustomFieldValuesRepository.create({
        tenantId: ctx.tenantId,
        workspaceId: contact.workspaceId,
        contactId,
        fieldId: dto.fieldId,
      });
    }

    value.valueText = null;
    value.valueNumber = null;
    value.valueBoolean = null;
    value.valueDate = null;
    value.valueJson = null;

    if (dto.valueText !== undefined) value.valueText = dto.valueText;
    if (dto.valueNumber !== undefined) {
      value.valueNumber = dto.valueNumber === null ? null : String(dto.valueNumber);
    }
    if (dto.valueBoolean !== undefined) value.valueBoolean = dto.valueBoolean;
    if (dto.valueDate !== undefined) value.valueDate = dto.valueDate;
    if (dto.valueJson !== undefined) value.valueJson = dto.valueJson;

    return this.contactCustomFieldValuesRepository.save(value);
  }

  async deleteCustomFieldValue(ctx: RequestContext, contactId: string, fieldId: string) {
    await this.findContactOrFail(ctx, contactId);
    await this.findCustomFieldOrFail(ctx, fieldId);

    const result = await this.contactCustomFieldValuesRepository.delete({
      tenantId: ctx.tenantId,
      contactId,
      fieldId,
    });

    if (!result.affected) {
      throw new NotFoundException('Custom field value not found.');
    }

    return { deleted: true };
  }

  async listSegments(ctx: RequestContext) {
    const workspaceId = this.requireWorkspaceId(ctx);

    return this.contactSegmentsRepository.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId,
      },
      order: { name: 'ASC' },
    });
  }

  async createSegment(ctx: RequestContext, dto: CreateContactSegmentDto) {
    const workspaceId = this.requireWorkspaceId(ctx);

    const segment = this.contactSegmentsRepository.create({
      tenantId: ctx.tenantId,
      workspaceId,
      name: dto.name.trim(),
      description: this.optionalString(dto.description),
      rulesJson: dto.rulesJson ?? {},
      createdByUserId: ctx.userId ?? null,
    });

    try {
      return await this.contactSegmentsRepository.save(segment);
    } catch (error) {
      this.throwConflictIfUniqueViolation(
        error,
        'A contact segment with this name already exists.',
      );
      throw error;
    }
  }

  async patchSegment(ctx: RequestContext, segmentId: string, dto: PatchContactSegmentDto) {
    const segment = await this.findSegmentOrFail(ctx, segmentId);

    if (dto.name !== undefined) segment.name = dto.name.trim();
    if (dto.description !== undefined) {
      segment.description = this.nullableString(dto.description);
    }
    if (dto.rulesJson !== undefined) segment.rulesJson = dto.rulesJson;

    try {
      return await this.contactSegmentsRepository.save(segment);
    } catch (error) {
      this.throwConflictIfUniqueViolation(
        error,
        'A contact segment with this name already exists.',
      );
      throw error;
    }
  }

  async deleteSegment(ctx: RequestContext, segmentId: string) {
    const segment = await this.findSegmentOrFail(ctx, segmentId);

    await this.contactSegmentsRepository.delete({
      id: segment.id,
      tenantId: ctx.tenantId,
      workspaceId: segment.workspaceId,
    });

    return { deleted: true };
  }

  async listBusinessModes(ctx: RequestContext) {
    await this.ensureDefaultBusinessModes(ctx);

    const workspaceId = this.requireWorkspaceId(ctx);

    return this.contactBusinessModesRepository.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId,
      },
      order: {
        isSystem: 'DESC',
        name: 'ASC',
      },
    });
  }

  async createBusinessMode(
    ctx: RequestContext,
    dto: CreateContactBusinessModeDto,
  ) {
    const workspaceId = this.requireWorkspaceId(ctx);

    const mode = this.contactBusinessModesRepository.create({
      tenantId: ctx.tenantId,
      workspaceId,
      key: dto.key.trim(),
      name: dto.name.trim(),
      description: this.optionalString(dto.description),
      color: dto.color ?? '#2563EB',
      isSystem: false,
      isActive: dto.isActive ?? true,
      createdByUserId: ctx.userId ?? null,
    });

    try {
      return await this.contactBusinessModesRepository.save(mode);
    } catch (error) {
      this.throwConflictIfUniqueViolation(
        error,
        'A business mode with this key already exists.',
      );
      throw error;
    }
  }

  async patchBusinessMode(
    ctx: RequestContext,
    modeId: string,
    dto: PatchContactBusinessModeDto,
  ) {
    const mode = await this.findBusinessModeOrFail(ctx, modeId);

    if (mode.isSystem && dto.key !== undefined && dto.key !== mode.key) {
      throw new BadRequestException('System business modes cannot change key.');
    }

    if (dto.key !== undefined) mode.key = dto.key.trim();
    if (dto.name !== undefined) mode.name = dto.name.trim();
    if (dto.description !== undefined) {
      mode.description = this.nullableString(dto.description);
    }
    if (dto.color !== undefined) mode.color = dto.color;
    if (dto.isActive !== undefined) mode.isActive = dto.isActive;

    try {
      return await this.contactBusinessModesRepository.save(mode);
    } catch (error) {
      this.throwConflictIfUniqueViolation(
        error,
        'A business mode with this key already exists.',
      );
      throw error;
    }
  }

  async deleteBusinessMode(ctx: RequestContext, modeId: string) {
    const mode = await this.findBusinessModeOrFail(ctx, modeId);

    if (mode.isSystem) {
      throw new BadRequestException('System business modes cannot be deleted.');
    }

    mode.isActive = false;

    return this.contactBusinessModesRepository.save(mode);
  }

  async getViewPreference(ctx: RequestContext, viewKey = 'contacts_overview') {
    const workspaceId = this.requireWorkspaceId(ctx);
    const userId = this.requireUserId(ctx);

    const preference = await this.contactViewPreferencesRepository.findOne({
      where: {
        tenantId: ctx.tenantId,
        workspaceId,
        userId,
        viewKey,
      },
    });

    return (
      preference ?? {
        tenantId: ctx.tenantId,
        workspaceId,
        userId,
        viewKey,
        columnsJson: [],
        filtersJson: {},
        sortJson: {},
      }
    );
  }

  async upsertViewPreference(
    ctx: RequestContext,
    dto: UpsertContactViewPreferenceDto,
  ) {
    const workspaceId = this.requireWorkspaceId(ctx);
    const userId = this.requireUserId(ctx);

    let preference = await this.contactViewPreferencesRepository.findOne({
      where: {
        tenantId: ctx.tenantId,
        workspaceId,
        userId,
        viewKey: dto.viewKey,
      },
    });

    if (!preference) {
      preference = this.contactViewPreferencesRepository.create({
        tenantId: ctx.tenantId,
        workspaceId,
        userId,
        viewKey: dto.viewKey,
      });
    }

    if (dto.columnsJson !== undefined) preference.columnsJson = dto.columnsJson;
    if (dto.filtersJson !== undefined) preference.filtersJson = dto.filtersJson;
    if (dto.sortJson !== undefined) preference.sortJson = dto.sortJson;

    return this.contactViewPreferencesRepository.save(preference);
  }

  private async ensureDefaultBusinessModes(ctx: RequestContext) {
    const workspaceId = this.requireWorkspaceId(ctx);

    const defaults = [
      { key: 'general', name: 'Geral', color: '#2563EB' },
      { key: 'service_quote', name: 'Prestadores / Orçamentos', color: '#0EA5E9' },
      { key: 'clinic_booking', name: 'Clínicas / Agendamentos', color: '#16A34A' },
      { key: 'restaurant_order', name: 'Restaurantes / Pedidos', color: '#F59E0B' },
      { key: 'agency_service', name: 'Agências / Serviços', color: '#7C3AED' },
      { key: 'ecommerce', name: 'E-commerce', color: '#DC2626' },
      { key: 'education', name: 'Educação', color: '#64748B' },
      { key: 'real_estate', name: 'Imobiliário', color: '#0F172A' },
      { key: 'other', name: 'Outro', color: '#64748B' },
    ];

    for (const item of defaults) {
      const existing = await this.contactBusinessModesRepository.findOne({
        where: {
          tenantId: ctx.tenantId,
          workspaceId,
          key: item.key,
        },
      });

      if (!existing) {
        const mode = this.contactBusinessModesRepository.create({
          tenantId: ctx.tenantId,
          workspaceId,
          key: item.key,
          name: item.name,
          color: item.color,
          description: null,
          isSystem: true,
          isActive: true,
          createdByUserId: null,
        });

        await this.contactBusinessModesRepository.save(mode);
      }
    }
  }



  private buildCsv(rows: Array<Array<string | number | boolean | null | undefined>>) {
    return rows.map((row) => row.map((value) => this.escapeCsvValue(value)).join(',')).join('\n');
  }

  private escapeCsvValue(value: string | number | boolean | null | undefined) {
    if (value === null || value === undefined) {
      return '';
    }

    const stringValue = String(value);

    if (
      stringValue.includes(',') ||
      stringValue.includes('"') ||
      stringValue.includes('\n') ||
      stringValue.includes('\r')
    ) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }

    return stringValue;
  }

  private parseCsv(content: string) {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentValue = '';
    let insideQuotes = false;

    for (let index = 0; index < content.length; index++) {
      const char = content[index];
      const nextChar = content[index + 1];

      if (char === '"' && insideQuotes && nextChar === '"') {
        currentValue += '"';
        index++;
        continue;
      }

      if (char === '"') {
        insideQuotes = !insideQuotes;
        continue;
      }

      if (char === ',' && !insideQuotes) {
        currentRow.push(currentValue);
        currentValue = '';
        continue;
      }

      if ((char === '\n' || char === '\r') && !insideQuotes) {
        if (char === '\r' && nextChar === '\n') {
          index++;
        }

        currentRow.push(currentValue);
        rows.push(currentRow);
        currentRow = [];
        currentValue = '';
        continue;
      }

      currentValue += char;
    }

    currentRow.push(currentValue);
    rows.push(currentRow);

    return rows.filter((row) => row.some((value) => value.trim().length > 0));
  }

  private mapCsvRow(headers: string[], row: string[]) {
    const record: Record<string, string> = {};

    headers.forEach((header, index) => {
      record[header] = row[index]?.trim() ?? '';
    });

    return record;
  }

  private normalizeRequiredImportedString(value: string | undefined, field: string) {
    const normalized = value?.trim() ?? '';

    if (!normalized) {
      throw new BadRequestException(`${field} is required.`);
    }

    return normalized;
  }

  private normalizeImportedContactType(value?: string) {
    const normalized = value?.trim() || 'person';

    if (normalized !== 'person' && normalized !== 'organization') {
      throw new BadRequestException('Invalid contact type.');
    }

    return normalized;
  }

  private normalizeImportedSource(value?: string) {
    const normalized = value?.trim() || 'import';
    const allowed = [
      'manual',
      'whatsapp',
      'instagram',
      'facebook',
      'webchat',
      'form',
      'import',
      'referral',
      'email',
      'other',
    ];

    if (!allowed.includes(normalized)) {
      return 'other';
    }

    return normalized as ContactEntity['source'];
  }

  private normalizeImportedBusinessMode(value?: string) {
    const normalized = value?.trim() || 'general';
    const allowed = [
      'general',
      'service_quote',
      'clinic_booking',
      'restaurant_order',
      'agency_service',
      'ecommerce',
      'education',
      'real_estate',
      'other',
    ];

    if (!allowed.includes(normalized)) {
      return 'other';
    }

    return normalized as ContactEntity['businessMode'];
  }

  private normalizeImportedLifecycleStage(value?: string) {
    const normalized = value?.trim() || 'lead';
    const allowed = ['lead', 'prospect', 'customer', 'partner', 'supplier', 'other'];

    if (!allowed.includes(normalized)) {
      return 'lead';
    }

    return normalized as ContactEntity['lifecycleStage'];
  }

  private normalizeImportedStatus(value?: string) {
    const normalized = value?.trim() || 'active';
    const allowed = ['active', 'inactive', 'archived'];

    if (!allowed.includes(normalized)) {
      return 'active';
    }

    return normalized as ContactEntity['status'];
  }

  private async createImportedMethodIfPresent(
    ctx: RequestContext,
    contact: ContactEntity,
    type: 'email' | 'phone' | 'whatsapp',
    value?: string,
  ) {
    const normalized = value?.trim();

    if (!normalized) {
      return null;
    }

    const method = this.contactMethodsRepository.create({
      tenantId: ctx.tenantId,
      workspaceId: contact.workspaceId,
      contactId: contact.id,
      type,
      value: normalized,
      label: type === 'email' ? 'E-mail' : type === 'phone' ? 'Telefone' : 'WhatsApp',
      isPrimary: true,
    });

    return this.contactMethodsRepository.save(method);
  }

  private async findCustomFieldOrFail(ctx: RequestContext, fieldId: string) {
    const workspaceId = this.requireWorkspaceId(ctx);

    const field = await this.contactCustomFieldsRepository.findOne({
      where: {
        id: fieldId,
        tenantId: ctx.tenantId,
        workspaceId,
      },
    });

    if (!field) {
      throw new NotFoundException('Custom field not found.');
    }

    return field;
  }

  private async findSegmentOrFail(ctx: RequestContext, segmentId: string) {
    const workspaceId = this.requireWorkspaceId(ctx);

    const segment = await this.contactSegmentsRepository.findOne({
      where: {
        id: segmentId,
        tenantId: ctx.tenantId,
        workspaceId,
      },
    });

    if (!segment) {
      throw new NotFoundException('Contact segment not found.');
    }

    return segment;
  }

  private async findBusinessModeOrFail(ctx: RequestContext, modeId: string) {
    const workspaceId = this.requireWorkspaceId(ctx);

    const mode = await this.contactBusinessModesRepository.findOne({
      where: {
        id: modeId,
        tenantId: ctx.tenantId,
        workspaceId,
      },
    });

    if (!mode) {
      throw new NotFoundException('Business mode not found.');
    }

    return mode;
  }

  private requireUserId(ctx: RequestContext) {
    if (!ctx.userId) {
      throw new BadRequestException('User context is required.');
    }

    return ctx.userId;
  }

  private async findContactOrFail(ctx: RequestContext, contactId: string) {
    const workspaceId = this.requireWorkspaceId(ctx);

    const contact = await this.contactsRepository.findOne({
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
    return this.findContactOrFail(ctx, contactId);
  }

  private async findListOrFail(ctx: RequestContext, listId: string) {
    const workspaceId = this.requireWorkspaceId(ctx);

    const list = await this.contactListsRepository.findOne({
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

  private async findTagOrFail(ctx: RequestContext, tagId: string) {
    const workspaceId = this.requireWorkspaceId(ctx);

    const tag = await this.contactTagsRepository.findOne({
      where: {
        id: tagId,
        tenantId: ctx.tenantId,
        workspaceId,
      },
    });

    if (!tag) {
      throw new NotFoundException('Contact tag not found.');
    }

    return tag;
  }

  private async clearPrimaryMethods(
    ctx: RequestContext,
    contactId: string,
    type: string,
  ) {
    await this.contactMethodsRepository.update(
      {
        tenantId: ctx.tenantId,
        contactId,
        type: type as never,
        isPrimary: true,
      },
      { isPrimary: false },
    );
  }

  private requireWorkspaceId(ctx: RequestContext) {
    if (!ctx.workspaceId) {
      throw new BadRequestException('Workspace context is required.');
    }

    return ctx.workspaceId;
  }

  private normalizeLimit(value?: string) {
    const parsed = Number(value ?? 50);

    if (!Number.isFinite(parsed)) {
      return 50;
    }

    return Math.min(Math.max(parsed, 1), 100);
  }

  private normalizeOffset(value?: string) {
    const parsed = Number(value ?? 0);

    if (!Number.isFinite(parsed)) {
      return 0;
    }

    return Math.max(parsed, 0);
  }

  private optionalString(value?: string) {
    if (value === undefined) {
      return null;
    }

    const trimmed = value.trim();

    return trimmed.length > 0 ? trimmed : null;
  }

  private nullableString(value?: string | null) {
    if (value === null || value === undefined) {
      return null;
    }

    const trimmed = value.trim();

    return trimmed.length > 0 ? trimmed : null;
  }

  private throwConflictIfUniqueViolation(error: unknown, message: string) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === '23505'
    ) {
      throw new ConflictException(message);
    }
  }
}
