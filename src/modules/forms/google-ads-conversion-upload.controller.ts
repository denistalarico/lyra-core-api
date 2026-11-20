import { Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';
import { resolveCompanyAwareScope } from '../../common/context/company-aware-scope';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  RequirePermission,
  RequireProductEntitlement,
} from '../permissions';
import {
  GoogleAdsConversionConnectionQueryDto,
  GoogleAdsConversionHistoryQueryDto,
  UpdateGoogleAdsConversionUploadDto,
} from './dto/google-ads-conversion-upload.dto';
import { GoogleAdsConversionUploadService } from './services/google-ads-conversion-upload.service';

/** Same permission as every Social integration setting (catalog, admin+). */
const SOCIAL_INTEGRATIONS_PERMISSION =
  'social.settings.integrations.manage.admin';

/**
 * GA-CONV (§5.4): "Enviar conversões ao Google" in Integrações → Google Ads.
 * Lives in the Forms module, which already owns the lead → CRM path and sees
 * both CRMs; the route stays under Social integrations for the FE. Not exposed
 * to the Client Area.
 */
@Controller('social/integrations/google')
export class GoogleAdsConversionUploadController {
  constructor(private readonly service: GoogleAdsConversionUploadService) {}

  @Get('conversion-upload')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_INTEGRATIONS_PERMISSION)
  get(
    @RequestContextData() ctx: RequestContext,
    @Query() query: GoogleAdsConversionConnectionQueryDto,
  ) {
    return this.service.get(resolveCompanyAwareScope(ctx), query.connectionId);
  }

  @Patch('conversion-upload')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_INTEGRATIONS_PERMISSION)
  update(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: UpdateGoogleAdsConversionUploadDto,
  ) {
    return this.service.update(
      resolveCompanyAwareScope(ctx),
      ctx.userId ?? null,
      dto,
    );
  }

  @Get('conversion-upload/history')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_INTEGRATIONS_PERMISSION)
  history(
    @RequestContextData() ctx: RequestContext,
    @Query() query: GoogleAdsConversionHistoryQueryDto,
  ) {
    return this.service.history(
      resolveCompanyAwareScope(ctx),
      query.connectionId,
      query.limit,
    );
  }

  /** Funnels and open stages of both CRMs, for the "qualificado" picker. */
  @Get('conversion-upload/stages')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_INTEGRATIONS_PERMISSION)
  stages(@RequestContextData() ctx: RequestContext) {
    return this.service.stages(resolveCompanyAwareScope(ctx));
  }

  @Get('conversion-actions')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_INTEGRATIONS_PERMISSION)
  conversionActions(
    @RequestContextData() ctx: RequestContext,
    @Query() query: GoogleAdsConversionConnectionQueryDto,
  ) {
    return this.service.conversionActions(
      resolveCompanyAwareScope(ctx),
      query.connectionId,
    );
  }
}
