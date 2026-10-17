import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ClientAreaContextData } from '../client-area.decorators';
import type { ClientAreaContext } from '../client-area.types';
import {
  ClientAreaAuthGuard,
  ClientAreaEnabledGuard,
  ClientAreaMembershipGuard,
} from '../guards/client-area.guards';
import {
  ClientAreaConsentDecisionDto,
  PutClientAreaModuleAccessDto,
} from '../dto/client-area-access.dto';
import { ClientAreaMemberAccessService } from '../services/client-area-member-access.service';
import { ClientAreaConsentService } from '../services/client-area-consent.service';

@Controller('client-area/companies/:companyContextId')
@UseGuards(
  ClientAreaEnabledGuard,
  ClientAreaAuthGuard,
  ClientAreaMembershipGuard,
)
export class ClientAreaAccessController {
  constructor(
    private readonly access: ClientAreaMemberAccessService,
    private readonly consent: ClientAreaConsentService,
  ) {}
  @Get('consent') getConsent(@ClientAreaContextData() ctx: ClientAreaContext) {
    return this.consent.get(ctx);
  }
  @Post('consent/decision')
  @HttpCode(200)
  decide(
    @ClientAreaContextData() ctx: ClientAreaContext,
    @Body() dto: ClientAreaConsentDecisionDto,
  ) {
    return this.consent.decide(ctx, dto);
  }
  @Get('settings/members') members(
    @ClientAreaContextData() ctx: ClientAreaContext,
  ) {
    return this.access.list(ctx, ctx.agencyClientId, ctx.companyContextId);
  }
  @Get('settings/members/:membershipId/modules') modules(
    @ClientAreaContextData() ctx: ClientAreaContext,
    @Param('membershipId') id: string,
  ) {
    return this.access.get(ctx, ctx.agencyClientId, ctx.companyContextId, id);
  }
  @Put('settings/members/:membershipId/modules') putModules(
    @ClientAreaContextData() ctx: ClientAreaContext,
    @Param('membershipId') id: string,
    @Body() dto: PutClientAreaModuleAccessDto,
  ) {
    return this.access.put(
      ctx,
      ctx.agencyClientId,
      ctx.companyContextId,
      id,
      dto.moduleLevels,
    );
  }
  @Post('settings/members/:membershipId/transfer-ownership')
  @HttpCode(200)
  transfer(
    @ClientAreaContextData() ctx: ClientAreaContext,
    @Param('membershipId') id: string,
  ) {
    return this.access.transfer(
      ctx,
      ctx.agencyClientId,
      ctx.companyContextId,
      id,
    );
  }
  @Post('settings/members/:membershipId/revoke')
  @HttpCode(200)
  revoke(
    @ClientAreaContextData() ctx: ClientAreaContext,
    @Param('membershipId') id: string,
  ) {
    return this.access.revoke(ctx, id);
  }
}
