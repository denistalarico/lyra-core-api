import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
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
import type {
  LeadFlowAutomationDetailResponse,
  LeadFlowAutomationCatalogResponse,
  LeadFlowAutomationListResponse,
  LeadFlowAutomationRecipeListResponse,
  LeadFlowAutomationRunDetailResponse,
  LeadFlowAutomationRunListResponse,
} from './dto';
import {
  DryRunAutomationDto,
  ExecuteCrmAutomationActionDto,
  mapRunDetail,
  PatchAutomationDto,
  PublishAutomationDto,
  ProvisionAutomationDto,
  UpdateLeadFlowAutomationGlobalConfigDto,
} from './dto';
import type {
  LeadFlowAutomationDryRunResponse,
  LeadFlowAutomationLogsResponse,
  LeadFlowAutomationRuntimeConfigResponse,
  LeadFlowAutomationsRuntimeConfigResponse,
} from './dto/leadflow-automation-runtime-config-response.dto';
import { LEADFLOW_AUTOMATIONS_PERMISSIONS } from './leadflow-automations.permissions';
import type { LeadFlowAutomationGlobalDefaultsSnapshot } from './types/leadflow-automation.types';
import { LeadFlowAutomationService } from './services/leadflow-automation.service';
import { LeadFlowAutomationCrmActionService } from './services/leadflow-automation-crm-action.service';

@Controller('leadflow/automations')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('leadflow')
export class LeadFlowAutomationsController {
  constructor(
    private readonly automationService: LeadFlowAutomationService,
    private readonly crmActionService: LeadFlowAutomationCrmActionService,
  ) {}

  @Get('recipes')
  @RequirePermission(LEADFLOW_AUTOMATIONS_PERMISSIONS.view)
  listRecipes(
    @RequestContextData() ctx: RequestContext,
  ): Promise<LeadFlowAutomationRecipeListResponse> {
    return this.automationService.listRecipes(ctx);
  }

  @Get('catalog')
  @RequirePermission(LEADFLOW_AUTOMATIONS_PERMISSIONS.view)
  listCatalog(
    @RequestContextData() ctx: RequestContext,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<LeadFlowAutomationCatalogResponse> {
    return this.automationService.listCatalog(ctx, {
      page: parsePositiveInteger(page),
      pageSize: parsePositiveInteger(pageSize),
    });
  }

  @Get()
  @RequirePermission(LEADFLOW_AUTOMATIONS_PERMISSIONS.view)
  list(
    @RequestContextData() ctx: RequestContext,
  ): Promise<LeadFlowAutomationListResponse> {
    return this.automationService.list(ctx);
  }

  @Get('runtime-config')
  @RequirePermission(LEADFLOW_AUTOMATIONS_PERMISSIONS.runtimePreview)
  getContextRuntimeConfig(
    @RequestContextData() ctx: RequestContext,
  ): Promise<LeadFlowAutomationsRuntimeConfigResponse> {
    return this.automationService.getContextRuntimeConfig(ctx);
  }

  @Post('provision')
  @RequirePermission(LEADFLOW_AUTOMATIONS_PERMISSIONS.configure)
  provision(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: ProvisionAutomationDto,
  ): Promise<LeadFlowAutomationDetailResponse> {
    return this.automationService.provision(ctx, dto);
  }

  /** Versioned defaults for the active agency/client Settings context. */
  @Get('settings')
  @RequirePermission(LEADFLOW_AUTOMATIONS_PERMISSIONS.view)
  getGlobalDefaults(
    @RequestContextData() ctx: RequestContext,
  ): Promise<LeadFlowAutomationGlobalDefaultsSnapshot> {
    return this.automationService.getGlobalDefaults(ctx);
  }

  @Put('settings')
  @RequirePermission(LEADFLOW_AUTOMATIONS_PERMISSIONS.configure)
  updateGlobalDefaults(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: UpdateLeadFlowAutomationGlobalConfigDto,
  ): Promise<LeadFlowAutomationGlobalDefaultsSnapshot> {
    return this.automationService.updateGlobalDefaults(ctx, dto);
  }

  @Get(':id')
  @RequirePermission(LEADFLOW_AUTOMATIONS_PERMISSIONS.view)
  getById(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LeadFlowAutomationDetailResponse> {
    return this.automationService.getById(ctx, id);
  }

  @Patch(':id')
  @RequirePermission(LEADFLOW_AUTOMATIONS_PERMISSIONS.configure)
  patch(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PatchAutomationDto,
  ): Promise<LeadFlowAutomationDetailResponse> {
    return this.automationService.patch(ctx, id, dto);
  }

  @Post(':id/activate')
  @RequirePermission(LEADFLOW_AUTOMATIONS_PERMISSIONS.activate)
  activate(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LeadFlowAutomationDetailResponse> {
    return this.automationService.activate(ctx, id);
  }

  @Post(':id/pause')
  @RequirePermission(LEADFLOW_AUTOMATIONS_PERMISSIONS.pause)
  pause(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LeadFlowAutomationDetailResponse> {
    return this.automationService.pause(ctx, id);
  }

  @Post(':id/publish')
  @RequirePermission(LEADFLOW_AUTOMATIONS_PERMISSIONS.publish)
  publish(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PublishAutomationDto,
  ): Promise<LeadFlowAutomationDetailResponse> {
    return this.automationService.publish(ctx, id, dto);
  }

  @Get(':id/runtime-config')
  @RequirePermission(LEADFLOW_AUTOMATIONS_PERMISSIONS.runtimePreview)
  getAutomationRuntimeConfig(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LeadFlowAutomationRuntimeConfigResponse> {
    return this.automationService.getAutomationRuntimeConfig(ctx, id);
  }

  @Get(':id/logs')
  @RequirePermission(LEADFLOW_AUTOMATIONS_PERMISSIONS.logsView)
  getLogs(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LeadFlowAutomationLogsResponse> {
    return this.automationService.getLogs(ctx, id);
  }

  @Get(':id/runs')
  @RequirePermission(LEADFLOW_AUTOMATIONS_PERMISSIONS.logsView)
  listRuns(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LeadFlowAutomationRunListResponse> {
    return this.automationService.listRuns(ctx, id);
  }

  @Get(':id/runs/:runId')
  @RequirePermission(LEADFLOW_AUTOMATIONS_PERMISSIONS.logsView)
  getRun(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('runId', ParseUUIDPipe) runId: string,
  ): Promise<LeadFlowAutomationRunDetailResponse> {
    return this.automationService.getRun(ctx, id, runId);
  }

  /**
   * Evaluates the configuration against a simulated situation and records the
   * result as a run. Side-effect free, so it stays behind the developer
   * permission only because it exposes the evaluation internals.
   */
  @Post(':id/dry-run')
  @RequirePermission(LEADFLOW_AUTOMATIONS_PERMISSIONS.developerManage)
  dryRun(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DryRunAutomationDto,
  ): Promise<LeadFlowAutomationDryRunResponse> {
    return this.automationService.dryRun(ctx, id, dto);
  }

  /**
   * Controlled live boundary for CRM effects. It does not subscribe to events
   * or schedule work; future runtimes call the same service after delivery.
   */
  @Post(':id/actions/crm')
  @RequirePermission(LEADFLOW_AUTOMATIONS_PERMISSIONS.execute)
  async executeCrmAction(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExecuteCrmAutomationActionDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<LeadFlowAutomationRunDetailResponse> {
    const { run, attempts } = await this.crmActionService.execute(
      ctx,
      id,
      dto,
      idempotencyKey,
    );
    return mapRunDetail(run, attempts);
  }
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}
