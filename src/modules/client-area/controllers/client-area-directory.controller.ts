import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import {
  ClientAreaContextData,
  ClientAreaSelfContextData,
} from '../client-area.decorators';
import type {
  ClientAreaContext,
  ClientAreaRequest,
  ClientAreaSelfContext,
} from '../client-area.types';
import {
  ClientAreaAuthGuard,
  ClientAreaEnabledGuard,
  ClientAreaMembershipGuard,
  ClientAreaSelfContextGuard,
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

  /**
   * PD3 §17 — additive union directory. `/companies` above keeps its exact
   * CA1 contract so the existing client frontend is untouched; new clients
   * read this one, which can also carry the agency self-context.
   */
  @Get('contexts')
  async contexts(@Req() req: ClientAreaRequest) {
    return {
      contexts: await this.directory.listContexts(req.clientAreaIdentity!),
    };
  }

  /**
   * PD3 — the agency self-context. A fixed path segment, not a company id:
   * `agency_self` is never resolved as a UUID anywhere.
   */
  @Get('self/context')
  @UseGuards(ClientAreaSelfContextGuard)
  async selfContext(
    @ClientAreaSelfContextData() context: ClientAreaSelfContext,
  ) {
    return { context: await this.directory.projectSelfContext(context) };
  }

  @Get('companies/:companyContextId/context')
  @UseGuards(ClientAreaMembershipGuard)
  async context(@ClientAreaContextData() context: ClientAreaContext) {
    return { context: await this.directory.projectContext(context) };
  }
}
