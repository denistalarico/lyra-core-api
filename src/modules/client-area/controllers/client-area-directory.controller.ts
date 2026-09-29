import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ClientAreaContextData } from '../client-area.decorators';
import type {
  ClientAreaContext,
  ClientAreaRequest,
} from '../client-area.types';
import {
  ClientAreaAuthGuard,
  ClientAreaEnabledGuard,
  ClientAreaMembershipGuard,
} from '../guards/client-area.guards';
import { ClientAreaDirectoryService } from '../services/client-area-directory.service';

/**
 * Client Area directory. Identity comes from the verified token + live
 * session (`request.clientAreaIdentity`); no header is read.
 */
@Controller('client-area')
@UseGuards(ClientAreaEnabledGuard, ClientAreaAuthGuard)
export class ClientAreaDirectoryController {
  constructor(private readonly directory: ClientAreaDirectoryService) {}

  @Get('me')
  me(@Req() req: ClientAreaRequest) {
    return this.directory.me(req.clientAreaIdentity!);
  }

  @Get('companies')
  async companies(@Req() req: ClientAreaRequest) {
    return {
      companies: await this.directory.listCompanies(req.clientAreaIdentity!),
    };
  }

  @Get('companies/:companyContextId/context')
  @UseGuards(ClientAreaMembershipGuard)
  async context(@ClientAreaContextData() context: ClientAreaContext) {
    return { context: await this.directory.projectContext(context) };
  }
}
