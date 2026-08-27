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
import { EnqueueSyncDto } from './dto/enqueue-sync.dto';
import { SelectInternalAdAccountDto } from './dto/select-internal-ad-account.dto';
import { SelectMetaAdsAccountDto } from './dto/select-meta-ads-account.dto';
import { SyncInsightsDto } from './dto/sync-insights.dto';
import { MetaAdsOAuthService } from './services/meta-ads-oauth.service';
import { MetaAdsSystemUserService } from './services/meta-ads-system-user.service';
import { SocialAdConnectionService } from './services/social-ad-connection.service';
import { SocialAdBackfillResumeService } from './services/social-ad-backfill-resume.service';
import { SocialAdHierarchySyncService } from './services/social-ad-hierarchy-sync.service';
import { SocialAdInsightsSyncService } from './services/social-ad-insights-sync.service';
import { SocialAdSyncRunService } from './services/social-ad-sync-run.service';
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
    private readonly syncRunService: SocialAdSyncRunService,
    private readonly backfillResumeService: SocialAdBackfillResumeService,
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
   * Queues a sync for one connection and answers with the run.
   *
   * The one endpoint that does not touch Meta. It validates — scope, connection,
   * and the window's closed-day rule — and then writes a row; the worker does
   * the reading. That is what makes it usable for a 90-day window: a request
   * that walked the provider inline would hold an HTTP connection open for the
   * length of a paginated read and lose everything it had done if the client
   * gave up halfway.
   *
   * With `since` and `until` it enqueues the full pipeline (hierarchy, then
   * account and campaign insights). Without them it enqueues a hierarchy
   * refresh, which is the only part of the pipeline that has no date dimension.
   *
   * A second identical request while the first is still queued or running
   * answers with that same run rather than creating another — the caller sees
   * one run because there is one piece of work.
   */
  @Post('connections/:connectionId/sync')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_INTEGRATIONS_PERMISSION)
  async enqueueConnectionSync(
    @RequestContextData() ctx: RequestContext,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
    @Body() dto: EnqueueSyncDto,
  ) {
    const scope = this.requireScope(ctx);

    try {
      return await this.syncRunService.request({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId,
        connectionId,
        since: dto.since,
        until: dto.until,
        requestedById: ctx.userId ?? null,
      });
    } catch (error) {
      throw mapSocialAdSyncError(error);
    }
  }

  /**
   * Retries the one window a stalled backfill is stuck on.
   *
   * No body: the window is not the caller's to choose. It is the first chunk of
   * the connection's existing plan that has no succeeded run, and letting a
   * request name dates instead would create a run whose boundaries belong to no
   * chunk — which the chain would then never recognize as covering anything.
   *
   * Refuses with a 409 and a distinct code when there is nothing to resume: no
   * chain, a complete one, or a chain merely waiting its turn. It queues a row
   * and returns it; the worker reads Meta, under the retry policy every other
   * run uses.
   */
  @Post('connections/:connectionId/backfill/resume')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_INTEGRATIONS_PERMISSION)
  async resumeConnectionBackfill(
    @RequestContextData() ctx: RequestContext,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
  ) {
    const scope = this.requireScope(ctx);

    try {
      return await this.backfillResumeService.resume({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId,
        connectionId,
        requestedById: ctx.userId ?? null,
      });
    } catch (error) {
      throw mapSocialAdSyncError(error);
    }
  }

  /**
   * The recent history of one connection's syncs.
   *
   * The answer to "why is yesterday missing?", which is the only question
   * anyone asks about a sync. Runs are returned sanitized: no lock holder, no
   * cursor state, no scope columns, and every error already reduced to a code
   * where it was recorded.
   *
   * A connection outside the caller's scope produces an empty list — the same
   * answer as a connection with no history, so nothing here confirms whether an
   * id exists.
   */
  @Get('connections/:connectionId/sync-runs')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_INTEGRATIONS_PERMISSION)
  async listConnectionSyncRuns(
    @RequestContextData() ctx: RequestContext,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
  ) {
    const scope = this.requireScope(ctx);

    const items = await this.syncRunService.listRecent({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId,
      connectionId,
    });

    return { items, total: items.length };
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
