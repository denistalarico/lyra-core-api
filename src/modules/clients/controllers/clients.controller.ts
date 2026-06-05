import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CreateClientDto, ListClientsQueryDto, UpdateClientDto } from '../dto';
import { ClientsProfitabilityService } from '../services/clients-profitability.service';
import { ClientsService } from '../services/clients.service';

type RequestContext = {
  tenantId: string;
  workspaceId: string;
  userId: string | null;
};

function getContextFromHeaders(
  headers: Record<string, string | string[] | undefined>,
): RequestContext {
  return {
    tenantId: String(headers['x-tenant-id'] ?? ''),
    workspaceId: String(headers['x-workspace-id'] ?? ''),
    userId: headers['x-user-id'] ? String(headers['x-user-id']) : null,
  };
}

@Controller('agency/clients')
export class ClientsController {
  constructor(
    private readonly clientsService: ClientsService,
    private readonly clientsProfitabilityService: ClientsProfitabilityService,
  ) {}

  @Get()
  list(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query() query: ListClientsQueryDto,
  ) {
    return this.clientsService.list(getContextFromHeaders(headers), query);
  }

  @Get('summary')
  summary(@Headers() headers: Record<string, string | string[] | undefined>) {
    return this.clientsService.summary(getContextFromHeaders(headers));
  }

  @Post()
  create(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: CreateClientDto,
  ) {
    return this.clientsService.create(getContextFromHeaders(headers), dto);
  }

  @Get('profitability/portfolio')
  getPortfolioProfitability(
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.clientsProfitabilityService.getPortfolio(
      getContextFromHeaders(headers),
    );
  }

  @Get(':clientId')
  findOne(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('clientId') clientId: string,
  ) {
    return this.clientsService.findOne(
      getContextFromHeaders(headers),
      clientId,
    );
  }

  @Get(':clientId/overview')
  getOverview(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('clientId') clientId: string,
  ) {
    return this.clientsService.getOverview(
      getContextFromHeaders(headers),
      clientId,
    );
  }

  @Get(':clientId/profitability')
  getClientProfitability(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('clientId') clientId: string,
  ) {
    return this.clientsProfitabilityService.getClientProfitability(
      getContextFromHeaders(headers),
      clientId,
    );
  }

  @Patch(':clientId')
  update(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('clientId') clientId: string,
    @Body() dto: UpdateClientDto,
  ) {
    return this.clientsService.update(
      getContextFromHeaders(headers),
      clientId,
      dto,
    );
  }

  @Delete(':clientId')
  archive(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('clientId') clientId: string,
  ) {
    return this.clientsService.archive(
      getContextFromHeaders(headers),
      clientId,
    );
  }
}
