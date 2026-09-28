import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  AcceptClientAreaInvitationDto,
  ClientAreaInvitationTokenDto,
  ClientAreaInvitationTwoFactorEmailDto,
} from '../dto/client-area.dto';
import { ClientAreaEnabledGuard } from '../guards/client-area.guards';
import { ClientAreaInvitationService } from '../services/client-area-invitation.service';
import {
  ClientAreaRateLimitService,
  clientAreaRateLimitIp,
} from '../services/client-area-rate-limit.service';

/**
 * CA2 — public invitation endpoints of the Client Area.
 *
 * The token travels in the POST body, never in the API path or query, so it
 * does not land in proxy/access logs. It only locates the invitation: the
 * company, role and email come from the stored row.
 */
@Controller('client-area/invitations')
@UseGuards(ClientAreaEnabledGuard)
export class ClientAreaInvitationsController {
  constructor(
    private readonly invitations: ClientAreaInvitationService,
    private readonly rateLimit: ClientAreaRateLimitService,
  ) {}

  @Post('preview')
  @HttpCode(200)
  preview(@Body() dto: ClientAreaInvitationTokenDto, @Req() req: Request) {
    this.rateLimit.consume({
      invitation_preview_ip: clientAreaRateLimitIp(req),
    });
    return this.invitations.preview(dto.token);
  }

  @Post('accept')
  @HttpCode(200)
  accept(@Body() dto: AcceptClientAreaInvitationDto, @Req() req: Request) {
    this.rateLimit.consume({
      invitation_accept_ip: clientAreaRateLimitIp(req),
    });
    return this.invitations.accept(dto, req);
  }

  @Post('2fa/email/send')
  @HttpCode(200)
  sendTwoFactorEmail(
    @Body() dto: ClientAreaInvitationTwoFactorEmailDto,
    @Req() req: Request,
  ) {
    this.rateLimit.consume({
      two_factor_email_ip: clientAreaRateLimitIp(req),
    });
    return this.invitations.sendTwoFactorEmail(dto.twoFactorToken);
  }
}
