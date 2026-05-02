import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { RequestContextData } from '../../common/context/request-context.decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { RequestContext } from '../../common/context/request-context.interface';
import { ContactsService } from './contacts.service';
import { CreateContactBusinessModeDto } from './dto/create-contact-business-mode.dto';
import { CreateContactCustomFieldDto } from './dto/create-contact-custom-field.dto';
import { CreateContactSegmentDto } from './dto/create-contact-segment.dto';
import { PatchContactBusinessModeDto } from './dto/patch-contact-business-mode.dto';
import { PatchContactCustomFieldDto } from './dto/patch-contact-custom-field.dto';
import { PatchContactSegmentDto } from './dto/patch-contact-segment.dto';
import { UpsertContactCustomFieldValueDto } from './dto/upsert-contact-custom-field-value.dto';
import { UpsertContactViewPreferenceDto } from './dto/upsert-contact-view-preference.dto';
import { AddContactListMemberDto } from './dto/add-contact-list-member.dto';
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

type ListContactsQuery = {
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

@Controller('contacts')
@UseGuards(JwtAuthGuard)
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Get()
  listContacts(
    @RequestContextData() ctx: RequestContext,
    @Query() query: ListContactsQuery,
  ) {
    return this.contactsService.listContacts(ctx, query);
  }

  @Post()
  createContact(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateContactDto,
  ) {
    return this.contactsService.createContact(ctx, dto);
  }


  @Get('import-template')
  getImportTemplate(@Res({ passthrough: true }) response: Response) {
    const csv = this.contactsService.getImportTemplateCsv();

    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="contacts-import-template.csv"',
    );

    return csv;
  }

  @Get('export')
  async exportContacts(
    @RequestContextData() ctx: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    const csv = await this.contactsService.exportContactsCsv(ctx);

    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="contacts-export.csv"',
    );

    return csv;
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  importContacts(
    @RequestContextData() ctx: RequestContext,
    @UploadedFile()
    file: {
      originalname: string;
      mimetype?: string;
      buffer: Buffer;
      size: number;
    },
  ) {
    return this.contactsService.importContactsCsv(ctx, file);
  }

  @Get('lists')
  listLists(@RequestContextData() ctx: RequestContext) {
    return this.contactsService.listLists(ctx);
  }

  @Post('lists')
  createList(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateContactListDto,
  ) {
    return this.contactsService.createList(ctx, dto);
  }

  @Patch('lists/:listId')
  patchList(
    @RequestContextData() ctx: RequestContext,
    @Param('listId') listId: string,
    @Body() dto: PatchContactListDto,
  ) {
    return this.contactsService.patchList(ctx, listId, dto);
  }

  @Delete('lists/:listId')
  deleteList(
    @RequestContextData() ctx: RequestContext,
    @Param('listId') listId: string,
  ) {
    return this.contactsService.deleteList(ctx, listId);
  }

  @Post('lists/:listId/members')
  addListMember(
    @RequestContextData() ctx: RequestContext,
    @Param('listId') listId: string,
    @Body() dto: AddContactListMemberDto,
  ) {
    return this.contactsService.addListMember(ctx, listId, dto);
  }

  @Delete('lists/:listId/members/:contactId')
  removeListMember(
    @RequestContextData() ctx: RequestContext,
    @Param('listId') listId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.contactsService.removeListMember(ctx, listId, contactId);
  }

  @Get('tags')
  listTags(@RequestContextData() ctx: RequestContext) {
    return this.contactsService.listTags(ctx);
  }

  @Post('tags')
  createTag(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateContactTagDto,
  ) {
    return this.contactsService.createTag(ctx, dto);
  }

  @Patch('tags/:tagId')
  patchTag(
    @RequestContextData() ctx: RequestContext,
    @Param('tagId') tagId: string,
    @Body() dto: PatchContactTagDto,
  ) {
    return this.contactsService.patchTag(ctx, tagId, dto);
  }

  @Delete('tags/:tagId')
  deleteTag(
    @RequestContextData() ctx: RequestContext,
    @Param('tagId') tagId: string,
  ) {
    return this.contactsService.deleteTag(ctx, tagId);
  }


  @Get('custom-fields')
  listCustomFields(@RequestContextData() ctx: RequestContext) {
    return this.contactsService.listCustomFields(ctx);
  }

  @Post('custom-fields')
  createCustomField(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateContactCustomFieldDto,
  ) {
    return this.contactsService.createCustomField(ctx, dto);
  }

  @Patch('custom-fields/:fieldId')
  patchCustomField(
    @RequestContextData() ctx: RequestContext,
    @Param('fieldId') fieldId: string,
    @Body() dto: PatchContactCustomFieldDto,
  ) {
    return this.contactsService.patchCustomField(ctx, fieldId, dto);
  }

  @Delete('custom-fields/:fieldId')
  deleteCustomField(
    @RequestContextData() ctx: RequestContext,
    @Param('fieldId') fieldId: string,
  ) {
    return this.contactsService.deleteCustomField(ctx, fieldId);
  }

  @Get('segments')
  listSegments(@RequestContextData() ctx: RequestContext) {
    return this.contactsService.listSegments(ctx);
  }

  @Post('segments')
  createSegment(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateContactSegmentDto,
  ) {
    return this.contactsService.createSegment(ctx, dto);
  }

  @Patch('segments/:segmentId')
  patchSegment(
    @RequestContextData() ctx: RequestContext,
    @Param('segmentId') segmentId: string,
    @Body() dto: PatchContactSegmentDto,
  ) {
    return this.contactsService.patchSegment(ctx, segmentId, dto);
  }

  @Delete('segments/:segmentId')
  deleteSegment(
    @RequestContextData() ctx: RequestContext,
    @Param('segmentId') segmentId: string,
  ) {
    return this.contactsService.deleteSegment(ctx, segmentId);
  }

  @Get('business-modes')
  listBusinessModes(@RequestContextData() ctx: RequestContext) {
    return this.contactsService.listBusinessModes(ctx);
  }

  @Post('business-modes')
  createBusinessMode(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateContactBusinessModeDto,
  ) {
    return this.contactsService.createBusinessMode(ctx, dto);
  }

  @Patch('business-modes/:modeId')
  patchBusinessMode(
    @RequestContextData() ctx: RequestContext,
    @Param('modeId') modeId: string,
    @Body() dto: PatchContactBusinessModeDto,
  ) {
    return this.contactsService.patchBusinessMode(ctx, modeId, dto);
  }

  @Delete('business-modes/:modeId')
  deleteBusinessMode(
    @RequestContextData() ctx: RequestContext,
    @Param('modeId') modeId: string,
  ) {
    return this.contactsService.deleteBusinessMode(ctx, modeId);
  }

  @Get('view-preferences/:viewKey')
  getViewPreference(
    @RequestContextData() ctx: RequestContext,
    @Param('viewKey') viewKey: string,
  ) {
    return this.contactsService.getViewPreference(ctx, viewKey);
  }

  @Post('view-preferences')
  upsertViewPreference(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: UpsertContactViewPreferenceDto,
  ) {
    return this.contactsService.upsertViewPreference(ctx, dto);
  }

  @Get(':contactId')
  getContact(
    @RequestContextData() ctx: RequestContext,
    @Param('contactId') contactId: string,
  ) {
    return this.contactsService.getContact(ctx, contactId);
  }

  @Patch(':contactId')
  patchContact(
    @RequestContextData() ctx: RequestContext,
    @Param('contactId') contactId: string,
    @Body() dto: PatchContactDto,
  ) {
    return this.contactsService.patchContact(ctx, contactId, dto);
  }

  @Delete(':contactId')
  deleteContact(
    @RequestContextData() ctx: RequestContext,
    @Param('contactId') contactId: string,
  ) {
    return this.contactsService.deleteContact(ctx, contactId);
  }


  @Post(':contactId/custom-field-values')
  upsertCustomFieldValue(
    @RequestContextData() ctx: RequestContext,
    @Param('contactId') contactId: string,
    @Body() dto: UpsertContactCustomFieldValueDto,
  ) {
    return this.contactsService.upsertCustomFieldValue(ctx, contactId, dto);
  }

  @Delete(':contactId/custom-field-values/:fieldId')
  deleteCustomFieldValue(
    @RequestContextData() ctx: RequestContext,
    @Param('contactId') contactId: string,
    @Param('fieldId') fieldId: string,
  ) {
    return this.contactsService.deleteCustomFieldValue(ctx, contactId, fieldId);
  }

  @Post(':contactId/methods')
  createMethod(
    @RequestContextData() ctx: RequestContext,
    @Param('contactId') contactId: string,
    @Body() dto: CreateContactMethodDto,
  ) {
    return this.contactsService.createMethod(ctx, contactId, dto);
  }

  @Patch(':contactId/methods/:methodId')
  patchMethod(
    @RequestContextData() ctx: RequestContext,
    @Param('contactId') contactId: string,
    @Param('methodId') methodId: string,
    @Body() dto: PatchContactMethodDto,
  ) {
    return this.contactsService.patchMethod(ctx, contactId, methodId, dto);
  }

  @Delete(':contactId/methods/:methodId')
  deleteMethod(
    @RequestContextData() ctx: RequestContext,
    @Param('contactId') contactId: string,
    @Param('methodId') methodId: string,
  ) {
    return this.contactsService.deleteMethod(ctx, contactId, methodId);
  }

  @Post(':contactId/addresses')
  createAddress(
    @RequestContextData() ctx: RequestContext,
    @Param('contactId') contactId: string,
    @Body() dto: CreateContactAddressDto,
  ) {
    return this.contactsService.createAddress(ctx, contactId, dto);
  }

  @Patch(':contactId/addresses/:addressId')
  patchAddress(
    @RequestContextData() ctx: RequestContext,
    @Param('contactId') contactId: string,
    @Param('addressId') addressId: string,
    @Body() dto: PatchContactAddressDto,
  ) {
    return this.contactsService.patchAddress(ctx, contactId, addressId, dto);
  }

  @Delete(':contactId/addresses/:addressId')
  deleteAddress(
    @RequestContextData() ctx: RequestContext,
    @Param('contactId') contactId: string,
    @Param('addressId') addressId: string,
  ) {
    return this.contactsService.deleteAddress(ctx, contactId, addressId);
  }

  @Post(':contactId/tags/:tagId')
  assignTag(
    @RequestContextData() ctx: RequestContext,
    @Param('contactId') contactId: string,
    @Param('tagId') tagId: string,
  ) {
    return this.contactsService.assignTag(ctx, contactId, tagId);
  }

  @Delete(':contactId/tags/:tagId')
  removeTag(
    @RequestContextData() ctx: RequestContext,
    @Param('contactId') contactId: string,
    @Param('tagId') tagId: string,
  ) {
    return this.contactsService.removeTag(ctx, contactId, tagId);
  }
}
