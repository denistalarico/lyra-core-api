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
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  RequirePermission,
  RequireProductEntitlement,
} from '../permissions';
import { SelectInternalAdAccountDto } from './dto/select-internal-ad-account.dto';
import { SelectMetaAdsAccountDto } from './dto/select-meta-ads-account.dto';
import { SyncInsightsDto } from './dto/sync-insights.dto';
import { MetaAdsOAuthService } from './services/meta-ads-oauth.service';
import { MetaAdsSystemUserService } from './services/meta-ads-system-user.service';
import { SocialAdConnectionService } from './services/social-ad-connection.service';
import { SocialAdHierarchySyncService } from './services/social-ad-hierarchy-sync.service';
import { SocialAdInsightsSyncService } from './services/social-ad-insights-sync.service';
import { mapSocialAdSyncError } from './sync/social-ad-sync.http-error';

/**
 * Permission for every integration operation on this controller.
 *
 * The catalog already carries it (`permission-keys.catalog.ts`), scoped to
 * admin and above. Reading a connection is not a lighter act than managing
 * one: the settings screen is where credentials are administered, and a
 * viewer-level read would expose which client runs ads where.
 */
const SOCIAL_INTEGRATIONS_PERMISSION =
  'social.settings.integrations.manage.admin';

@Controller('social/integrations')
export class SocialIntegrationsController {
  constructor(
    private readonly metaAdsOAuthService: MetaAdsOAuthService,
    private readonly connectionService: SocialAdConnectionService,
    private readonly systemUserService: MetaAdsSystemUserService,
    private readonly hierarchySyncService: SocialAdHierarchySyncService,
    private readonly insightsSyncService: SocialAdInsightsSyncService,
  ) {}

  @Post('meta-ads/connect')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_INTEGRATIONS_PERMISSION)
  connectMetaAds(@RequestContextData() ctx: RequestContext) {
    const scope = this.requireScope(ctx);

    return this.metaAdsOAuthService.start({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      userId: ctx.userId ?? null,
      agencyClientId: scope.agencyClientId,
    });
  }

  /**
   * Public by necessity: this is the URI Meta redirects the browser to, and it
   * carries no session. Authorization comes from the single-use OAuth state,
   * which was minted for an authenticated caller and is consumed here.
   *
   * Deliberately *not* routed through the Inbox's
   * `FacebookLoginCallbackRouterService` — Social must not depend on the
   * messaging module.
   */
  @Get('meta-ads/callback')
  async metaAdsCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Query('error_reason') errorReason: string | undefined,
    @Query('error_description') errorDescription: string | undefined,
    @Res() response: Response,
  ) {
    const redirectUrl = await this.metaAdsOAuthService.handleCallback({
      code,
      state,
      error,
      errorReason,
      errorDescription,
    });

    return response.redirect(302, redirectUrl);
  }

  @Post('meta-ads/select')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_INTEGRATIONS_PERMISSION)
  selectMetaAdsAccount(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: SelectMetaAdsAccountDto,
  ) {
    const scope = this.requireScope(ctx);

    return this.metaAdsOAuthService.select({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      userId: ctx.userId ?? null,
      connectionId: dto.connectionId,
      externalAccountId: dto.externalAccountId,
    });
  }

  /**
   * Whether this scope may connect with the platform's own System User.
   *
   * Answers `false` rather than 404 for everybody else: this is the question
   * the settings screen asks on every load to decide whether to render the
   * option, and a scope that simply has no such option is not an error. The
   * routes that actually touch the token are the ones that 404.
   *
   * Config-only — no provider call, so it costs nothing to ask.
   */
  @Get('meta-ads/internal/availability')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_INTEGRATIONS_PERMISSION)
  internalAvailability(@RequestContextData() ctx: RequestContext) {
    const scope = this.requireScope(ctx);

    return {
      available: this.systemUserService.isAvailable({
        ...scope,
        userId: ctx.userId ?? null,
      }),
    };
  }

  @Get('meta-ads/internal/accounts')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_INTEGRATIONS_PERMISSION)
  async listInternalAdAccounts(@RequestContextData() ctx: RequestContext) {
    const scope = this.requireScope(ctx);

    const items = await this.systemUserService.listAdAccounts({
      ...scope,
      userId: ctx.userId ?? null,
    });

    return { items, total: items.length };
  }

  @Post('meta-ads/internal/select')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_INTEGRATIONS_PERMISSION)
  selectInternalAdAccount(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: SelectInternalAdAccountDto,
  ) {
    const scope = this.requireScope(ctx);

    return this.systemUserService.select({
      ...scope,
      userId: ctx.userId ?? null,
      externalAccountId: dto.externalAccountId,
    });
  }

  @Get('meta-ads/internal/health/:connectionId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_INTEGRATIONS_PERMISSION)
  internalHealth(
    @RequestContextData() ctx: RequestContext,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
  ) {
    const scope = this.requireScope(ctx);

    return this.systemUserService.health({
      ...scope,
      userId: ctx.userId ?? null,
      connectionId,
    });
  }

  @Get('connections')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_INTEGRATIONS_PERMISSION)
  async listConnections(@RequestContextData() ctx: RequestContext) {
    const scope = this.requireScope(ctx);

    const items = await this.connectionService.list({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId,
    });

    return { items, total: items.length };
  }

  @Delete('connections/:connectionId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_INTEGRATIONS_PERMISSION)
  disconnect(
    @RequestContextData() ctx: RequestContext,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
  ) {
    const scope = this.requireScope(ctx);

    return this.connectionService.disconnect({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId,
      connectionId,
    });
  }

  /**
   * Mirrors the ad hierarchy of one connection into `social_ad_entities`.
   *
   * The connection id is the only thing the request contributes, and it is a
   * path parameter rather than a body field. Tenant, workspace and managed
   * client come from the authenticated context and are then re-read from the
   * connection row itself — a body that could name a scope would let an
   * authenticated agency member sync somebody else's ad account into their own
   * workspace.
   *
   * Synchronous: `social_ad_sync_runs` exists but has no worker yet, so a
   * queued response would be a promise nothing keeps.
   */
  @Post('connections/:connectionId/sync/entities')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_INTEGRATIONS_PERMISSION)
  async syncConnectionEntities(
    @RequestContextData() ctx: RequestContext,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
  ) {
    const scope = this.requireScope(ctx);

    try {
      return await this.hierarchySyncService.syncHierarchy({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId,
        connectionId,
      });
    } catch (error) {
      // Credential codes and Graph kinds become statuses here and nowhere else;
      // an unrecognized error travels on unchanged and becomes a 500.
      throw mapSocialAdSyncError(error);
    }
  }

  /**
   * Ingests daily Meta Ads facts for one connection over an explicit window.
   *
   * The body carries the window and nothing else. Tenant, workspace and managed
   * client come from the authenticated context and are then re-read from the
   * connection row itself; the connection id is a path parameter. A body field
   * that could name a scope would let an authenticated agency member ingest
   * somebody else's ad spend into their own workspace.
   *
   * Synchronous, like the hierarchy sync, and for the same reason: the run
   * table has no worker yet.
   */
  @Post('connections/:connectionId/sync/insights')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_INTEGRATIONS_PERMISSION)
  async syncConnectionInsights(
    @RequestContextData() ctx: RequestContext,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
    @Body() dto: SyncInsightsDto,
  ) {
    const scope = this.requireScope(ctx);

    try {
      return await this.insightsSyncService.syncInsights({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId,
        connectionId,
        since: dto.since,
        until: dto.until,
      });
    } catch (error) {
      throw mapSocialAdSyncError(error);
    }
  }

  /**
   * The client binding comes from the server-resolved managed context, never
   * from the request body. A client id supplied by the caller would let an
   * authenticated agency member attach an ad account to any client.
   *
   * `PermissionsGuard` has already verified that this user may operate the
   * `social` product for this client before the handler runs.
   */
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
