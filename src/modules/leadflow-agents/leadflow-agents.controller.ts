import { ClientAreaExposed } from '../client-area/client-area.decorators';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request.type';
import type { ClientAreaRequest } from '../client-area/client-area.types';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { resolveCompanyAwareScope } from '../../common/context/company-aware-scope';
import type { OperationsRoomScope } from './realtime/operations-room-realtime.constants';
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
  LeadFlowOperationsActionListResponse,
  LeadFlowOperationsActionResponse,
} from './dto';
import {
  ConfirmLeadFlowOperationsActionDto,
  CreateLeadFlowOperationsActionDto,
  PatchAgentDto,
  ProvisionAgentDto,
} from './dto';
import type {
  LeadFlowAgentRuntimeConfigResponse,
  LeadFlowAgentsRuntimeConfigResponse,
} from './dto/leadflow-agent-runtime-config-response.dto';
import { LEADFLOW_AGENTS_PERMISSIONS } from './leadflow-agents.permissions';
import {
  LeadFlowAgentService,
  type LeadFlowHandoffTargetResponse,
} from './services/leadflow-agent.service';
import { OperationsRoomStateService } from './services/operations-room-state.service';
import { LeadFlowOperationsActionService } from './services/leadflow-operations-action.service';
import { leadFlowActionAccessOf } from './services/leadflow-operations-action-access.service';

@Controller('leadflow/agents')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('leadflow')
export class LeadFlowAgentsController {
  constructor(
    private readonly agentService: LeadFlowAgentService,
    private readonly operationsRoomStateService: OperationsRoomStateService,
    private readonly operationsActionService: LeadFlowOperationsActionService,
  ) {}

  @ClientAreaExposed('leadflow_agents')
  @Get()
  @RequirePermission(LEADFLOW_AGENTS_PERMISSIONS.view)
  list(
    @RequestContextData() ctx: RequestContext,
  ): Promise<LeadFlowAgentListResponse> {
    return this.agentService.list(ctx);
  }

  @ClientAreaExposed('leadflow_agents')
  @Get('room/state')
  @RequirePermission(LEADFLOW_AGENTS_PERMISSIONS.view)
  async roomState(@RequestContextData() ctx: RequestContext) {
    const listed = await this.agentService.list(ctx);
    if (!ctx.workspaceId) {
      throw new BadRequestException('Workspace context is required.');
    }
    return this.operationsRoomStateService.getSnapshot(
      ctx.tenantId,
      ctx.workspaceId,
      listed.items.map((agent) => agent.id),
    );
  }

  @ClientAreaExposed('leadflow_agents')
  @Get('room/events')
  @RequirePermission(LEADFLOW_AGENTS_PERMISSIONS.view)
  async roomEvents(
    @RequestContextData() ctx: RequestContext,
    @Query('afterRoomVersion') afterRoomVersion = '0',
    @Query('limit') rawLimit = '100',
  ) {
    const listed = await this.agentService.list(ctx);
    if (!ctx.workspaceId) {
      throw new BadRequestException('Workspace context is required.');
    }
    if (!/^[1-9][0-9]{0,2}$/.test(rawLimit)) {
      throw new BadRequestException('Replay limit must be between 1 and 500.');
    }
    const limit = Number(rawLimit);
    if (limit > 500) {
      throw new BadRequestException('Replay limit must be between 1 and 500.');
    }
    return this.operationsRoomStateService.listRoomEventsAfter(
      ctx.tenantId,
      ctx.workspaceId,
      afterRoomVersion,
      listed.items.map((agent) => agent.id),
      roomScopeFor(ctx),
      limit,
    );
  }

  @ClientAreaExposed('leadflow_agents')
  @Get('room/actions')
  @RequirePermission(LEADFLOW_AGENTS_PERMISSIONS.manage)
  listRoomActions(
    @RequestContextData() ctx: RequestContext,
  ): Promise<LeadFlowOperationsActionListResponse> {
    return this.operationsActionService.list(ctx);
  }

  @ClientAreaExposed('leadflow_agents')
  @Post('room/actions')
  @RequirePermission(LEADFLOW_AGENTS_PERMISSIONS.manage)
  proposeRoomAction(
    @RequestContextData() ctx: RequestContext,
    @Req() request: AuthenticatedRequest & ClientAreaRequest,
    @Body() dto: CreateLeadFlowOperationsActionDto,
  ): Promise<LeadFlowOperationsActionResponse> {
    return this.operationsActionService.propose(
      ctx,
      dto,
      leadFlowActionAccessOf(request),
    );
  }

  @ClientAreaExposed('leadflow_agents')
  @Post('room/actions/:actionId/confirm')
  @RequirePermission(LEADFLOW_AGENTS_PERMISSIONS.manage)
  confirmRoomAction(
    @RequestContextData() ctx: RequestContext,
    @Req() request: AuthenticatedRequest & ClientAreaRequest,
    @Param('actionId', ParseUUIDPipe) actionId: string,
    @Body() dto: ConfirmLeadFlowOperationsActionDto,
  ): Promise<LeadFlowOperationsActionResponse> {
    // OR5: the confirmer's own permission for the executed route is checked
    // in the service; `manage` here only opens the room actions.
    return this.operationsActionService.confirm(
      ctx,
      actionId,
      dto,
      leadFlowActionAccessOf(request),
    );
  }

  @ClientAreaExposed('leadflow_agents')
  @Post('room/actions/:actionId/cancel')
  @RequirePermission(LEADFLOW_AGENTS_PERMISSIONS.manage)
  cancelRoomAction(
    @RequestContextData() ctx: RequestContext,
    @Param('actionId', ParseUUIDPipe) actionId: string,
    @Body() dto: ConfirmLeadFlowOperationsActionDto,
  ): Promise<LeadFlowOperationsActionResponse> {
    return this.operationsActionService.cancel(ctx, actionId, dto);
  }

  @ClientAreaExposed('leadflow_agents')
  @Get('presets')
  @RequirePermission(LEADFLOW_AGENTS_PERMISSIONS.view)
  listPresets(
    @RequestContextData() ctx: RequestContext,
  ): Promise<LeadFlowAgentPresetListResponse> {
    return this.agentService.listPresets(ctx);
  }

  @Get('handoff-targets')
  @RequirePermission(LEADFLOW_AGENTS_PERMISSIONS.view)
  listHandoffTargets(
    @RequestContextData() ctx: RequestContext,
  ): Promise<LeadFlowHandoffTargetResponse[]> {
    return this.agentService.listHandoffTargets(ctx);
  }

  @Get('runtime-config')
  @RequirePermission(LEADFLOW_AGENTS_PERMISSIONS.runtimePreview)
  getContextRuntimeConfig(
    @RequestContextData() ctx: RequestContext,
  ): Promise<LeadFlowAgentsRuntimeConfigResponse> {
    return this.agentService.getContextRuntimeConfig(ctx);
  }

  @ClientAreaExposed('leadflow_agents')
  @Post('provision')
  @RequirePermission(LEADFLOW_AGENTS_PERMISSIONS.manage)
  provision(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: ProvisionAgentDto,
  ): Promise<LeadFlowAgentDetailResponse> {
    return this.agentService.provision(ctx, dto);
  }

  @ClientAreaExposed('leadflow_agents')
  @Get(':id')
  @RequirePermission(LEADFLOW_AGENTS_PERMISSIONS.view)
  getById(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LeadFlowAgentDetailResponse> {
    return this.agentService.getById(ctx, id);
  }

  @ClientAreaExposed('leadflow_agents')
  @Patch(':id')
  @RequirePermission(LEADFLOW_AGENTS_PERMISSIONS.manage)
  patch(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PatchAgentDto,
  ): Promise<LeadFlowAgentDetailResponse> {
    return this.agentService.patch(ctx, id, dto);
  }

  @ClientAreaExposed('leadflow_agents')
  @Post(':id/activate')
  @RequirePermission(LEADFLOW_AGENTS_PERMISSIONS.activate)
  activate(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LeadFlowAgentDetailResponse> {
    return this.agentService.activate(ctx, id);
  }

  @ClientAreaExposed('leadflow_agents')
  @Post(':id/pause')
  @RequirePermission(LEADFLOW_AGENTS_PERMISSIONS.pause)
  pause(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LeadFlowAgentDetailResponse> {
    return this.agentService.pause(ctx, id);
  }

  @ClientAreaExposed('leadflow_agents')
  @Post(':id/publish')
  @RequirePermission(LEADFLOW_AGENTS_PERMISSIONS.publish)
  publish(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LeadFlowAgentDetailResponse> {
    return this.agentService.publish(ctx, id);
  }

  @ClientAreaExposed('leadflow_agents')
  @Post(':id/archive')
  @RequirePermission(LEADFLOW_AGENTS_PERMISSIONS.pause)
  archive(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LeadFlowAgentDetailResponse> {
    return this.agentService.archive(ctx, id);
  }

  @ClientAreaExposed('leadflow_agents')
  @Post(':id/unarchive')
  @RequirePermission(LEADFLOW_AGENTS_PERMISSIONS.pause)
  unarchive(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LeadFlowAgentDetailResponse> {
    return this.agentService.unarchive(ctx, id);
  }

  @Delete(':id')
  @RequirePermission(LEADFLOW_AGENTS_PERMISSIONS.delete)
  remove(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LeadFlowAgentDetailResponse> {
    return this.agentService.softDelete(ctx, id);
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

function roomScopeFor(ctx: RequestContext): OperationsRoomScope {
  const scope = resolveCompanyAwareScope(ctx);
  return scope.agencyClientId && scope.companyContextId
    ? {
        scopeKind: 'company',
        agencyClientId: scope.agencyClientId,
        companyContextId: scope.companyContextId,
      }
    : { scopeKind: 'agency', agencyClientId: null, companyContextId: null };
}
