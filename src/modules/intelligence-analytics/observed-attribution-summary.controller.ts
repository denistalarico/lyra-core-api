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
import { ObservedAttributionSummaryQueryDto } from './dto/observed-attribution-summary.query.dto';
import { ObservedAttributionSummaryService } from './observed-attribution-summary.service';

/** Both products, as every cross-domain view in this module requires. */
const REQUIRED_PRODUCTS = ['social', 'leadflow'] as const;

/**
 * Three permissions, and the third is the point of §24.
 *
 * The two analytics keys are what I3.5 and I4 require. This endpoint adds
 * `leadflow.crm.records.view.client` because of what it returns that neither of
 * those does: `wonOpportunities` and `wonOpportunityValue` aggregated per
 * campaign are commercial pipeline figures, and a user granted media-reporting
 * access should not obtain the sales pipeline by asking a reporting endpoint
 * for it.
 *
 * All three happen to sit at `MANAGER_UP` in the default catalogue today, so
 * this grants nothing new and denies nothing that was previously allowed. That
 * is exactly why it is worth declaring now: the defaults are a current
 * configuration, not a guarantee, and permissions are re-granted per tenant. If
 * an operator later widens the analytics keys to members — a reasonable thing
 * to want for a media dashboard — this endpoint keeps requiring an explicit
 * grant for the commercial numbers instead of silently widening with them.
 */
const REQUIRED_PERMISSIONS = [
  'social.analytics.reports.view.operational',
  'leadflow.analytics.reports.view.operational',
  'leadflow.crm.records.view.client',
] as const;

/**
 * The aggregate over individually-observed attributions.
 *
 * ## One endpoint, not four
 *
 * `groupBy` is a parameter rather than four sibling routes. The four levels
 * differ only in which id names a group; the cohort selection, the coverage
 * denominator, the maturity fields and every limitation are identical. Four
 * routes would be four copies of that, and the copies would drift.
 *
 * ## No pagination, deliberately
 *
 * §28. The group count is bounded by the number of *distinct ads the cohort's
 * conversations actually observed*, not by the account's ad count — a window
 * with 50,000 attributed conversations concentrated on 30 ads returns 30 rows.
 * Adding a cursor now would be pagination machinery for a page that does not
 * overflow, and it can be added without breaking this shape if a real cohort
 * ever proves otherwise.
 */
@Controller('intelligence/attribution')
export class ObservedAttributionSummaryController {
  constructor(
    private readonly summaryService: ObservedAttributionSummaryService,
    private readonly permissionService: PlatformPermissionService,
  ) {}

  @Get('observed-summary')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  // Only one key can be declared: `RequirePermission` is `SetMetadata` under a
  // single key, so a second decorator would overwrite this one rather than
  // compose with it. The other two are asserted in code below.
  @RequirePermission(REQUIRED_PERMISSIONS[0])
  async observedSummary(
    @RequestContextData() ctx: RequestContext,
    @Query() query: ObservedAttributionSummaryQueryDto,
  ) {
    const scope = this.requireScope(ctx);

    await this.requireCrossDomainAccess(ctx);

    // Validates shape, calendar and ordering. A reversed range is refused
    // rather than swapped: swapping answers a question the caller did not ask.
    const window = parseIntelligenceWindow({
      since: query.from,
      until: query.until,
    });

    return this.summaryService.summary(
      scope,
      window,
      query.connectionId,
      query.groupBy,
    );
  }

  /** Both entitlements and all three permissions, before any domain is read. */
  private async requireCrossDomainAccess(ctx: RequestContext): Promise<void> {
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

    // The guard asserted the first; these are the two no decorator can express
    // on the same handler.
    for (const permission of REQUIRED_PERMISSIONS.slice(1)) {
      await this.permissionService.assertCan(permissionContext, permission);
    }
  }

  /**
   * The authenticated scope, with the managed client resolved from context.
   *
   * Identical to the cohort and individual controllers', deliberately: three
   * endpoints that resolved "which client is this?" differently would
   * eventually disagree, and the disagreement would surface as one client's
   * conversations counted under another's campaigns.
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
