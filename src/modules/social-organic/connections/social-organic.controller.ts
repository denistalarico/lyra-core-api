import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { RequestContextData } from '../../../common/context/request-context.decorator';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  RequirePermission,
  RequireProductEntitlement,
} from '../../permissions';
import { SelectSocialOrganicAssetsDto } from './dto/select-social-organic-assets.dto';
import { SocialOrganicConnectionService } from './social-organic-connection.service';
import { SocialOrganicOAuthService } from './social-organic-oauth.service';

const SOCIAL_INTEGRATIONS_PERMISSION =
  'social.settings.integrations.manage.admin';

@Controller('social/organic')
export class SocialOrganicController {
  constructor(
    private readonly oauth: SocialOrganicOAuthService,
    private readonly connections: SocialOrganicConnectionService,
  ) {}

  @Get('connections')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_INTEGRATIONS_PERMISSION)
  async list(@RequestContextData() ctx: RequestContext) {
    const items = await this.connections.list(this.requireScope(ctx));
    return { items, total: items.length };
  }

  @Post('oauth/:provider/connect')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_INTEGRATIONS_PERMISSION)
  connect(
    @RequestContextData() ctx: RequestContext,
    @Param('provider') provider: string,
  ) {
    const scope = this.requireScope(ctx);
    return this.oauth.start({
      ...scope,
      userId: ctx.userId ?? null,
      provider,
    });
  }

  /** Public callback; the single-use, TTL'd state is its authorization. */
  @Get('oauth/:provider/callback')
  async callback(
    @Param('provider') provider: string,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Query('error_reason') errorReason: string | undefined,
    @Query('error_description') errorDescription: string | undefined,
    @Res() response: Response,
  ) {
    const redirectUrl = await this.oauth.handleCallback({
      provider,
      code,
      state,
      error,
      errorReason,
      errorDescription,
    });
    return response.redirect(302, redirectUrl);
  }

  @Post('oauth/:provider/select')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_INTEGRATIONS_PERMISSION)
  select(
    @RequestContextData() ctx: RequestContext,
    @Param('provider') provider: string,
    @Body() dto: SelectSocialOrganicAssetsDto,
  ) {
    const scope = this.requireScope(ctx);
    return this.oauth.select({
      ...scope,
      userId: ctx.userId ?? null,
      provider,
      connectionId: dto.connectionId,
      externalAssetIds: dto.externalAssetIds,
    });
  }

  @Delete('connections/:connectionId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_INTEGRATIONS_PERMISSION)
  disconnect(
    @RequestContextData() ctx: RequestContext,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
  ) {
    return this.connections.disconnect({
      ...this.requireScope(ctx),
      connectionId,
    });
  }

  private requireScope(ctx: RequestContext) {
    if (!ctx.tenantId || !ctx.workspaceId) {
      throw new BadRequestException(
        'Tenant and workspace context are required.',
      );
    }

    const managedContext = ctx.managedContext;
    const agencyClientId =
      managedContext?.operatingMode === 'client'
        ? (managedContext.clientId ?? null)
        : null;

    if (managedContext?.operatingMode === 'client' && !agencyClientId) {
      throw new BadRequestException('Client context is required.');
    }

    return {
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      agencyClientId,
    };
  }
}
