import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { resolveCompanyAwareScope } from '../../common/context/company-aware-scope';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  RequirePermission,
  RequireProductEntitlement,
} from '../permissions';
import { ConfirmGoogleConnectionDto } from './dto/confirm-google-connection.dto';
import { RevokeGoogleAuthorizationDto } from './dto/revoke-google-authorization.dto';
import { StartGoogleConnectionDto } from './dto/start-google-connection.dto';
import { isGoogleProduct } from './google-oauth.constants';
import { SocialGoogleAuthorizationService } from './social-google-authorization.service';
import { SocialGoogleOAuthService } from './social-google-oauth.service';

const SOCIAL_INTEGRATIONS_PERMISSION =
  'social.settings.integrations.manage.admin';

/**
 * Callback lives at `/api/social/integrations/google/callback`. Every other
 * route is authenticated, entitled to Social and gated by the same
 * integrations permission as Meta Ads / Organic.
 */
@Controller('social/integrations/google')
export class SocialGoogleController {
  constructor(
    private readonly oauth: SocialGoogleOAuthService,
    private readonly authorizations: SocialGoogleAuthorizationService,
  ) {}

  @Get('status')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_INTEGRATIONS_PERMISSION)
  status(@RequestContextData() ctx: RequestContext) {
    return this.authorizations.getStatus(resolveCompanyAwareScope(ctx));
  }

  @Post('connect')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_INTEGRATIONS_PERMISSION)
  connect(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: StartGoogleConnectionDto,
  ) {
    return this.oauth.start({
      scope: resolveCompanyAwareScope(ctx),
      userId: ctx.userId ?? null,
      product: dto.product,
    });
  }

  /** Public: `state` is its only credential and carries no context. */
  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() response: Response,
  ) {
    const redirectUrl = await this.oauth.handleCallback({
      code: typeof code === 'string' ? code : undefined,
      state: typeof state === 'string' ? state : undefined,
      error: typeof error === 'string' ? error : undefined,
    });
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    return response.redirect(302, redirectUrl);
  }

  @Post('confirm')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_INTEGRATIONS_PERMISSION)
  confirm(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: ConfirmGoogleConnectionDto,
  ) {
    return this.oauth.confirm({
      scope: resolveCompanyAwareScope(ctx),
      userId: ctx.userId ?? null,
      sessionId: dto.sessionId,
    });
  }

  @Delete('products/:product')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_INTEGRATIONS_PERMISSION)
  disconnectProduct(
    @RequestContextData() ctx: RequestContext,
    @Param('product') product: string,
  ) {
    if (!isGoogleProduct(product))
      throw new BadRequestException('invalid_product');
    return this.authorizations.disconnectProduct({
      scope: resolveCompanyAwareScope(ctx),
      userId: ctx.userId ?? null,
      product,
    });
  }

  @Post('revoke')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_INTEGRATIONS_PERMISSION)
  revoke(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: RevokeGoogleAuthorizationDto,
  ) {
    return this.authorizations.revoke({
      scope: resolveCompanyAwareScope(ctx),
      userId: ctx.userId ?? null,
      confirm: dto.confirm,
      revokeAtGoogle: dto.revokeAtGoogle === true,
    });
  }
}
