// src/modules/platform-privacy/platform-privacy.controller.ts
//
// Neutral, product-agnostic telemetry-consent surface shared by LeadFlow and
// Social (Lyra Social S1.4.8). See
// docs/architecture/social/social-settings-architecture.md §8 and decision D-4.
//
// It operates on the SAME tables and the SAME service as
// `/leadflow/privacy/telemetry*` — no `social_telemetry_*`, no second consent
// store. The only difference is the purpose it resolves:
// `platform_product_improvement_v1` instead of the legacy
// `leadflow_product_improvement_v1`.
//
// WHAT THIS ROUTE DELIBERATELY DOES NOT DO
// ----------------------------------------
// It never reads a legacy `leadflow_product_improvement_v1` acceptance as if
// it were a neutral one. `getStatus` filters consents by purpose, so a scope
// holding only the legacy row reports `not_configured` here — correct, since
// the legacy notice's text never described the platform-wide scope. The
// legacy row is surfaced separately, as read-only history, under
// `legacyConsent`: honest information for the user, never an input to the
// consent state or to collection eligibility.
//
// Context resolution: `PermissionsGuard` resolves `request.managedContext`
// from `x-lyra-product-key` / `x-lyra-operating-mode` / `x-lyra-client-id`
// and, for client-mode contexts, enforces `canAccessClientProduct()` for that
// same product before this controller runs — the D-15 fence.
//
// Permission: the `@RequireAnyPermission` decorators exist to make
// `PermissionsGuard` run at all (that is also what applies the D-15 fence).
// They are NOT the authorization decision: an OR across products would let a
// LeadFlow-only admin manage consent through `x-lyra-product-key: social`.
// The binding check is `assertProductPermission`, which resolves exactly one
// key from the request's own productKey (S1.4.0 / S1.4.7 pattern).

import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  PlatformPermissionService,
  RequireAnyPermission,
} from '../permissions';
import {
  OptInLeadFlowTelemetryDto,
  OptOutLeadFlowTelemetryDto,
  TelemetryErasureDto,
} from '../leadflow-privacy/dto/telemetry-consent.dto';
import {
  LeadFlowTelemetryPrivacyService,
  type TelemetryPurpose,
} from '../leadflow-privacy/services/leadflow-telemetry-privacy.service';
import {
  LEADFLOW_PRODUCT_TELEMETRY_PURPOSE,
  PLATFORM_PRODUCT_TELEMETRY_PURPOSE,
  PLATFORM_TELEMETRY_PURPOSE_DESCRIPTION,
} from './platform-telemetry-purpose';
import {
  resolveTelemetryPermissionKey,
  TELEMETRY_MANAGE_PERMISSIONS,
  TELEMETRY_VIEW_PERMISSIONS,
  type TelemetryVerb,
} from './platform-privacy-permission.helper';

const PLATFORM_PURPOSE: TelemetryPurpose = {
  key: PLATFORM_PRODUCT_TELEMETRY_PURPOSE,
  description: PLATFORM_TELEMETRY_PURPOSE_DESCRIPTION,
  // The neutral notice ships as `legal_review_status = 'pending'`, so no new
  // acceptance may be recorded against it until it is approved (S1.4.8
  // pointed correction). Opt-out and erasure are deliberately NOT gated.
  requiresApprovedNoticeToOptIn: true,
};

@Controller('platform/privacy/telemetry')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PlatformPrivacyController {
  constructor(
    private readonly telemetryPrivacy: LeadFlowTelemetryPrivacyService,
    private readonly permissionService: PlatformPermissionService,
  ) {}

  @Get()
  @RequireAnyPermission(...TELEMETRY_VIEW_PERMISSIONS)
  async getStatus(@RequestContextData() ctx: RequestContext) {
    await this.assertProductPermission(ctx, 'view');

    const [status, legacyConsent] = await Promise.all([
      this.telemetryPrivacy.getStatus(ctx, PLATFORM_PURPOSE),
      // Read-only history of the legacy notice, for honest presentation.
      // Never merged into `status.consent` — see the file header.
      this.telemetryPrivacy.findRelatedPurposeConsent(
        ctx,
        LEADFLOW_PRODUCT_TELEMETRY_PURPOSE,
      ),
    ]);

    return { ...status, legacyConsent };
  }

  @Post('opt-in')
  @RequireAnyPermission(...TELEMETRY_MANAGE_PERMISSIONS)
  async optIn(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: OptInLeadFlowTelemetryDto,
  ) {
    await this.assertProductPermission(ctx, 'manage');

    return this.telemetryPrivacy.optIn(ctx, dto, PLATFORM_PURPOSE);
  }

  @Post('opt-out')
  @RequireAnyPermission(...TELEMETRY_MANAGE_PERMISSIONS)
  async optOut(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: OptOutLeadFlowTelemetryDto,
  ) {
    await this.assertProductPermission(ctx, 'manage');

    return this.telemetryPrivacy.optOut(ctx, dto, PLATFORM_PURPOSE);
  }

  @Post('erasure')
  @RequireAnyPermission(...TELEMETRY_MANAGE_PERMISSIONS)
  async eraseContribution(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: TelemetryErasureDto,
  ) {
    await this.assertProductPermission(ctx, 'manage');

    return this.telemetryPrivacy.eraseContribution(ctx, dto, PLATFORM_PURPOSE);
  }

  private async assertProductPermission(
    ctx: RequestContext,
    verb: TelemetryVerb,
  ): Promise<void> {
    const permissionKey = resolveTelemetryPermissionKey(
      ctx.managedContext?.productKey,
      verb,
    );

    await this.permissionService.assertCan(
      {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        userId: ctx.userId ?? '',
        role: ctx.role ?? '',
      },
      permissionKey,
    );
  }
}
