import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { AgencyContactsService } from './agency-contacts.service';
import { CreateContactListDto } from '../contacts/dto/create-contact-list.dto';
import { PatchContactListDto } from '../contacts/dto/patch-contact-list.dto';
import { CreateContactDto } from '../contacts/dto/create-contact.dto';
import { PatchContactDto } from '../contacts/dto/patch-contact.dto';

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
  ) {
    return this.agencyContactsService.deleteList(ctx, listId);
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

  @Delete(':contactId')
  deleteContact(
    @RequestContextData() ctx: RequestContext,
    @Param('contactId') contactId: string,
  ) {
    return this.agencyContactsService.deleteContact(ctx, contactId);
  }
}
