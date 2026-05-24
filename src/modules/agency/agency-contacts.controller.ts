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

@Controller('agency/contacts')
@UseGuards(JwtAuthGuard)
export class AgencyContactsController {
  constructor(private readonly agencyContactsService: AgencyContactsService) {}

  @Get('lists')
  listLists(@RequestContextData() ctx: RequestContext) {
    return this.agencyContactsService.listLists(ctx);
  }

  @Post('lists')
  createList(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateContactListDto,
  ) {
    return this.agencyContactsService.createList(ctx, dto);
  }

  @Patch('lists/:listId')
  patchList(
    @RequestContextData() ctx: RequestContext,
    @Param('listId') listId: string,
    @Body() dto: PatchContactListDto,
  ) {
    return this.agencyContactsService.patchList(ctx, listId, dto);
  }

  @Delete('lists/:listId')
  deleteList(
    @RequestContextData() ctx: RequestContext,
    @Param('listId') listId: string,
    @Query() query: DeleteAgencyContactListQuery,
  ) {
    return this.agencyContactsService.deleteList(ctx, listId, query);
  }

  @Get()
  listContacts(
    @RequestContextData() ctx: RequestContext,
    @Query() query: ListAgencyContactsQuery,
  ) {
    return this.agencyContactsService.listContacts(ctx, query);
  }

  @Post()
  createContact(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateContactDto,
  ) {
    return this.agencyContactsService.createContact(ctx, dto);
  }

  @Get('defaults')
  getDefaults(@RequestContextData() ctx: RequestContext) {
    return this.agencyContactsService.getDefaults(ctx);
  }

  @Get('identification-types')
  listIdentificationTypes(@RequestContextData() ctx: RequestContext) {
    return this.agencyContactsService.listIdentificationTypes(ctx);
  }

  @Post('identification-types')
  createIdentificationType(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateAgencyContactIdentificationTypeDto,
  ) {
    return this.agencyContactsService.createIdentificationType(ctx, dto);
  }

  @Patch('identification-types/:id')
  updateIdentificationType(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateAgencyContactIdentificationTypeDto,
  ) {
    return this.agencyContactsService.updateIdentificationType(ctx, id, dto);
  }

  @Delete('identification-types/:id')
  deleteIdentificationType(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.agencyContactsService.deleteIdentificationType(ctx, id);
  }

  @Get('banks')
  listBanks(@RequestContextData() ctx: RequestContext) {
    return this.agencyContactsService.listBanks(ctx);
  }

  @Post('banks')
  createBank(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateAgencyBankDto,
  ) {
    return this.agencyContactsService.createBank(ctx, dto);
  }

  @Patch('banks/:id')
  updateBank(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateAgencyBankDto,
  ) {
    return this.agencyContactsService.updateBank(ctx, id, dto);
  }

  @Delete('banks/:id')
  deleteBank(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.agencyContactsService.deleteBank(ctx, id);
  }

  @Get('bank-accounts')
  listBankAccounts(
    @RequestContextData() ctx: RequestContext,
    @Query('contactId') contactId?: string,
  ) {
    return this.agencyContactsService.listBankAccounts(ctx, contactId);
  }

  @Post('bank-accounts')
  createBankAccount(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateAgencyContactBankAccountDto,
  ) {
    return this.agencyContactsService.createBankAccount(ctx, dto);
  }

  @Patch('bank-accounts/:id')
  updateBankAccount(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateAgencyContactBankAccountDto,
  ) {
    return this.agencyContactsService.updateBankAccount(ctx, id, dto);
  }

  @Delete('bank-accounts/:id')
  deleteBankAccount(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.agencyContactsService.deleteBankAccount(ctx, id);
  }

  @Get('tags')
  listTags(@RequestContextData() ctx: RequestContext) {
    return this.agencyContactsService.listTags(ctx);
  }

  @Post('tags')
  createTag(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateContactTagDto,
  ) {
    return this.agencyContactsService.createTag(ctx, dto);
  }

  @Patch('tags/:tagId')
  patchTag(
    @RequestContextData() ctx: RequestContext,
    @Param('tagId') tagId: string,
    @Body() dto: PatchContactTagDto,
  ) {
    return this.agencyContactsService.patchTag(ctx, tagId, dto);
  }

  @Delete('tags/:tagId')
  deleteTag(
    @RequestContextData() ctx: RequestContext,
    @Param('tagId') tagId: string,
  ) {
    return this.agencyContactsService.deleteTag(ctx, tagId);
  }

  @Get('segments')
  listSegments(@RequestContextData() ctx: RequestContext) {
    return this.agencyContactsService.listSegments(ctx);
  }

  @Post('segments')
  createSegment(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateContactSegmentDto,
  ) {
    return this.agencyContactsService.createSegment(ctx, dto);
  }

  @Patch('segments/:segmentId')
  patchSegment(
    @RequestContextData() ctx: RequestContext,
    @Param('segmentId') segmentId: string,
    @Body() dto: PatchContactSegmentDto,
  ) {
    return this.agencyContactsService.patchSegment(ctx, segmentId, dto);
  }

  @Delete('segments/:segmentId')
  deleteSegment(
    @RequestContextData() ctx: RequestContext,
    @Param('segmentId') segmentId: string,
  ) {
    return this.agencyContactsService.deleteSegment(ctx, segmentId);
  }

  @Get(':contactId/methods')
  listMethods(
    @RequestContextData() ctx: RequestContext,
    @Param('contactId') contactId: string,
  ) {
    return this.agencyContactsService.listMethods(ctx, contactId);
  }

  @Post(':contactId/methods')
  createMethod(
    @RequestContextData() ctx: RequestContext,
    @Param('contactId') contactId: string,
    @Body() dto: CreateContactMethodDto,
  ) {
    return this.agencyContactsService.createMethod(ctx, contactId, dto);
  }

  @Patch(':contactId/methods/:methodId')
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
  deleteMethod(
    @RequestContextData() ctx: RequestContext,
    @Param('contactId') contactId: string,
    @Param('methodId') methodId: string,
  ) {
    return this.agencyContactsService.deleteMethod(ctx, contactId, methodId);
  }

  @Get(':contactId/addresses')
  listAddresses(
    @RequestContextData() ctx: RequestContext,
    @Param('contactId') contactId: string,
  ) {
    return this.agencyContactsService.listAddresses(ctx, contactId);
  }

  @Post(':contactId/addresses')
  createAddress(
    @RequestContextData() ctx: RequestContext,
    @Param('contactId') contactId: string,
    @Body() dto: CreateContactAddressDto,
  ) {
    return this.agencyContactsService.createAddress(ctx, contactId, dto);
  }

  @Patch(':contactId/addresses/:addressId')
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
  deleteAddress(
    @RequestContextData() ctx: RequestContext,
    @Param('contactId') contactId: string,
    @Param('addressId') addressId: string,
  ) {
    return this.agencyContactsService.deleteAddress(ctx, contactId, addressId);
  }

  @Post(':contactId/tags/:tagId')
  addTagToContact(
    @RequestContextData() ctx: RequestContext,
    @Param('contactId') contactId: string,
    @Param('tagId') tagId: string,
  ) {
    return this.agencyContactsService.addTagToContact(ctx, contactId, tagId);
  }

  @Delete(':contactId/tags/:tagId')
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
  getContactDetail(
    @RequestContextData() ctx: RequestContext,
    @Param('contactId') contactId: string,
  ) {
    return this.agencyContactsService.getContactDetail(ctx, contactId);
  }

  @Patch(':contactId/profile')
  updateContactProfile(
    @RequestContextData() ctx: RequestContext,
    @Param('contactId') contactId: string,
    @Body() dto: UpdateAgencyContactProfileDto,
  ) {
    return this.agencyContactsService.updateContactProfile(ctx, contactId, dto);
  }

  @Post(':contactId/profile/avatar')
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
  getContact(
    @RequestContextData() ctx: RequestContext,
    @Param('contactId') contactId: string,
  ) {
    return this.agencyContactsService.getContact(ctx, contactId);
  }

  @Patch(':contactId')
  patchContact(
    @RequestContextData() ctx: RequestContext,
    @Param('contactId') contactId: string,
    @Body() dto: PatchContactDto,
  ) {
    return this.agencyContactsService.patchContact(ctx, contactId, dto);
  }

  @Delete(':contactId/permanent')
  permanentlyDeleteContact(
    @RequestContextData() ctx: RequestContext,
    @Param('contactId') contactId: string,
  ) {
    return this.agencyContactsService.permanentlyDeleteContact(ctx, contactId);
  }

  @Delete(':contactId')
  deleteContact(
    @RequestContextData() ctx: RequestContext,
    @Param('contactId') contactId: string,
  ) {
    return this.agencyContactsService.deleteContact(ctx, contactId);
  }
}
