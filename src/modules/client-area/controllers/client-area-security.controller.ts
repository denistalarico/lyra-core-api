import { Header } from '@nestjs/common';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { ClientAreaRequest } from '../client-area.types';
import {
  ClientAreaAuthGuard,
  ClientAreaEnabledGuard,
} from '../guards/client-area.guards';
import {
  ClientAreaChangePasswordDto,
  ClientAreaConfirmTwoFactorDto,
  ClientAreaPasswordProofDto,
  ClientAreaSetupTwoFactorDto,
} from '../dto/client-area-security.dto';
import { ListAuditChangesDto } from '../dto/client-area-access.dto';
import { ClientAreaSecurityService } from '../services/client-area-security.service';
import { ClientAreaRateLimitService } from '../services/client-area-rate-limit.service';

@Controller('client-area/me/security')
@UseGuards(ClientAreaEnabledGuard, ClientAreaAuthGuard)
export class ClientAreaSecurityController {
  constructor(
    private readonly security: ClientAreaSecurityService,
    private readonly limits: ClientAreaRateLimitService,
  ) {}

  private identity(req: ClientAreaRequest, mutation = false) {
    const identity = req.clientAreaIdentity!;
    if (mutation)
      this.limits.consume({
        security_identity: `${identity.tenantId}:${identity.userId}`,
      });
    return identity;
  }
  @Header('Cache-Control', 'private, no-store')
  @Get()
  get(@Req() req: ClientAreaRequest) {
    return this.security.get(this.identity(req));
  }
  @Header('Cache-Control', 'private, no-store')
  @Post('password')
  @HttpCode(200)
  password(
    @Req() req: ClientAreaRequest,
    @Body() dto: ClientAreaChangePasswordDto,
  ) {
    return this.security.changePassword(this.identity(req, true), dto);
  }
  @Header('Cache-Control', 'private, no-store')
  @Post('2fa/email/send')
  @HttpCode(200)
  sendEmailCode(
    @Req() req: ClientAreaRequest,
    @Body() dto: ClientAreaPasswordProofDto,
  ) {
    return this.security.sendEmailCode(this.identity(req, true), dto);
  }
  @Header('Cache-Control', 'private, no-store')
  @Post('2fa/setup')
  @HttpCode(200)
  setup(
    @Req() req: ClientAreaRequest,
    @Body() dto: ClientAreaSetupTwoFactorDto,
  ) {
    return this.security.setupTwoFactor(this.identity(req, true), dto);
  }
  @Header('Cache-Control', 'private, no-store')
  @Post('2fa/confirm')
  @HttpCode(200)
  confirm(
    @Req() req: ClientAreaRequest,
    @Body() dto: ClientAreaConfirmTwoFactorDto,
  ) {
    return this.security.confirmTwoFactor(this.identity(req, true), dto);
  }
  @Header('Cache-Control', 'private, no-store')
  @Post('2fa/disable')
  @HttpCode(200)
  disable(
    @Req() req: ClientAreaRequest,
    @Body() dto: ClientAreaPasswordProofDto,
  ) {
    return this.security.disableTwoFactor(this.identity(req, true), dto);
  }
  @Header('Cache-Control', 'private, no-store')
  @Get('sessions')
  sessions(@Req() req: ClientAreaRequest) {
    return this.security.sessions(this.identity(req));
  }
  @Header('Cache-Control', 'private, no-store')
  @Post('sessions/:sessionId/revoke')
  @HttpCode(200)
  revokeSession(
    @Req() req: ClientAreaRequest,
    @Param('sessionId', new ParseUUIDPipe({ errorHttpStatusCode: 404 }))
    id: string,
  ) {
    return this.security.revokeSession(this.identity(req, true), id);
  }
  @Header('Cache-Control', 'private, no-store')
  @Get('trusted-devices')
  devices(@Req() req: ClientAreaRequest) {
    return this.security.devices(this.identity(req));
  }
  @Header('Cache-Control', 'private, no-store')
  @Post('trusted-devices/current')
  @HttpCode(200)
  trust(
    @Req() req: ClientAreaRequest,
    @Body() dto: ClientAreaPasswordProofDto,
  ) {
    return this.security.trustCurrentDevice(this.identity(req, true), dto);
  }
  @Header('Cache-Control', 'private, no-store')
  @Post('trusted-devices/:deviceId/revoke')
  @HttpCode(200)
  revokeDevice(
    @Req() req: ClientAreaRequest,
    @Param('deviceId', new ParseUUIDPipe({ errorHttpStatusCode: 404 }))
    id: string,
  ) {
    return this.security.revokeDevice(this.identity(req, true), id);
  }
  @Header('Cache-Control', 'private, no-store')
  @Get('login-history')
  history(@Req() req: ClientAreaRequest, @Query() query: ListAuditChangesDto) {
    return this.security.loginHistory(
      this.identity(req),
      query.page ?? 1,
      query.limit ?? 50,
    );
  }
}
