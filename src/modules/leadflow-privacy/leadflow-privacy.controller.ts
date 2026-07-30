import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  RequirePermission,
  RequireProductEntitlement,
} from '../permissions';
import {
  CollectLeadFlowTelemetryDto,
  OptInLeadFlowTelemetryDto,
  OptOutLeadFlowTelemetryDto,
  TelemetryErasureDto,
} from './dto/telemetry-consent.dto';
import { LEADFLOW_PRIVACY_PERMISSIONS } from './leadflow-privacy.permissions';
import { LeadFlowTelemetryPrivacyService } from './services/leadflow-telemetry-privacy.service';

@Controller('leadflow/privacy/telemetry')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('leadflow')
export class LeadFlowPrivacyController {
  constructor(
    private readonly telemetryPrivacy: LeadFlowTelemetryPrivacyService,
  ) {}

  @Get()
  @RequirePermission(LEADFLOW_PRIVACY_PERMISSIONS.view)
  getStatus(@RequestContextData() ctx: RequestContext) {
    return this.telemetryPrivacy.getStatus(ctx);
  }

  @Post('opt-in')
  @RequirePermission(LEADFLOW_PRIVACY_PERMISSIONS.manage)
  optIn(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: OptInLeadFlowTelemetryDto,
  ) {
    return this.telemetryPrivacy.optIn(ctx, dto);
  }

  @Post('opt-out')
  @RequirePermission(LEADFLOW_PRIVACY_PERMISSIONS.manage)
  optOut(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: OptOutLeadFlowTelemetryDto,
  ) {
    return this.telemetryPrivacy.optOut(ctx, dto);
  }

  @Post('snapshot')
  @RequirePermission(LEADFLOW_PRIVACY_PERMISSIONS.manage)
  collectSnapshot(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CollectLeadFlowTelemetryDto,
  ) {
    return this.telemetryPrivacy.collectSnapshot(ctx, dto);
  }

  @Post('erasure')
  @RequirePermission(LEADFLOW_PRIVACY_PERMISSIONS.manage)
  eraseContribution(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: TelemetryErasureDto,
  ) {
    return this.telemetryPrivacy.eraseContribution(ctx, dto);
  }
}
