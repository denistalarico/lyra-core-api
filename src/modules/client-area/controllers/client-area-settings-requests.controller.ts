import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsEmail, IsObject, IsString, Length } from 'class-validator';
import { ClientAreaContextData } from '../client-area.decorators';
import { toCompanyAwareScope } from '../client-area-scope';
import { validateModuleLevels } from '../client-area-access-validation';
import { ClientAreaSettingsRequestsRegistry } from '../client-area-settings-requests.registry';
import type {
  ClientAreaContext,
  ClientAreaModuleLevels,
} from '../client-area.types';
import {
  ClientAreaAuthGuard,
  ClientAreaEnabledGuard,
  ClientAreaMembershipGuard,
} from '../guards/client-area.guards';
import { ClientAreaRateLimitService } from '../services/client-area-rate-limit.service';

export class ClientAreaInvitationRequestDto {
  @IsString() @Length(1, 160) displayName!: string;
  @IsEmail() @Length(3, 160) email!: string;
  @IsObject() moduleLevels!: ClientAreaModuleLevels;
}
export class ClientAreaDeletionRequestDto {
  @IsString() @Length(1, 2000) reason!: string;
}

@Controller('client-area/companies/:companyContextId/settings/requests')
@UseGuards(
  ClientAreaEnabledGuard,
  ClientAreaAuthGuard,
  ClientAreaMembershipGuard,
)
export class ClientAreaSettingsRequestsController {
  constructor(
    private readonly requests: ClientAreaSettingsRequestsRegistry,
    private readonly limits: ClientAreaRateLimitService,
  ) {}
  private limit(ctx: ClientAreaContext) {
    toCompanyAwareScope(ctx);
    if (!ctx.modules.conversations)
      throw new ForbiddenException('Conversations are unavailable.');
    this.limits.consume({ security_identity: `${ctx.tenantId}:${ctx.userId}` });
  }
  @Post('invitation')
  @HttpCode(201)
  invitation(
    @ClientAreaContextData() ctx: ClientAreaContext,
    @Body() dto: ClientAreaInvitationRequestDto,
  ) {
    if (ctx.role !== 'client_owner')
      throw new ForbiddenException('Only the Owner can request an invitation.');
    this.limit(ctx);
    const moduleLevels = validateModuleLevels(dto.moduleLevels);
    if (
      Object.keys(moduleLevels).some(
        (key) => key === 'agency_billing' || !ctx.modules[key],
      )
    )
      throw new ForbiddenException('The Agency has not enabled this module.');
    return this.requests.publish(ctx, {
      kind: 'invitation_request',
      displayName: dto.displayName.trim(),
      email: dto.email.trim().toLowerCase(),
      moduleLevels,
    });
  }
  @Post('deletion')
  @HttpCode(201)
  deletion(
    @ClientAreaContextData() ctx: ClientAreaContext,
    @Body() dto: ClientAreaDeletionRequestDto,
  ) {
    this.limit(ctx);
    return this.requests.publish(ctx, {
      kind: 'deletion_request',
      reason: dto.reason.trim(),
    });
  }
}
