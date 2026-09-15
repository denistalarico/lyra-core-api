import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  RequirePermission,
  RequireProductEntitlement,
} from '../permissions';
import {
  CreateSocialBoostTemplateDto,
  MetaCampaignHierarchyQueryDto,
  SocialCampaignMonitorQueryDto,
  UpdateSocialCampaignMonitorPolicyDto,
  UpdateSocialBoostTemplateDto,
} from './dto';
import { MetaCampaignHierarchyReadService } from './services/meta-campaign-hierarchy-read.service';
import { SocialCampaignMonitorService } from './services/social-campaign-monitor.service';
import { SocialBoostTemplateService } from './services/social-boost-template.service';

const SOCIAL_ADS_VIEW_PERMISSION = 'social.ads.campaign.view.client';
const SOCIAL_ADS_MANAGE_PERMISSION =
  'social.ads.campaign.manage.admin_or_explicit';

@Controller('social/campaigns')
export class SocialCampaignsController {
  constructor(
    private readonly templates: SocialBoostTemplateService,
    private readonly hierarchy: MetaCampaignHierarchyReadService,
    private readonly monitor: SocialCampaignMonitorService,
  ) {}

  @Get('meta/monitor')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ADS_VIEW_PERMISSION)
  monitorOverview(
    @RequestContextData() ctx: RequestContext,
    @Query() query: SocialCampaignMonitorQueryDto,
  ) {
    return this.monitor.overview(this.requireScope(ctx), query.connectionId);
  }

  @Patch('meta/monitor/policy')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ADS_MANAGE_PERMISSION)
  updateMonitorPolicy(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: UpdateSocialCampaignMonitorPolicyDto,
  ) {
    return this.monitor.updatePolicy(this.requireScope(ctx), ctx.userId ?? null, dto);
  }

  /** Evaluates the local mirror now. It never calls or mutates Meta. */
  @Post('meta/monitor/evaluate')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ADS_MANAGE_PERMISSION)
  evaluateMonitor(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: SocialCampaignMonitorQueryDto,
  ) {
    return this.monitor.evaluate(this.requireScope(ctx), dto.connectionId);
  }

  @Patch('meta/alerts/:alertId/acknowledge')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ADS_MANAGE_PERMISSION)
  acknowledgeAlert(
    @RequestContextData() ctx: RequestContext,
    @Param('alertId', ParseUUIDPipe) alertId: string,
  ) {
    return this.monitor.acknowledge(
      this.requireScope(ctx),
      alertId,
      ctx.userId ?? null,
    );
  }

  @Get('meta/hierarchy')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ADS_VIEW_PERMISSION)
  metaHierarchy(
    @RequestContextData() ctx: RequestContext,
    @Query() query: MetaCampaignHierarchyQueryDto,
  ) {
    return this.hierarchy.read({
      ...this.requireScope(ctx),
      connectionId: query.connectionId,
      since: query.since,
      until: query.until,
      status: query.status,
      search: query.search,
      page: query.page,
      limit: query.limit,
    });
  }

  @Get('boost-templates')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ADS_VIEW_PERMISSION)
  list(
    @RequestContextData() ctx: RequestContext,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.templates.list(
      this.requireScope(ctx),
      includeInactive === 'true',
    );
  }

  @Post('boost-templates')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ADS_MANAGE_PERMISSION)
  create(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateSocialBoostTemplateDto,
  ) {
    return this.templates.create(this.requireScope(ctx), ctx.userId ?? null, dto);
  }

  @Patch('boost-templates/:templateId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ADS_MANAGE_PERMISSION)
  update(
    @RequestContextData() ctx: RequestContext,
    @Param('templateId', ParseUUIDPipe) templateId: string,
    @Body() dto: UpdateSocialBoostTemplateDto,
  ) {
    return this.templates.update(
      this.requireScope(ctx),
      templateId,
      ctx.userId ?? null,
      dto,
    );
  }

  /** Scope is server-resolved; no DTO accepts tenant, workspace or client. */
  private requireScope(ctx: RequestContext) {
    if (!ctx.tenantId || !ctx.workspaceId) {
      throw new BadRequestException('Tenant and workspace context are required.');
    }

    const managedContext = ctx.managedContext;
    const agencyClientId =
      managedContext?.operatingMode === 'client'
        ? (managedContext.clientId ?? null)
        : null;

    if (managedContext?.operatingMode === 'client' && !agencyClientId) {
      throw new BadRequestException('Client context is required.');
    }

    return { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, agencyClientId };
  }
}
