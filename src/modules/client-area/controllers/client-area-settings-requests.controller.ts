import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsEmail, IsObject, IsString, Length } from 'class-validator';
import { CLIENT_AREA_ERROR_CODES } from '../client-area.types';
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
import { ClientAreaInvitationService } from '../services/client-area-invitation.service';
import { clientAreaCodedError } from '../services/client-area-membership.service';

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

/** F4 (2026-11-24) — direct invitation by the Client Owner. */
export class ClientAreaDirectInvitationDto {
  @IsEmail() @Length(3, 160) email!: string;
  @IsObject() moduleLevels!: ClientAreaModuleLevels;
}

/**
 * F4 (2026-11-24) — the Client Owner invites, resends and cancels directly,
 * through the same `ClientAreaInvitationService` as the Agency route (one
 * flow, one table, one audit). The company is the session's membership; the
 * service re-checks the active Owner row in the transaction. Non-Owner and
 * input errors answer 400/409 with a stable code, never 401/403. No
 * dependency on the Conversations module.
 */
@Controller(
  'client-area/companies/:companyContextId/settings/members/invitations',
)
@UseGuards(
  ClientAreaEnabledGuard,
  ClientAreaAuthGuard,
  ClientAreaMembershipGuard,
)
export class ClientAreaSettingsInvitationsController {
  constructor(
    private readonly invitations: ClientAreaInvitationService,
    private readonly limits: ClientAreaRateLimitService,
  ) {}

  private owner(ctx: ClientAreaContext, spend = true) {
    toCompanyAwareScope(ctx);
    if (ctx.role !== 'client_owner')
      throw clientAreaCodedError(
        ConflictException,
        409,
        CLIENT_AREA_ERROR_CODES.ownerRequired,
        'Only the company Owner can manage invitations.',
      );
    if (spend)
      this.limits.consume({
        security_identity: `${ctx.tenantId}:${ctx.userId}`,
      });
  }

  @Get()
  list(@ClientAreaContextData() ctx: ClientAreaContext) {
    this.owner(ctx, false);
    return this.invitations.listPendingForClient(ctx);
  }

  @Post()
  @HttpCode(201)
  invite(
    @ClientAreaContextData() ctx: ClientAreaContext,
    @Body() dto: ClientAreaDirectInvitationDto,
  ) {
    this.owner(ctx);
    return this.invitations.invite(
      ctx,
      ctx.agencyClientId,
      ctx.companyContextId,
      {
        email: dto.email,
        accountRole: 'client_member',
        moduleLevels: validateModuleLevels(dto.moduleLevels),
      },
    );
  }

  @Post(':invitationId/resend')
  @HttpCode(200)
  resend(
    @ClientAreaContextData() ctx: ClientAreaContext,
    @Param('invitationId') invitationId: string,
  ) {
    this.owner(ctx);
    return this.invitations.resend(
      ctx,
      ctx.agencyClientId,
      ctx.companyContextId,
      invitationId,
    );
  }

  @Post(':invitationId/revoke')
  @HttpCode(200)
  revoke(
    @ClientAreaContextData() ctx: ClientAreaContext,
    @Param('invitationId') invitationId: string,
  ) {
    this.owner(ctx);
    return this.invitations.revokeInvitation(
      ctx,
      ctx.agencyClientId,
      ctx.companyContextId,
      invitationId,
    );
  }
}
