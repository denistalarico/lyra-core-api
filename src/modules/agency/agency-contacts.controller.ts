import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  DangerousAction,
  PermissionsGuard,
  RequireAnyPermission,
  RequirePermission,
} from '../permissions';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { MAX_IMAGE_UPLOAD_BYTES } from '../../common/files/files.service';
import { AgencyContactsService } from './agency-contacts.service';
import { CreateContactListDto } from '../contacts/dto/create-contact-list.dto';
import { PatchContactListDto } from '../contacts/dto/patch-contact-list.dto';
import { CreateContactDto } from '../contacts/dto/create-contact.dto';
import { PatchContactDto } from '../contacts/dto/patch-contact.dto';
import {
  CreateAgencyBankDto,
  CreateAgencyContactBankAccountDto,
  CreateAgencyContactIdentificationTypeDto,
  UpdateAgencyBankDto,
  UpdateAgencyContactBankAccountDto,
  UpdateAgencyContactIdentificationTypeDto,
  UpdateAgencyContactProfileDto,
} from './dto/agency-contact-details.dto';
import { CreateContactMethodDto } from '../contacts/dto/create-contact-method.dto';
import { PatchContactMethodDto } from '../contacts/dto/patch-contact-method.dto';
import { CreateContactAddressDto } from '../contacts/dto/create-contact-address.dto';
import { PatchContactAddressDto } from '../contacts/dto/patch-contact-address.dto';
import { CreateContactTagDto } from '../contacts/dto/create-contact-tag.dto';
import { PatchContactTagDto } from '../contacts/dto/patch-contact-tag.dto';
import { CreateContactSegmentDto } from '../contacts/dto/create-contact-segment.dto';
import { PatchContactSegmentDto } from '../contacts/dto/patch-contact-segment.dto';

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

type DeleteAgencyContactListQuery = {
  contactAction?: 'detach' | 'move';
  targetListId?: string;
};

const IMAGE_UPLOAD_OPTIONS = {
  storage: memoryStorage(),
  limits: {
    fileSize: MAX_IMAGE_UPLOAD_BYTES,
  },
  fileFilter: (
    _request: unknown,
    file: Express.Multer.File,
    callback: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    const allowedMimeTypes = new Set([
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
    ]);

    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(new BadRequestException('Unsupported image format.'), false);
      return;
    }

    callback(null, true);
  },
};

const CONTACT_VIEW_PERMISSIONS = [
  'shared.contacts.view.assigned',
  'shared.contacts.view.client',
  'shared.contacts.view.department',
  'shared.contacts.view.all',
];

const CONTACT_UPDATE_PERMISSIONS = [
  'shared.contacts.update.assigned',
  'shared.contacts.update.client',
];

@Controller('agency/contacts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AgencyContactsController {
  constructor(private readonly agencyContactsService: AgencyContactsService) {}

  @Get('lists')
  @RequireAnyPermission(...CONTACT_VIEW_PERMISSIONS)
  listLists(@RequestContextData() ctx: RequestContext) {
    return this.agencyContactsService.listLists(ctx);
  }

  @Post('lists')
  @RequirePermission('shared.contacts.update.client')
  createList(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateContactListDto,
  ) {
    return this.agencyContactsService.createList(ctx, dto);
  }

  @Patch('lists/:listId')
  @RequirePermission('shared.contacts.update.client')
  patchList(
    @RequestContextData() ctx: RequestContext,
    @Param('listId') listId: string,
    @Body() dto: PatchContactListDto,
  ) {
    return this.agencyContactsService.patchList(ctx, listId, dto);
  }

  @Delete('lists/:listId')
  @RequirePermission('shared.contacts.delete.owner_only')
  @DangerousAction()
  deleteList(
    @RequestContextData() ctx: RequestContext,
    @Param('listId') listId: string,
    @Query() query: DeleteAgencyContactListQuery,
  ) {
    return this.agencyContactsService.deleteList(ctx, listId, query);
  }

  @Get()
  @RequireAnyPermission(...CONTACT_VIEW_PERMISSIONS)
  listContacts(
    @RequestContextData() ctx: RequestContext,
    @Query() query: ListAgencyContactsQuery,
  ) {
    return this.agencyContactsService.listContacts(ctx, query);
  }

  @Post()
  @RequirePermission('shared.contacts.create')
  createContact(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateContactDto,
  ) {
    return this.agencyContactsService.createContact(ctx, dto);
  }

  @Get('defaults')
  @RequireAnyPermission(...CONTACT_VIEW_PERMISSIONS)
  getDefaults(@RequestContextData() ctx: RequestContext) {
    return this.agencyContactsService.getDefaults(ctx);
  }

  @Get('identification-types')
  @RequireAnyPermission(...CONTACT_VIEW_PERMISSIONS)
  listIdentificationTypes(@RequestContextData() ctx: RequestContext) {
    return this.agencyContactsService.listIdentificationTypes(ctx);
  }

  @Post('identification-types')
  @RequirePermission('shared.contacts.update.client')
  createIdentificationType(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateAgencyContactIdentificationTypeDto,
  ) {
    return this.agencyContactsService.createIdentificationType(ctx, dto);
  }

  @Patch('identification-types/:id')
  @RequirePermission('shared.contacts.update.client')
  updateIdentificationType(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateAgencyContactIdentificationTypeDto,
  ) {
    return this.agencyContactsService.updateIdentificationType(ctx, id, dto);
  }

  @Delete('identification-types/:id')
  @RequirePermission('shared.contacts.delete.owner_only')
  @DangerousAction()
  deleteIdentificationType(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.agencyContactsService.deleteIdentificationType(ctx, id);
  }

  @Get('banks')
  @RequireAnyPermission(...CONTACT_VIEW_PERMISSIONS)
  listBanks(@RequestContextData() ctx: RequestContext) {
    return this.agencyContactsService.listBanks(ctx);
  }

  @Post('banks')
  @RequirePermission('shared.contacts.update.client')
  createBank(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateAgencyBankDto,
  ) {
    return this.agencyContactsService.createBank(ctx, dto);
  }

  @Patch('banks/:id')
  @RequirePermission('shared.contacts.update.client')
  updateBank(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateAgencyBankDto,
  ) {
    return this.agencyContactsService.updateBank(ctx, id, dto);
  }

  @Delete('banks/:id')
  @RequirePermission('shared.contacts.delete.owner_only')
  @DangerousAction()
  deleteBank(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.agencyContactsService.deleteBank(ctx, id);
  }

  @Get('bank-accounts')
  @RequireAnyPermission(...CONTACT_VIEW_PERMISSIONS)
  listBankAccounts(
    @RequestContextData() ctx: RequestContext,
    @Query('contactId') contactId?: string,
  ) {
    return this.agencyContactsService.listBankAccounts(ctx, contactId);
  }

  @Post('bank-accounts')
  @RequireAnyPermission(...CONTACT_UPDATE_PERMISSIONS)
  createBankAccount(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateAgencyContactBankAccountDto,
  ) {
    return this.agencyContactsService.createBankAccount(ctx, dto);
  }

  @Patch('bank-accounts/:id')
  @RequireAnyPermission(...CONTACT_UPDATE_PERMISSIONS)
  updateBankAccount(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateAgencyContactBankAccountDto,
  ) {
    return this.agencyContactsService.updateBankAccount(ctx, id, dto);
  }

  @Delete('bank-accounts/:id')
  @RequirePermission('shared.contacts.delete.owner_only')
  @DangerousAction()
  deleteBankAccount(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.agencyContactsService.deleteBankAccount(ctx, id);
  }

  @Get('tags')
  @RequireAnyPermission(...CONTACT_VIEW_PERMISSIONS)
  listTags(@RequestContextData() ctx: RequestContext) {
    return this.agencyContactsService.listTags(ctx);
  }

  @Post('tags')
  @RequirePermission('shared.contacts.update.client')
  createTag(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateContactTagDto,
  ) {
    return this.agencyContactsService.createTag(ctx, dto);
  }

  @Patch('tags/:tagId')
  @RequirePermission('shared.contacts.update.client')
  patchTag(
    @RequestContextData() ctx: RequestContext,
    @Param('tagId') tagId: string,
    @Body() dto: PatchContactTagDto,
  ) {
    return this.agencyContactsService.patchTag(ctx, tagId, dto);
  }

  @Delete('tags/:tagId')
  @RequirePermission('shared.contacts.delete.owner_only')
  @DangerousAction()
  deleteTag(
    @RequestContextData() ctx: RequestContext,
    @Param('tagId') tagId: string,
  ) {
    return this.agencyContactsService.deleteTag(ctx, tagId);
  }

  @Get('segments')
  @RequireAnyPermission(...CONTACT_VIEW_PERMISSIONS)
  listSegments(@RequestContextData() ctx: RequestContext) {
    return this.agencyContactsService.listSegments(ctx);
  }

  @Post('segments')
  @RequirePermission('shared.contacts.update.client')
  createSegment(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateContactSegmentDto,
  ) {
    return this.agencyContactsService.createSegment(ctx, dto);
  }

  @Patch('segments/:segmentId')
  @RequirePermission('shared.contacts.update.client')
  patchSegment(
    @RequestContextData() ctx: RequestContext,
    @Param('segmentId') segmentId: string,
    @Body() dto: PatchContactSegmentDto,
  ) {
    return this.agencyContactsService.patchSegment(ctx, segmentId, dto);
  }

  @Delete('segments/:segmentId')
  @RequirePermission('shared.contacts.delete.owner_only')
  @DangerousAction()
  deleteSegment(
    @RequestContextData() ctx: RequestContext,
    @Param('segmentId') segmentId: string,
  ) {
    return this.agencyContactsService.deleteSegment(ctx, segmentId);
  }

  @Get(':contactId/methods')
  @RequireAnyPermission(...CONTACT_VIEW_PERMISSIONS)
  listMethods(
    @RequestContextData() ctx: RequestContext,
    @Param('contactId') contactId: string,
  ) {
    return this.agencyContactsService.listMethods(ctx, contactId);
  }

  @Post(':contactId/methods')
  @RequireAnyPermission(...CONTACT_UPDATE_PERMISSIONS)
  createMethod(
    @RequestContextData() ctx: RequestContext,
    @Param('contactId') contactId: string,
    @Body() dto: CreateContactMethodDto,
  ) {
    return this.agencyContactsService.createMethod(ctx, contactId, dto);
  }

  @Patch(':contactId/methods/:methodId')
  @RequireAnyPermission(...CONTACT_UPDATE_PERMISSIONS)
  patchMethod(
    @RequestContextData() ctx: RequestContext,
    @Param('contactId') contactId: string,
    @Param('methodId') methodId: string,
    @Body() dto: PatchContactMethodDto,
  ) {
    return this.agencyContactsService.patchMethod(
      ctx,
      contactId,
      methodId,
      dto,
    );
  }

  @Delete(':contactId/methods/:methodId')
  @RequireAnyPermission(...CONTACT_UPDATE_PERMISSIONS)
  deleteMethod(
    @RequestContextData() ctx: RequestContext,
    @Param('contactId') contactId: string,
    @Param('methodId') methodId: string,
  ) {
    return this.agencyContactsService.deleteMethod(ctx, contactId, methodId);
  }

  @Get(':contactId/addresses')
  @RequireAnyPermission(...CONTACT_VIEW_PERMISSIONS)
  listAddresses(
    @RequestContextData() ctx: RequestContext,
    @Param('contactId') contactId: string,
  ) {
    return this.agencyContactsService.listAddresses(ctx, contactId);
  }

  @Post(':contactId/addresses')
  @RequireAnyPermission(...CONTACT_UPDATE_PERMISSIONS)
  createAddress(
    @RequestContextData() ctx: RequestContext,
    @Param('contactId') contactId: string,
    @Body() dto: CreateContactAddressDto,
  ) {
    return this.agencyContactsService.createAddress(ctx, contactId, dto);
  }

  @Patch(':contactId/addresses/:addressId')
  @RequireAnyPermission(...CONTACT_UPDATE_PERMISSIONS)
  patchAddress(
    @RequestContextData() ctx: RequestContext,
    @Param('contactId') contactId: string,
    @Param('addressId') addressId: string,
    @Body() dto: PatchContactAddressDto,
  ) {
    return this.agencyContactsService.patchAddress(
      ctx,
      contactId,
      addressId,
      dto,
    );
  }

  @Delete(':contactId/addresses/:addressId')
  @RequireAnyPermission(...CONTACT_UPDATE_PERMISSIONS)
  deleteAddress(
    @RequestContextData() ctx: RequestContext,
    @Param('contactId') contactId: string,
    @Param('addressId') addressId: string,
  ) {
    return this.agencyContactsService.deleteAddress(ctx, contactId, addressId);
  }

  @Post(':contactId/tags/:tagId')
  @RequireAnyPermission(...CONTACT_UPDATE_PERMISSIONS)
  addTagToContact(
    @RequestContextData() ctx: RequestContext,
    @Param('contactId') contactId: string,
    @Param('tagId') tagId: string,
  ) {
    return this.agencyContactsService.addTagToContact(ctx, contactId, tagId);
  }

  @Delete(':contactId/tags/:tagId')
  @RequireAnyPermission(...CONTACT_UPDATE_PERMISSIONS)
  removeTagFromContact(
    @RequestContextData() ctx: RequestContext,
    @Param('contactId') contactId: string,
    @Param('tagId') tagId: string,
  ) {
    return this.agencyContactsService.removeTagFromContact(
      ctx,
      contactId,
      tagId,
    );
  }

  @Get(':contactId/detail')
  @RequireAnyPermission(...CONTACT_VIEW_PERMISSIONS)
  getContactDetail(
    @RequestContextData() ctx: RequestContext,
    @Param('contactId') contactId: string,
  ) {
    return this.agencyContactsService.getContactDetail(ctx, contactId);
  }

  @Patch(':contactId/profile')
  @RequireAnyPermission(...CONTACT_UPDATE_PERMISSIONS)
  updateContactProfile(
    @RequestContextData() ctx: RequestContext,
    @Param('contactId') contactId: string,
    @Body() dto: UpdateAgencyContactProfileDto,
  ) {
    return this.agencyContactsService.updateContactProfile(ctx, contactId, dto);
  }

  @Post(':contactId/profile/avatar')
  @RequireAnyPermission(...CONTACT_UPDATE_PERMISSIONS)
  @UseInterceptors(FileInterceptor('file', IMAGE_UPLOAD_OPTIONS))
  uploadContactAvatar(
    @RequestContextData() ctx: RequestContext,
    @Param('contactId') contactId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Image file is required.');
    }

    return this.agencyContactsService.uploadContactAvatar(ctx, contactId, file);
  }

  @Get(':contactId')
  @RequireAnyPermission(...CONTACT_VIEW_PERMISSIONS)
  getContact(
    @RequestContextData() ctx: RequestContext,
    @Param('contactId') contactId: string,
  ) {
    return this.agencyContactsService.getContact(ctx, contactId);
  }

  @Patch(':contactId')
  @RequireAnyPermission(...CONTACT_UPDATE_PERMISSIONS)
  patchContact(
    @RequestContextData() ctx: RequestContext,
    @Param('contactId') contactId: string,
    @Body() dto: PatchContactDto,
  ) {
    return this.agencyContactsService.patchContact(ctx, contactId, dto);
  }

  @Delete(':contactId/permanent')
  @RequirePermission('shared.contacts.delete.owner_only')
  @DangerousAction()
  permanentlyDeleteContact(
    @RequestContextData() ctx: RequestContext,
    @Param('contactId') contactId: string,
  ) {
    return this.agencyContactsService.permanentlyDeleteContact(ctx, contactId);
  }

  @Delete(':contactId')
  @RequirePermission('shared.contacts.delete.owner_only')
  @DangerousAction()
  deleteContact(
    @RequestContextData() ctx: RequestContext,
    @Param('contactId') contactId: string,
  ) {
    return this.agencyContactsService.deleteContact(ctx, contactId);
  }
}
