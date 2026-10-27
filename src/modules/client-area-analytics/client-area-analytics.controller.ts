import { Controller, Get, UseGuards } from '@nestjs/common';
import type { ClientAreaContext } from '../client-area/client-area.types';
import {
  ClientAreaContextData,
  RequireClientAreaModule,
} from '../client-area/client-area.decorators';
import {
  ClientAreaAuthGuard,
  ClientAreaMembershipGuard,
} from '../client-area/guards/client-area.guards';
import { ClientAreaOverviewService } from './client-area-overview.service';
@Controller('client-area/companies/:companyContextId/overview')
@UseGuards(ClientAreaAuthGuard, ClientAreaMembershipGuard)
@RequireClientAreaModule('overview')
export class ClientAreaOverviewController {
  constructor(private readonly overview: ClientAreaOverviewService) {}
  @Get() get(@ClientAreaContextData() context: ClientAreaContext) {
    return this.overview.get(context);
  }
}
