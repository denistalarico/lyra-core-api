import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { resolveCompanyAwareScope } from '../../common/context/company-aware-scope';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  PlatformPermissionService,
  RequireAnyPermission,
} from '../permissions';
import { UpdateAnalyticsOverviewHeaderDto } from './analytics-overview-header.dto';
import { AnalyticsOverviewHeaderService } from './analytics-overview-header.service';

/** The products whose Visão Geral shows this header. */
export const OVERVIEW_HEADER_PRODUCTS = ['leadflow', 'social'] as const;

/** Each product's own "read a dashboard" / "change a dashboard" key. */
export const OVERVIEW_HEADER_READ_PERMISSIONS = [
  'leadflow.analytics.reports.view.operational',
  'social.analytics.reports.view.operational',
] as const;
export const OVERVIEW_HEADER_MANAGE_PERMISSIONS = [
  'leadflow.analytics.reports.view.full',
  'social.analytics.dashboards.manage.admin_or_explicit',
] as const;

/**
 * The shared Visão Geral header (AN-HDR, D-AN-12).
 *
 * No `@RequireProductEntitlement`: that decorator names one product, and this
 * route serves two. The product gate is split instead:
 *
 * - client mode — `PermissionsGuard` already ran `canAccessClientProduct` for
 *   the product named by the context header, but only when that product is
 *   LeadFlow or Social; any other product header is refused here;
 * - agency mode — the guard checks no product at all, so the tenant must own
 *   at least one of the two.
 *
 * Not exposed to the Client Area (no `ExposeToClientArea`): the guard refuses
 * every client-area call until CA-AN1 exposes the `GET`.
 */
@Controller('analytics/overview-header')
export class AnalyticsOverviewHeaderController {
  constructor(
    private readonly service: AnalyticsOverviewHeaderService,
    private readonly permissions: PlatformPermissionService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAnyPermission(...OVERVIEW_HEADER_READ_PERMISSIONS)
  async get(@RequestContextData() ctx: RequestContext) {
    await this.assertProductScope(ctx);
    return this.service.get(resolveCompanyAwareScope(ctx));
  }

  @Patch()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAnyPermission(...OVERVIEW_HEADER_MANAGE_PERMISSIONS)
  async update(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: UpdateAnalyticsOverviewHeaderDto,
  ) {
    await this.assertProductScope(ctx);
    return this.service.update(
      resolveCompanyAwareScope(ctx),
      ctx.userId ?? null,
      dto,
    );
  }

  private async assertProductScope(ctx: RequestContext): Promise<void> {
    const managed = ctx.managedContext;
    if (managed?.operatingMode === 'client') {
      if (!isOverviewProduct(managed.productKey))
        throw new ForbiddenException(
          'The requested context does not belong to LeadFlow or Social.',
        );
      return;
    }

    if (!ctx.userId) throw new ForbiddenException();
    const context = {
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      role: ctx.role ?? '',
    };
    for (const product of OVERVIEW_HEADER_PRODUCTS)
      if (await this.permissions.canAccessProduct(context, product)) return;

    throw new ForbiddenException(
      'Neither LeadFlow nor Social is enabled for this tenant.',
    );
  }
}

function isOverviewProduct(
  key: string,
): key is (typeof OVERVIEW_HEADER_PRODUCTS)[number] {
  return (OVERVIEW_HEADER_PRODUCTS as readonly string[]).includes(key);
}
