import {
  Body,
  Controller,
  Delete,
  Get,
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
import {
  AuthorizedContext,
  type AuthorizedRequestContext,
} from '../../../common/context/authorized-context.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('agency/clients')
export class ClientLifecycleController {
  constructor(
    private readonly clientLifecycleService: ClientLifecycleService,
  ) {}

  @Get(':id/lifecycle/:processType')
  @RequirePermission('agency.clients.lifecycle.view.assigned')
  getLifecycle(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Param('processType') processType: ClientLifecycleProcessType,
  ) {
    return this.clientLifecycleService.getLifecycle(context, id, processType);
  }

  @Get(':id/lifecycle-history')
  @RequirePermission('agency.clients.lifecycle.view.assigned')
  getHistory(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
  ) {
    return this.clientLifecycleService.getHistory(context, id);
  }

  @Post(':id/lifecycle/:processType/start')
  @RequirePermission('agency.clients.lifecycle.manage.assigned')
  startLifecycle(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Param('processType') processType: ClientLifecycleProcessType,
    @Body() dto: StartClientLifecycleDto,
  ) {
    return this.clientLifecycleService.startLifecycle(
      context,
      id,
      processType,
      dto,
    );
  }

  @Post(':id/lifecycle/:processType/apply-template')
  @RequirePermission('agency.clients.lifecycle.manage.assigned')
  applyTemplate(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Param('processType') processType: ClientLifecycleProcessType,
    @Body() body: { templateConfigOptionId?: string },
  ) {
    return this.clientLifecycleService.applyTemplate(
      context,
      id,
      processType,
      body?.templateConfigOptionId,
    );
  }

  @Post(':id/lifecycle/:processType/cancel')
  @RequirePermission('agency.clients.lifecycle.manage.assigned')
  cancelLifecycle(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Param('processType') processType: ClientLifecycleProcessType,
  ) {
    return this.clientLifecycleService.cancelLifecycle(
      context,
      id,
      processType,
    );
  }

  @Post(':id/lifecycle/:processType/complete')
  @RequirePermission('agency.clients.lifecycle.manage.assigned')
  completeLifecycle(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Param('processType') processType: ClientLifecycleProcessType,
    @Body() dto: CompleteClientLifecycleDto,
  ) {
    return this.clientLifecycleService.completeLifecycle(
      context,
      id,
      processType,
      dto,
    );
  }

  @Post(':id/lifecycle/:processType/steps')
  @RequirePermission('agency.clients.lifecycle.manage.assigned')
  createStep(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Param('processType') processType: ClientLifecycleProcessType,
    @Body() dto: CreateClientLifecycleStepDto,
  ) {
    return this.clientLifecycleService.createStep(
      context,
      id,
      processType,
      dto,
    );
  }

  @Delete(':id/lifecycle/steps/:stepId')
  @RequirePermission('agency.clients.lifecycle.manage.assigned')
  deleteStep(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Param('stepId') stepId: string,
  ) {
    return this.clientLifecycleService.deleteStep(context, id, stepId);
  }

  @Patch(':id/lifecycle/steps/:stepId')
  @RequirePermission('agency.clients.lifecycle.manage.assigned')
  updateStep(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Param('stepId') stepId: string,
    @Body() dto: UpdateClientLifecycleStepDto,
  ) {
    return this.clientLifecycleService.updateStep(context, id, stepId, dto);
  }
}
