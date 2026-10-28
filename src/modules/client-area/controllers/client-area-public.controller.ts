import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ClientAreaEnabledGuard } from '../guards/client-area.guards';
import { ClientAreaPublicBrandingService } from '../services/client-area-public-branding.service';
import {
  ClientAreaRateLimitService,
  clientAreaRateLimitIp,
} from '../services/client-area-rate-limit.service';

@Controller('client-area/public')
@UseGuards(ClientAreaEnabledGuard)
export class ClientAreaPublicController {
  constructor(
    private readonly branding: ClientAreaPublicBrandingService,
    private readonly limits: ClientAreaRateLimitService,
  ) {}
  @Get('branding')
  @Header('Cache-Control', 'no-store')
  get(@Query('a') slug: string | undefined, @Req() req: Request) {
    this.limits.consume({ branding_ip: clientAreaRateLimitIp(req) });
    // Public selector only, never an identity/scope header. The web proxy
    // passes its observed Host here without changing the API upstream Host.
    // The resolver still requires a fresh verified domain from the database.
    const webHost = req.headers['x-lyra-client-area-host'];
    return this.branding.resolve(
      slug,
      typeof webHost === 'string' ? webHost : (req.headers.host ?? ''),
    );
  }
  /** Caddy `on_demand_tls.ask` (appends `?domain=`): 200 issues, 404 refuses. */
  @Get('tls-allowed')
  @Header('Cache-Control', 'no-store')
  async tlsAllowed(@Query('domain') domain: unknown, @Req() req: Request) {
    const forwarded = Boolean(
      req.headers['x-forwarded-for'] ?? req.headers['x-real-ip'],
    );
    if (
      !(await this.branding.isTlsAllowed(
        domain,
        req.socket.remoteAddress,
        forwarded,
      ))
    )
      throw new NotFoundException();
    return { allowed: true };
  }
}
