import {
  Body,
  Controller,
  Get,
  Param,
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
  CreateLeadFlowClientSettingsDto,
  LeadFlowClientSettingsResponse,
  LeadFlowClientSummaryListResponse,
  LeadFlowCompanyCapacityResponse,
  LeadFlowSettingsValidationResponse,
  ListLeadFlowClientsQueryDto,
  PublishCompanyContextDto,
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

  @Get()
  @RequirePermission('leadflow.settings.general.view.admin')
  listClients(
    @RequestContextData() ctx: RequestContext,
    @Query() query: ListLeadFlowClientsQueryDto,
  ): Promise<LeadFlowClientSummaryListResponse> {
    return this.leadFlowClientSettingsService.listClients(ctx, query);
  }

  @Get('capacity')
  @RequirePermission('leadflow.settings.general.view.admin')
  getCapacity(
    @RequestContextData() ctx: RequestContext,
  ): Promise<LeadFlowCompanyCapacityResponse> {
    return this.leadFlowClientSettingsService.getCapacity(ctx);
  }

  @Get(':agencyClientId/settings')
  @RequirePermission('leadflow.settings.general.view.admin')
  getSettings(
    @RequestContextData() ctx: RequestContext,
    @Param('agencyClientId') agencyClientId: string,
  ): Promise<LeadFlowClientSettingsResponse> {
    return this.leadFlowClientSettingsService.getSettings(ctx, agencyClientId);
  }

  @Post(':agencyClientId/settings')
  @RequirePermission('leadflow.settings.general.update.admin')
  createSettings(
    @RequestContextData() ctx: RequestContext,
    @Param('agencyClientId') agencyClientId: string,
    @Body() dto: CreateLeadFlowClientSettingsDto,
  ): Promise<LeadFlowClientSettingsResponse> {
    return this.leadFlowClientSettingsService.createSettings(
      ctx,
      agencyClientId,
      dto,
    );
  }

  @Patch(':agencyClientId/settings')
  @RequirePermission('leadflow.settings.general.update.admin')
  updateSettings(
    @RequestContextData() ctx: RequestContext,
    @Param('agencyClientId') agencyClientId: string,
    @Body() dto: UpdateLeadFlowClientSettingsDto,
  ): Promise<LeadFlowClientSettingsResponse> {
    return this.leadFlowClientSettingsService.updateSettings(
      ctx,
      agencyClientId,
      dto,
    );
  }

  @Post(':agencyClientId/settings/validate')
  @RequirePermission('leadflow.settings.general.view.admin')
  validateSettings(
    @RequestContextData() ctx: RequestContext,
    @Param('agencyClientId') agencyClientId: string,
    @Body() dto: ValidateLeadFlowClientSettingsDto,
  ): Promise<LeadFlowSettingsValidationResponse> {
    return this.leadFlowClientSettingsService.validateSettings(
      ctx,
      agencyClientId,
      dto,
    );
  }

  @Post(':agencyClientId/settings/company-context/publish')
  @RequirePermission('leadflow.settings.general.update.admin')
  publishCompanyContext(
    @RequestContextData() ctx: RequestContext,
    @Param('agencyClientId') agencyClientId: string,
    @Body() dto: PublishCompanyContextDto,
  ) {
    return this.leadFlowClientSettingsService.publishCompanyContext(
      ctx,
      agencyClientId,
      dto?.expectedDraftHash,
    );
  }

  @Get(':agencyClientId/settings/company-context/preview')
  @RequirePermission('leadflow.settings.general.view.admin')
  previewCompanyContext(
    @RequestContextData() ctx: RequestContext,
    @Param('agencyClientId') agencyClientId: string,
  ) {
    return this.leadFlowClientSettingsService.previewCompanyContext(
      ctx,
      agencyClientId,
    );
  }
}
