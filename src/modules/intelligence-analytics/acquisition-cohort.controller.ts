import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { parseIntelligenceWindow } from '../../common/intelligence';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../permissions';
import { PlatformPermissionService } from '../permissions/services/platform-permission.service';
import { AcquisitionCohortService } from './acquisition-cohort.service';
import { AcquisitionCohortQueryDto } from './dto/acquisition-cohort.query.dto';

/**
 * The two product entitlements this view sits across.
 *
 * Both are required, and the reason is the endpoint's whole nature: the
 * response puts one product's numbers next to another's. A tenant entitled only
 * to Social would learn its client's opportunity count and won value from an
 * endpoint that never mentions LeadFlow in its path, and a tenant entitled only
 * to LeadFlow would learn its ad spend. Either is a product-boundary leak
 * dressed as a report.
 */
const REQUIRED_PRODUCTS = ['social', 'leadflow'] as const;

/**
 * Both operational read permissions, for the same reason.
 *
 * Entitlement is a tenant-level fact ("this company bought Social"); permission
 * is a user-level one ("this user may read Social reports"). A manager allowed
 * to read the funnel but not the media spend must not obtain the spend by
 * asking here, so both keys are required rather than a new third key that would
 * have to be granted separately and would drift from the two it stands in for.
 */
const REQUIRED_PERMISSIONS = [
  'social.analytics.reports.view.operational',
  'leadflow.analytics.reports.view.operational',
] as const;

/**
 * Cross-domain reporting, in a module that belongs to neither domain.
 *
 * Deliberately not `social/analytics/...` and not `leadflow/analytics/...`.
 * Hosting it inside Social would mean the Social module imports LeadFlow, and
 * the next cross-domain view would import a third product into the second — the
 * shape where every product eventually depends on every other. This module
 * depends on both and neither depends on it, so the dependency graph stays a
 * tree with the composition at the top.
 *
 * ## Presentation-agnostic
 *
 * Nothing here knows about the agency UI. The scope comes from
 * `RequestContext`, never from a parameter, so the same endpoint serves a future
 * Client Area under a different permission set and a different view model
 * without a second implementation — the client simply *is* the managed context,
 * and there is no field a caller could use to become one.
 */
@Controller('intelligence/analytics')
export class AcquisitionCohortController {
  constructor(
    private readonly cohortService: AcquisitionCohortService,
    private readonly permissionService: PlatformPermissionService,
  ) {}

  /**
   * Media investment and the commercial funnel, correlated by period.
   *
   * Read-only, computed per request, persisting nothing. The response states
   * what it is — `kind: 'cohort_correlation'` — and what it is not:
   * `dataQuality.individualAttribution` is `false` and the limitation text says
   * so in words a UI can render verbatim.
   */
  @Get('acquisition-funnel')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  // Only the first permission can be declared here: `RequirePermission` is
  // `SetMetadata` under a single key, so a second decorator would overwrite the
  // first rather than compose with it. The second is asserted below, in code,
  // and a spec covers the pair.
  @RequirePermission(REQUIRED_PERMISSIONS[0])
  async acquisitionFunnel(
    @RequestContextData() ctx: RequestContext,
    @Query() query: AcquisitionCohortQueryDto,
  ) {
    const scope = this.requireScope(ctx);

    await this.requireCrossDomainAccess(ctx);

    // Validates the shape, the calendar and the ordering of the window — a
    // reversed range is refused rather than swapped, because swapping answers a
    // question the caller did not ask.
    const window = parseIntelligenceWindow({
      since: query.since,
      until: query.until,
    });

    return this.cohortService.cohort(scope, window, query.connectionId);
  }

  /**
   * Both entitlements and both permissions, checked before any domain is read.
   *
   * `RequireProductEntitlement` takes one product key and `RequirePermission`
   * one permission key — both are `SetMetadata`, and NestJS resolves metadata
   * with `getAllAndOverride`, so stacking either decorator twice silently keeps
   * only the last. Rather than quietly enforcing half of what this endpoint
   * needs, the full policy is expressed here where it can be read and tested.
   */
  private async requireCrossDomainAccess(ctx: RequestContext): Promise<void> {
    // Checked rather than asserted with a cast. The guard has already
    // authenticated the request, so these are present in practice — but a cast
    // here would turn any future context change into an `undefined` silently
    // reaching a permission lookup, which is the one place a missing identity
    // must never be treated as a value.
    if (!ctx.tenantId || !ctx.userId || !ctx.role) {
      throw new BadRequestException('Authenticated context is required.');
    }

    const permissionContext = {
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      role: ctx.role,
    };

    for (const productKey of REQUIRED_PRODUCTS) {
      const allowed = await this.permissionService.canAccessProduct(
        permissionContext,
        productKey,
      );

      if (!allowed) {
        throw new ForbiddenException(
          `Product "${productKey}" is not enabled for this tenant.`,
        );
      }
    }

    // The guard already asserted the first key; this covers the second, which
    // no decorator can express on the same handler.
    await this.permissionService.assertCan(
      permissionContext,
      REQUIRED_PERMISSIONS[1],
    );
  }

  /**
   * The authenticated scope, with the managed client resolved from context.
   *
   * Identical in shape to the Social controller's, and identical on purpose: two
   * endpoints that resolved "which client is this?" differently would eventually
   * disagree, and the disagreement would surface as one client's numbers under
   * another's name.
   */
  private requireScope(ctx: RequestContext) {
    if (!ctx.tenantId || !ctx.workspaceId) {
      throw new BadRequestException(
        'Tenant and workspace context are required.',
      );
    }

    const managedContext = ctx.managedContext;
    const agencyClientId =
      managedContext?.operatingMode === 'client'
        ? (managedContext.clientId ?? null)
        : null;

    if (managedContext?.operatingMode === 'client' && !agencyClientId) {
      throw new BadRequestException('Client context is required.');
    }

    return {
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      agencyClientId,
    };
  }
}
