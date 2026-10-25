import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request.type';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ClientAreaExposed } from '../client-area/client-area.decorators';
import type { ClientAreaRequest } from '../client-area/client-area.types';
import { LEADFLOW_AGENTS_PERMISSIONS } from '../leadflow-agents/leadflow-agents.permissions';
import {
  PermissionsGuard,
  RequirePermission,
  RequireProductEntitlement,
} from '../permissions';
import { CreateOrionTurnDto } from './dto/create-orion-turn.dto';
import { OrionService } from './orion.service';
import type { OrionStatusResponse, OrionTurnResponse } from './orion.types';
import type { OrionAccess } from './tools/orion-tool-access.service';

/**
 * OR4 — the Orion in the Operations Room, for the Agency and (through the
 * Client Area bridge, module `leadflow_agents`) for the company's members.
 *
 * - `GET status`: anyone who sees the room (`agents.view`).
 * - `POST turns`: `leadflow.agents.agent.use.client` (every Agency role). On
 *   the bridge the grant is projected for `operator`/`manager` only and
 *   carries `cost: 'ai'`, so the company's AI-cost switch applies.
 *
 * The principal handed to the tools is built here from the authenticated
 * request; the body never carries scope.
 */
@Controller('orion')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('leadflow')
export class OrionController {
  constructor(private readonly orion: OrionService) {}

  @ClientAreaExposed('leadflow_agents')
  @Get('status')
  @RequirePermission(LEADFLOW_AGENTS_PERMISSIONS.view)
  status(
    @RequestContextData() ctx: RequestContext,
    @Req() request: AuthenticatedRequest & ClientAreaRequest,
  ): Promise<OrionStatusResponse> {
    return this.orion.status(ctx, accessOf(request));
  }

  @ClientAreaExposed('leadflow_agents')
  @Post('turns')
  @HttpCode(200)
  @RequirePermission('leadflow.agents.agent.use.client')
  turn(
    @RequestContextData() ctx: RequestContext,
    @Req() request: AuthenticatedRequest & ClientAreaRequest,
    @Body() dto: CreateOrionTurnDto,
  ): Promise<OrionTurnResponse> {
    return this.orion.runTurn(ctx, accessOf(request), dto);
  }
}

function accessOf(
  request: AuthenticatedRequest & ClientAreaRequest,
): OrionAccess {
  const user = request.user;
  if (user?.surface === 'client_area') {
    if (!request.clientAreaContext)
      throw new ForbiddenException('Client Area action is not allowed.');
    return { kind: 'client_area', context: request.clientAreaContext };
  }
  return {
    kind: 'agency',
    permission: {
      tenantId: user.tenantId,
      workspaceId: user.workspaceId,
      userId: user.sub,
      role: user.role,
    },
  };
}
