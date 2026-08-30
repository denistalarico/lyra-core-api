// src/modules/platform-settings/platform-business-profile.controller.ts
//
// Neutral, product-agnostic surface over the Business Profile shared by
// LeadFlow and Social (Lyra Social S1.4.0). See
// docs/architecture/social/social-settings-architecture.md §2.
//
// Context resolution: `PermissionsGuard` already resolves
// `request.managedContext` from the caller's `x-lyra-product-key` /
// `x-lyra-operating-mode` / `x-lyra-client-id` headers via
// `OperationalContextResolver`, and — whenever the resolved context is
// client-mode for `leadflow` or `social` — enforces
// `canAccessClientProduct()` for that same product before this controller
// ever runs (see permissions.guard.ts). That is the D-15 fence: a client
// without an active entitlement for the calling product never reaches this
// handler, regardless of whether its Business Profile row already exists
// because the other product created it.
//
// Permission: the guard-level `@RequireAnyPermission` below only exists to
// force `PermissionsGuard` to run at all (it resolves `managedContext` and
// enforces the D-15 entitlement fence only when at least one permission
// decorator is present) and to keep either product's admin able to reach
// the handler in principle. It is deliberately NOT the final authorization
// decision: an OR-of-both-products check would let a LeadFlow-only admin
// operate through `x-lyra-product-key: social`, which the review this
// module went through flagged as a real gap. The binding decision — this
// productKey requires this product's permission, never the other's — is
// made at runtime in `assertProductPermission`, via the same
// `PlatformPermissionService.assertCan` the guard itself uses for
// `@RequirePermission`. See platform-settings-permission.helper.ts.

import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  PlatformPermissionService,
  RequireAnyPermission,
} from '../permissions';
import { BusinessProfileResponse } from './dto/business-profile.view';
import {
  BusinessModeSummaryResponse,
  mapBusinessModeSummaryResponse,
} from './dto/business-mode-summary.view';
import { UpdateBusinessProfileDto } from './dto/update-business-profile.dto';
import { PlatformBusinessProfileService } from './services/platform-business-profile.service';
import { LeadFlowBusinessModeTemplateService } from '../leadflow-settings/services/leadflow-business-mode-template.service';
import {
  BusinessProfileVerb,
  resolveBusinessProfilePermissionKey,
} from './platform-settings-permission.helper';

const VIEW_PERMISSIONS = [
  'leadflow.settings.general.view.admin',
  'social.settings.general.view.admin',
];
const UPDATE_PERMISSIONS = [
  'leadflow.settings.general.update.admin',
  'social.settings.general.update.admin',
];

@Controller('platform')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PlatformBusinessProfileController {
  constructor(
    private readonly businessProfileService: PlatformBusinessProfileService,
    private readonly businessModeTemplateService: LeadFlowBusinessModeTemplateService,
    private readonly permissionService: PlatformPermissionService,
  ) {}

  @Get('business-profile')
  @RequireAnyPermission(...VIEW_PERMISSIONS)
  async getBusinessProfile(
    @RequestContextData() ctx: RequestContext,
  ): Promise<BusinessProfileResponse> {
    await this.assertProductPermission(ctx, 'view');

    return this.businessProfileService.getBusinessProfile(
      ctx,
      ctx.managedContext?.clientId ?? null,
    );
  }

  @Patch('business-profile')
  @RequireAnyPermission(...UPDATE_PERMISSIONS)
  async updateBusinessProfile(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: UpdateBusinessProfileDto,
  ): Promise<BusinessProfileResponse> {
    await this.assertProductPermission(ctx, 'update');

    return this.businessProfileService.updateBusinessProfile(
      ctx,
      ctx.managedContext?.clientId ?? null,
      dto,
    );
  }

  @Get('business-modes')
  @RequireAnyPermission(...VIEW_PERMISSIONS)
  async listBusinessModes(
    @RequestContextData() ctx: RequestContext,
  ): Promise<{ items: BusinessModeSummaryResponse[] }> {
    await this.assertProductPermission(ctx, 'view');

    const templates = await this.businessModeTemplateService.listTemplates(ctx);

    return { items: templates.map(mapBusinessModeSummaryResponse) };
  }

  private async assertProductPermission(
    ctx: RequestContext,
    verb: BusinessProfileVerb,
  ): Promise<void> {
    const permissionKey = resolveBusinessProfilePermissionKey(
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
