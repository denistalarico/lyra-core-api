import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ClientLifecycleService } from '../services/client-lifecycle.service';
import {
  CompleteClientLifecycleDto,
  CreateClientLifecycleStepDto,
  StartClientLifecycleDto,
  UpdateClientLifecycleStepDto,
} from '../dto';
import { ClientLifecycleProcessType } from '../enums';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../../permissions';

type RequestContext = {
  tenantId: string;
  workspaceId: string;
  userId: string;
};

function getContextFromHeaders(
  headers: Record<string, string | string[] | undefined>,
): RequestContext {
  return {
    tenantId: String(headers['x-tenant-id'] ?? ''),
    workspaceId: String(headers['x-workspace-id'] ?? ''),
    userId: String(headers['x-user-id'] ?? ''),
  };
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('agency/clients')
export class ClientLifecycleController {
  constructor(private readonly clientLifecycleService: ClientLifecycleService) {}

  @Get(':id/lifecycle/:processType')
  @RequirePermission('agency.clients.lifecycle.view.assigned')
  getLifecycle(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Param('processType') processType: ClientLifecycleProcessType,
  ) {
    return this.clientLifecycleService.getLifecycle(getContextFromHeaders(headers), id, processType);
  }

  @Get(':id/lifecycle-history')
  @RequirePermission('agency.clients.lifecycle.view.assigned')
  getHistory(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.clientLifecycleService.getHistory(getContextFromHeaders(headers), id);
  }

  @Post(':id/lifecycle/:processType/start')
  @RequirePermission('agency.clients.lifecycle.manage.assigned')
  startLifecycle(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Param('processType') processType: ClientLifecycleProcessType,
    @Body() dto: StartClientLifecycleDto,
  ) {
    return this.clientLifecycleService.startLifecycle(getContextFromHeaders(headers), id, processType, dto);
  }

  @Post(':id/lifecycle/:processType/apply-template')
  @RequirePermission('agency.clients.lifecycle.manage.assigned')
  applyTemplate(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Param('processType') processType: ClientLifecycleProcessType,
    @Body() body: { templateConfigOptionId?: string },
  ) {
    return this.clientLifecycleService.applyTemplate(
      getContextFromHeaders(headers),
      id,
      processType,
      body?.templateConfigOptionId,
    );
  }

  @Post(':id/lifecycle/:processType/cancel')
  @RequirePermission('agency.clients.lifecycle.manage.assigned')
  cancelLifecycle(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Param('processType') processType: ClientLifecycleProcessType,
  ) {
    return this.clientLifecycleService.cancelLifecycle(getContextFromHeaders(headers), id, processType);
  }

  @Post(':id/lifecycle/:processType/complete')
  @RequirePermission('agency.clients.lifecycle.manage.assigned')
  completeLifecycle(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Param('processType') processType: ClientLifecycleProcessType,
    @Body() dto: CompleteClientLifecycleDto,
  ) {
    return this.clientLifecycleService.completeLifecycle(getContextFromHeaders(headers), id, processType, dto);
  }

  @Post(':id/lifecycle/:processType/steps')
  @RequirePermission('agency.clients.lifecycle.manage.assigned')
  createStep(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Param('processType') processType: ClientLifecycleProcessType,
    @Body() dto: CreateClientLifecycleStepDto,
  ) {
    return this.clientLifecycleService.createStep(getContextFromHeaders(headers), id, processType, dto);
  }

  @Delete(':id/lifecycle/steps/:stepId')
  @RequirePermission('agency.clients.lifecycle.manage.assigned')
  deleteStep(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Param('stepId') stepId: string,
  ) {
    return this.clientLifecycleService.deleteStep(getContextFromHeaders(headers), id, stepId);
  }

  @Patch(':id/lifecycle/steps/:stepId')
  @RequirePermission('agency.clients.lifecycle.manage.assigned')
  updateStep(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Param('stepId') stepId: string,
    @Body() dto: UpdateClientLifecycleStepDto,
  ) {
    return this.clientLifecycleService.updateStep(getContextFromHeaders(headers), id, stepId, dto);
  }
}
