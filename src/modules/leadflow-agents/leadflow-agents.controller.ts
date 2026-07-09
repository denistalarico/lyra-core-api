import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
  LeadFlowAgentDetailResponse,
  LeadFlowAgentListResponse,
  LeadFlowAgentPresetListResponse,
} from './dto';
import { PatchAgentDto, ProvisionAgentDto } from './dto';
import type {
  LeadFlowAgentRuntimeConfigResponse,
  LeadFlowAgentsRuntimeConfigResponse,
} from './dto/leadflow-agent-runtime-config-response.dto';
import { LEADFLOW_AGENTS_PERMISSIONS } from './leadflow-agents.permissions';
import { LeadFlowAgentService } from './services/leadflow-agent.service';

@Controller('leadflow/agents')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('leadflow')
export class LeadFlowAgentsController {
  constructor(private readonly agentService: LeadFlowAgentService) {}

  @Get()
  @RequirePermission(LEADFLOW_AGENTS_PERMISSIONS.view)
  list(
    @RequestContextData() ctx: RequestContext,
  ): Promise<LeadFlowAgentListResponse> {
    return this.agentService.list(ctx);
  }

  @Get('presets')
  @RequirePermission(LEADFLOW_AGENTS_PERMISSIONS.view)
  listPresets(
    @RequestContextData() ctx: RequestContext,
  ): Promise<LeadFlowAgentPresetListResponse> {
    return this.agentService.listPresets(ctx);
  }

  @Get('runtime-config')
  @RequirePermission(LEADFLOW_AGENTS_PERMISSIONS.runtimePreview)
  getContextRuntimeConfig(
    @RequestContextData() ctx: RequestContext,
  ): Promise<LeadFlowAgentsRuntimeConfigResponse> {
    return this.agentService.getContextRuntimeConfig(ctx);
  }

  @Post('provision')
  @RequirePermission(LEADFLOW_AGENTS_PERMISSIONS.manage)
  provision(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: ProvisionAgentDto,
  ): Promise<LeadFlowAgentDetailResponse> {
    return this.agentService.provision(ctx, dto);
  }

  @Get(':id')
  @RequirePermission(LEADFLOW_AGENTS_PERMISSIONS.view)
  getById(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LeadFlowAgentDetailResponse> {
    return this.agentService.getById(ctx, id);
  }

  @Patch(':id')
  @RequirePermission(LEADFLOW_AGENTS_PERMISSIONS.manage)
  patch(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PatchAgentDto,
  ): Promise<LeadFlowAgentDetailResponse> {
    return this.agentService.patch(ctx, id, dto);
  }

  @Post(':id/activate')
  @RequirePermission(LEADFLOW_AGENTS_PERMISSIONS.activate)
  activate(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LeadFlowAgentDetailResponse> {
    return this.agentService.activate(ctx, id);
  }

  @Post(':id/pause')
  @RequirePermission(LEADFLOW_AGENTS_PERMISSIONS.pause)
  pause(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LeadFlowAgentDetailResponse> {
    return this.agentService.pause(ctx, id);
  }

  @Post(':id/publish')
  @RequirePermission(LEADFLOW_AGENTS_PERMISSIONS.publish)
  publish(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LeadFlowAgentDetailResponse> {
    return this.agentService.publish(ctx, id);
  }

  @Get(':id/runtime-config')
  @RequirePermission(LEADFLOW_AGENTS_PERMISSIONS.runtimePreview)
  getAgentRuntimeConfig(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LeadFlowAgentRuntimeConfigResponse> {
    return this.agentService.getAgentRuntimeConfig(ctx, id);
  }
}
