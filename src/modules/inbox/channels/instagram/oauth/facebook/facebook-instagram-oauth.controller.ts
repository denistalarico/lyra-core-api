import {
  BadRequestException,
  Controller,
  Get,
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
import { FacebookInstagramOAuthService } from './facebook-instagram-oauth.service';

@Controller('inbox/channels/instagram/oauth/facebook')
export class FacebookInstagramOAuthController {
  constructor(
    private readonly facebookInstagramOAuthService: FacebookInstagramOAuthService,
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
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      userId: ctx.userId ?? null,
      metadata: this.metadataFromContext(ctx),
    });
  }

  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Query('error_reason') errorReason: string | undefined,
    @Query('error_description') errorDescription: string | undefined,
    @Res() response: Response,
  ) {
    const redirectUrl = await this.facebookInstagramOAuthService.handleCallback(
      {
        code,
        state,
        error,
        errorReason,
        errorDescription,
      },
    );

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
      clientName: managedContext.clientName ?? null,
      managedTenantId: managedContext.managedTenantId,
    };
  }
}
