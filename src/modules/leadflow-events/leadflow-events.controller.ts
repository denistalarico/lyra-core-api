import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  RequirePermission,
  RequireProductEntitlement,
} from '../permissions';
import type {
  LeadFlowEventCatalogItemResponse,
  LeadFlowEventCatalogResponse,
  LeadFlowEventRuntimeContractResponse,
  LeadFlowEventValidationResponse,
} from './dto';
import { ValidateLeadFlowEventDto } from './dto';
import { LEADFLOW_EVENTS_PERMISSIONS } from './leadflow-events.permissions';
import { LeadFlowEventCatalogService } from './services/leadflow-event-catalog.service';
import { LeadFlowEventRuntimeContractService } from './services/leadflow-event-runtime-contract.service';
import { LeadFlowEventValidationService } from './services/leadflow-event-validation.service';

/**
 * Inspection endpoints for the LeadFlow Event Contract (blueprint section 11).
 * These inspection routes themselves never emit, persist or execute events.
 */
@Controller('leadflow/events')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('leadflow')
export class LeadFlowEventsController {
  constructor(
    private readonly catalogService: LeadFlowEventCatalogService,
    private readonly validationService: LeadFlowEventValidationService,
    private readonly runtimeContractService: LeadFlowEventRuntimeContractService,
  ) {}

  @Get('catalog')
  @RequirePermission(LEADFLOW_EVENTS_PERMISSIONS.catalogView)
  listCatalog(): LeadFlowEventCatalogResponse {
    return this.catalogService.listCatalog();
  }

  @Get('runtime-contract')
  @RequirePermission(LEADFLOW_EVENTS_PERMISSIONS.runtimePreview)
  getRuntimeContract(): LeadFlowEventRuntimeContractResponse {
    return this.runtimeContractService.buildRuntimeContract();
  }

  @Get('catalog/:eventName')
  @RequirePermission(LEADFLOW_EVENTS_PERMISSIONS.catalogView)
  getCatalogItem(
    @Param('eventName') eventName: string,
  ): LeadFlowEventCatalogItemResponse {
    return this.catalogService.getCatalogItem(eventName);
  }

  @Post('validate')
  @RequirePermission(LEADFLOW_EVENTS_PERMISSIONS.validate)
  validate(
    @Body() dto: ValidateLeadFlowEventDto,
  ): LeadFlowEventValidationResponse {
    return this.validationService.validate(dto as Record<string, unknown>);
  }
}
