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
  UpdateSocialBoostTemplateDto,
} from './dto';
import { SocialBoostTemplateService } from './services/social-boost-template.service';

const SOCIAL_ADS_VIEW_PERMISSION = 'social.ads.campaign.view.client';
const SOCIAL_ADS_MANAGE_PERMISSION =
  'social.ads.campaign.manage.admin_or_explicit';

@Controller('social/campaigns')
export class SocialCampaignsController {
  constructor(private readonly templates: SocialBoostTemplateService) {}

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
