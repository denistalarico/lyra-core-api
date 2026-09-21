import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { RequestContextData } from '../../../../../../common/context/request-context.decorator';
import type { RequestContext } from '../../../../../../common/context/request-context.interface';
import { JwtAuthGuard } from '../../../../../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  RequirePermission,
  RequireProductEntitlement,
} from '../../../../../permissions';
import { FacebookLoginCallbackRouterService } from '../../../meta/oauth/facebook-login-callback-router.service';
import { SelectFacebookInstagramAssetDto } from './dto/select-facebook-instagram-asset.dto';
import { FacebookInstagramOAuthService } from './facebook-instagram-oauth.service';
import { resolveInboxCompanyScope } from '../../../../inbox-company-scope';

@Controller('inbox/channels/instagram/oauth/facebook')
export class FacebookInstagramOAuthController {
  constructor(
    private readonly facebookInstagramOAuthService: FacebookInstagramOAuthService,
    private readonly facebookLoginCallbackRouter: FacebookLoginCallbackRouterService,
  ) {}

  @Post('start')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('leadflow')
  @RequirePermission('leadflow.channels.channel.create.admin')
  start(@RequestContextData() ctx: RequestContext) {
    if (!ctx.tenantId || !ctx.workspaceId) {
      throw new BadRequestException(
        'Tenant and workspace context are required.',
      );
    }

    return this.facebookInstagramOAuthService.start({
      ...resolveInboxCompanyScope(ctx),
      userId: ctx.userId ?? null,
      metadata: this.metadataFromContext(ctx),
    });
  }

  @Post('select')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('leadflow')
  @RequirePermission('leadflow.channels.channel.create.admin')
  select(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: SelectFacebookInstagramAssetDto,
  ) {
    if (!ctx.tenantId || !ctx.workspaceId) {
      throw new BadRequestException(
        'Tenant and workspace context are required.',
      );
    }

    return this.facebookInstagramOAuthService.select({
      ...resolveInboxCompanyScope(ctx),
      userId: ctx.userId ?? null,
      sessionId: dto.sessionId,
      pageId: dto.pageId,
    });
  }

  @Get('session/:sessionId/assets')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('leadflow')
  @RequirePermission('leadflow.channels.channel.create.admin')
  getSessionAssets(
    @RequestContextData() ctx: RequestContext,
    @Param('sessionId') sessionId: string,
  ) {
    if (!ctx.tenantId || !ctx.workspaceId) {
      throw new BadRequestException(
        'Tenant and workspace context are required.',
      );
    }

    return this.facebookInstagramOAuthService.getSessionAssets({
      ...resolveInboxCompanyScope(ctx),
      userId: ctx.userId ?? null,
      sessionId,
    });
  }

  /**
   * Single whitelisted Facebook Login redirect URI: the router resolves which
   * Meta channel flow owns the returned state before delegating.
   */
  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Query('error_reason') errorReason: string | undefined,
    @Query('error_description') errorDescription: string | undefined,
    @Res() response: Response,
  ) {
    const redirectUrl = await this.facebookLoginCallbackRouter.handleCallback({
      code,
      state,
      error,
      errorReason,
      errorDescription,
    });

    return response.redirect(302, redirectUrl);
  }

  private metadataFromContext(ctx: RequestContext) {
    const managedContext = ctx.managedContext;

    if (!managedContext) {
      return { setupSource: 'facebook_login' };
    }

    return {
      setupSource: 'facebook_login',
      productKey: managedContext.productKey,
      operatingMode: managedContext.operatingMode,
      clientId: managedContext.clientId,
      companyContextId: managedContext.companyContextId ?? null,
      clientName: managedContext.clientName ?? null,
      managedTenantId: managedContext.managedTenantId,
    };
  }
}
