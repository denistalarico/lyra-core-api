import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ClientAreaExposed } from '../client-area/client-area.decorators';
import {
  PermissionsGuard,
  RequirePermission,
  RequireProductEntitlement,
} from '../permissions';
import {
  CreateLeadFlowClientSettingsDto,
  LeadFlowClientSettingsResponse,
  LeadFlowSettingsValidationResponse,
  PublishCompanyContextDto,
  SetLeadFlowDeveloperModeDto,
  UpdateLeadFlowClientSettingsDto,
  ValidateLeadFlowClientSettingsDto,
} from './dto';
import { LeadFlowClientSettingsService } from './services/leadflow-client-settings.service';

@Controller('leadflow/agency/settings')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('leadflow')
export class LeadFlowAgencySettingsController {
  constructor(
    private readonly leadFlowClientSettingsService: LeadFlowClientSettingsService,
  ) {}

  @Get()
  @ClientAreaExposed('leadflow_agents')
  @RequirePermission('leadflow.settings.general.view.admin')
  getSettings(
    @RequestContextData() ctx: RequestContext,
  ): Promise<LeadFlowClientSettingsResponse> {
    return this.leadFlowClientSettingsService.getAgencySettings(ctx);
  }

  @Post()
  @ClientAreaExposed('leadflow_agents')
  @RequirePermission('leadflow.settings.general.update.admin')
  createSettings(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateLeadFlowClientSettingsDto,
  ): Promise<LeadFlowClientSettingsResponse> {
    return this.leadFlowClientSettingsService.createAgencySettings(ctx, dto);
  }

  @Patch()
  @ClientAreaExposed('leadflow_agents')
  @RequirePermission('leadflow.settings.general.update.admin')
  updateSettings(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: UpdateLeadFlowClientSettingsDto,
  ): Promise<LeadFlowClientSettingsResponse> {
    return this.leadFlowClientSettingsService.updateAgencySettings(ctx, dto);
  }

  @Patch('developer-mode')
  @ClientAreaExposed('leadflow_agents')
  @RequirePermission('leadflow.settings.danger_zone.manage.owner_only')
  setDeveloperMode(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: SetLeadFlowDeveloperModeDto,
  ): Promise<LeadFlowClientSettingsResponse> {
    return this.leadFlowClientSettingsService.setDeveloperMode(
      ctx,
      null,
      dto.enabled,
    );
  }

  @Post('validate')
  @ClientAreaExposed('leadflow_agents')
  @RequirePermission('leadflow.settings.general.view.admin')
  validateSettings(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: ValidateLeadFlowClientSettingsDto,
  ): Promise<LeadFlowSettingsValidationResponse> {
    return this.leadFlowClientSettingsService.validateAgencySettings(ctx, dto);
  }

  @Post('company-context/publish')
  @ClientAreaExposed('leadflow_agents')
  @RequirePermission('leadflow.settings.general.update.admin')
  publishCompanyContext(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: PublishCompanyContextDto,
  ) {
    return this.leadFlowClientSettingsService.publishCompanyContext(
      ctx,
      undefined,
      dto?.expectedDraftHash,
    );
  }

  @Get('company-context/preview')
  @ClientAreaExposed('leadflow_agents')
  @RequirePermission('leadflow.settings.general.view.admin')
  previewCompanyContext(@RequestContextData() ctx: RequestContext) {
    return this.leadFlowClientSettingsService.previewCompanyContext(ctx);
  }
}
