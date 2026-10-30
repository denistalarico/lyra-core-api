import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ClientAreaExposed } from '../client-area/client-area.decorators';
import { CLIENT_AREA_ACTOR_ROLE } from '../client-area/client-area.types';
import {
  PermissionsGuard,
  RequirePermission,
  RequireProductEntitlement,
} from '../permissions';
import {
  CreateLeadFlowClientSettingsDto,
  LeadFlowClientSettingsResponse,
  LeadFlowClientSummaryListResponse,
  LeadFlowCompanyCapacityResponse,
  LeadFlowSettingsValidationResponse,
  ListLeadFlowClientsQueryDto,
  PublishCompanyContextDto,
  SetLeadFlowDeveloperModeDto,
  UpdateLeadFlowClientSettingsDto,
  ValidateLeadFlowClientSettingsDto,
} from './dto';
import { LeadFlowClientSettingsService } from './services/leadflow-client-settings.service';

@Controller('leadflow/clients')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('leadflow')
export class LeadFlowClientSettingsController {
  constructor(
    private readonly leadFlowClientSettingsService: LeadFlowClientSettingsService,
  ) {}

  private agencyClientId(ctx: RequestContext, requested: string) {
    return ctx.role === CLIENT_AREA_ACTOR_ROLE && ctx.managedContext?.clientId
      ? ctx.managedContext.clientId
      : requested;
  }

  private assertCatalogContext(ctx: RequestContext) {
    if (ctx.role === CLIENT_AREA_ACTOR_ROLE) throw new ForbiddenException();
  }

  @Get()
  @ClientAreaExposed('leadflow_agents')
  @RequirePermission('leadflow.settings.general.view.admin')
  listClients(
    @RequestContextData() ctx: RequestContext,
    @Query() query: ListLeadFlowClientsQueryDto,
  ): Promise<LeadFlowClientSummaryListResponse> {
    this.assertCatalogContext(ctx);
    return this.leadFlowClientSettingsService.listClients(ctx, query);
  }

  @Get('capacity')
  @ClientAreaExposed('leadflow_agents')
  @RequirePermission('leadflow.settings.general.view.admin')
  getCapacity(
    @RequestContextData() ctx: RequestContext,
  ): Promise<LeadFlowCompanyCapacityResponse> {
    this.assertCatalogContext(ctx);
    return this.leadFlowClientSettingsService.getCapacity(ctx);
  }

  @Get(':agencyClientId/settings')
  @ClientAreaExposed('leadflow_agents')
  @RequirePermission('leadflow.settings.general.view.admin')
  getSettings(
    @RequestContextData() ctx: RequestContext,
    @Param('agencyClientId') agencyClientId: string,
  ): Promise<LeadFlowClientSettingsResponse> {
    return this.leadFlowClientSettingsService.getSettings(
      ctx,
      this.agencyClientId(ctx, agencyClientId),
    );
  }

  @Post(':agencyClientId/settings')
  @ClientAreaExposed('leadflow_agents')
  @RequirePermission('leadflow.settings.general.update.admin')
  createSettings(
    @RequestContextData() ctx: RequestContext,
    @Param('agencyClientId') agencyClientId: string,
    @Body() dto: CreateLeadFlowClientSettingsDto,
  ): Promise<LeadFlowClientSettingsResponse> {
    return this.leadFlowClientSettingsService.createSettings(
      ctx,
      this.agencyClientId(ctx, agencyClientId),
      dto,
    );
  }

  @Patch(':agencyClientId/settings')
  @ClientAreaExposed('leadflow_agents')
  @RequirePermission('leadflow.settings.general.update.admin')
  updateSettings(
    @RequestContextData() ctx: RequestContext,
    @Param('agencyClientId') agencyClientId: string,
    @Body() dto: UpdateLeadFlowClientSettingsDto,
  ): Promise<LeadFlowClientSettingsResponse> {
    return this.leadFlowClientSettingsService.updateSettings(
      ctx,
      this.agencyClientId(ctx, agencyClientId),
      dto,
    );
  }

  /**
   * Irreversible: erases the company's LeadFlow configuration and briefing
   * provenance. The service only accepts an already archived context, so this
   * can never be the first destructive step a caller takes.
   */
  @Delete(':agencyClientId/settings')
  @HttpCode(204)
  @RequirePermission('leadflow.settings.danger_zone.manage.owner_only')
  deleteSettings(
    @RequestContextData() ctx: RequestContext,
    @Param('agencyClientId') agencyClientId: string,
  ): Promise<void> {
    return this.leadFlowClientSettingsService.deleteSettings(
      ctx,
      this.agencyClientId(ctx, agencyClientId),
    );
  }

  @Patch(':agencyClientId/settings/developer-mode')
  @ClientAreaExposed('leadflow_agents')
  @RequirePermission('leadflow.settings.danger_zone.manage.owner_only')
  setDeveloperMode(
    @RequestContextData() ctx: RequestContext,
    @Param('agencyClientId') agencyClientId: string,
    @Body() dto: SetLeadFlowDeveloperModeDto,
  ): Promise<LeadFlowClientSettingsResponse> {
    return this.leadFlowClientSettingsService.setDeveloperMode(
      ctx,
      this.agencyClientId(ctx, agencyClientId),
      dto.enabled,
    );
  }

  @Post(':agencyClientId/settings/validate')
  @ClientAreaExposed('leadflow_agents')
  @RequirePermission('leadflow.settings.general.view.admin')
  validateSettings(
    @RequestContextData() ctx: RequestContext,
    @Param('agencyClientId') agencyClientId: string,
    @Body() dto: ValidateLeadFlowClientSettingsDto,
  ): Promise<LeadFlowSettingsValidationResponse> {
    return this.leadFlowClientSettingsService.validateSettings(
      ctx,
      this.agencyClientId(ctx, agencyClientId),
      dto,
    );
  }

  @Post(':agencyClientId/settings/company-context/publish')
  @ClientAreaExposed('leadflow_agents')
  @RequirePermission('leadflow.settings.general.update.admin')
  publishCompanyContext(
    @RequestContextData() ctx: RequestContext,
    @Param('agencyClientId') agencyClientId: string,
    @Body() dto: PublishCompanyContextDto,
  ) {
    return this.leadFlowClientSettingsService.publishCompanyContext(
      ctx,
      this.agencyClientId(ctx, agencyClientId),
      dto?.expectedDraftHash,
    );
  }

  @Get(':agencyClientId/settings/company-context/preview')
  @ClientAreaExposed('leadflow_agents')
  @RequirePermission('leadflow.settings.general.view.admin')
  previewCompanyContext(
    @RequestContextData() ctx: RequestContext,
    @Param('agencyClientId') agencyClientId: string,
  ) {
    return this.leadFlowClientSettingsService.previewCompanyContext(
      ctx,
      this.agencyClientId(ctx, agencyClientId),
    );
  }
}
