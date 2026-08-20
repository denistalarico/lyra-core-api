import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RequestContextData } from '../../../../../../common/context/request-context.decorator';
import type { RequestContext } from '../../../../../../common/context/request-context.interface';
import { JwtAuthGuard } from '../../../../../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  RequirePermission,
  RequireProductEntitlement,
} from '../../../../../permissions';
import { SelectFacebookMessengerPageDto } from './dto/select-facebook-messenger-page.dto';
import { FacebookMessengerOAuthService } from './facebook-messenger-oauth.service';

/**
 * The OAuth callback is not declared here on purpose: Facebook Login for
 * Business redirects every Meta channel back to the single whitelisted
 * META_FACEBOOK_OAUTH_CALLBACK_URL, which is routed per session channel type
 * by FacebookLoginCallbackRouterService.
 */
@Controller('inbox/channels/facebook-messenger/oauth/facebook')
export class FacebookMessengerOAuthController {
  constructor(
    private readonly facebookMessengerOAuthService: FacebookMessengerOAuthService,
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

    return this.facebookMessengerOAuthService.start({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
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
    @Body() dto: SelectFacebookMessengerPageDto,
  ) {
    if (!ctx.tenantId || !ctx.workspaceId) {
      throw new BadRequestException(
        'Tenant and workspace context are required.',
      );
    }

    return this.facebookMessengerOAuthService.select({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
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

    return this.facebookMessengerOAuthService.getSessionAssets({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      userId: ctx.userId ?? null,
      sessionId,
    });
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
