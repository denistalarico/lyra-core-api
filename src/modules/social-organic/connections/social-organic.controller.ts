import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
import {
  StartSocialOrganicConnectionDto,
  type SocialOrganicConnectionMode,
} from './dto/start-social-organic-connection.dto';
import { UpdateSocialOrganicAssetTimezoneDto } from './dto/update-social-organic-asset-timezone.dto';
import { SocialOrganicConnectionService } from './social-organic-connection.service';
import { SocialOrganicOAuthService } from './social-organic-oauth.service';
import { MetaOrganicHealthService } from '../providers/meta/meta-organic-health.service';
import { RequestSocialOrganicSyncDto } from '../analytics/dto/request-social-organic-sync.dto';
import { SocialOrganicSyncRunService } from '../analytics/social-organic-sync-run.service';

const SOCIAL_INTEGRATIONS_PERMISSION =
  'social.settings.integrations.manage.admin';
const SOCIAL_ORGANIC_ANALYTICS_PERMISSION =
  'social.analytics.organic.view.operational';

const CONNECTION_MODES: Record<
  SocialOrganicConnectionMode,
  { provider: string; allowedAssetTypes: string[] }
> = {
  facebook: { provider: 'meta', allowedAssetTypes: ['facebook_page'] },
  instagram_facebook: {
    provider: 'meta',
    allowedAssetTypes: ['instagram_professional'],
  },
  instagram_direct: {
    provider: 'instagram',
    allowedAssetTypes: ['instagram_professional'],
  },
};

@Controller('social/organic')
export class SocialOrganicController {
  constructor(
    private readonly oauth: SocialOrganicOAuthService,
    private readonly connections: SocialOrganicConnectionService,
    private readonly health: MetaOrganicHealthService,
    private readonly analyticsRuns: SocialOrganicSyncRunService,
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
    @Body() dto: StartSocialOrganicConnectionDto = { mode: 'facebook' },
  ) {
    const scope = this.requireScope(ctx);
    const connector = CONNECTION_MODES[dto.mode];
    if (!connector || connector.provider !== provider) {
      throw new BadRequestException('invalid_connection');
    }
    return this.oauth.start({
      ...scope,
      userId: ctx.userId ?? null,
      provider,
      connectionMode: dto.mode,
      allowedAssetTypes: connector.allowedAssetTypes,
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

  @Patch('assets/:assetId/timezone')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_INTEGRATIONS_PERMISSION)
  updateAssetTimezone(
    @RequestContextData() ctx: RequestContext,
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @Body() dto: UpdateSocialOrganicAssetTimezoneDto,
  ) {
    return this.connections.updateAssetTimezone({
      ...this.requireScope(ctx),
      assetId,
      timezone: dto.timezone,
    });
  }

  @Post('assets/:assetId/analytics/sync')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ORGANIC_ANALYTICS_PERMISSION)
  requestAnalyticsSync(
    @RequestContextData() ctx: RequestContext,
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @Body() dto: RequestSocialOrganicSyncDto,
  ) {
    return this.analyticsRuns.request({
      ...this.requireScope(ctx),
      assetId,
      fromDate: dto.fromDate,
      toDate: dto.toDate,
    });
  }

  @Post('assets/:assetId/health')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_INTEGRATIONS_PERMISSION)
  async checkAssetHealth(
    @RequestContextData() ctx: RequestContext,
    @Param('assetId', ParseUUIDPipe) assetId: string,
  ) {
    const result = await this.health.checkAsset({
      ...this.requireScope(ctx),
      assetId,
    });

    return {
      assetId: result.assetId,
      status: result.status,
      reason: result.reason,
      checkedAt: result.checkedAt.toISOString(),
    };
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
