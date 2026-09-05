import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RequestContextData } from '../../../common/context/request-context.decorator';
import type { RequestContext } from '../../../common/context/request-context.interface';
import {
  BENCHMARK_METRICS_BY_KEY,
  DEFAULT_BENCHMARK_WINDOW,
  type BenchmarkDestination,
  type BenchmarkMetricKey,
  type BenchmarkWindowKey,
} from '../../../common/intelligence';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../../permissions';
import { PlatformPermissionService } from '../../permissions/services/platform-permission.service';
import { BenchmarkQueryDto } from '../dto/benchmark.query.dto';
import { BenchmarkService } from './benchmark.service';

/**
 * The one permission this endpoint requires.
 *
 * Social's operational reporting permission, because the Phase A metrics are all
 * paid-media aggregates. Notably *not* both products' permissions the way
 * `acquisition-funnel` requires them: that endpoint returns this tenant's own
 * LeadFlow numbers alongside its Social ones, so it needs authority over both.
 * A benchmark returns no tenant's numbers at all — only a distribution over
 * other, anonymous contributors — so the LeadFlow permission would be gating
 * data the response cannot contain.
 */
const REQUIRED_PERMISSION = 'social.analytics.reports.view.operational';

/**
 * Cross-tenant benchmarks, read from anonymous contributions.
 *
 * ## Why authorization exists here at all
 *
 * The response contains nobody's identifiable data, so the check is not
 * protecting a tenant's rows — it is protecting the *aggregate*. §26 puts it
 * plainly: a benchmark is not public. An unauthenticated surface would let
 * anyone enumerate the finite question space at leisure, which is the one
 * setting where a closed vocabulary stops being sufficient.
 *
 * ## Why the caller's own consent is irrelevant here
 *
 * §27, and it is worth being explicit. Whether this tenant contributes is
 * decided by its own persisted consent, and whether it may *read* a benchmark is
 * decided by permission. The two are independent on purpose: a user with
 * Analytics permission cannot enable another tenant's contribution, and a tenant
 * that has not opted in is not thereby locked out of reading. Neither direction
 * leaks — the read returns a distribution with no contributor identities, and
 * the write path never consults the reader.
 *
 * ## Product entitlement
 *
 * Social's entitlement is required because the metrics are paid-media ones. That
 * is checked in code rather than by `@RequireProductEntitlement` for the same
 * reason the sibling controller documents: the decorator is `SetMetadata` and
 * does not compose, and an explicit check reads and tests better than a
 * decorator whose behaviour depends on declaration order.
 */
@Controller('intelligence/benchmarks')
export class BenchmarkController {
  constructor(
    private readonly benchmarkService: BenchmarkService,
    private readonly permissionService: PlatformPermissionService,
  ) {}

  /**
   * One metric, one cohort, one window.
   *
   * Deliberately not a list endpoint. Returning every cohort at once would hand
   * a caller the full matrix in a single response, which is both the most useful
   * shape for a differencing attempt and the least useful for a UI, which shows
   * one comparison at a time.
   */
  @Get(':metricKey')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission(REQUIRED_PERMISSION)
  async benchmark(
    @RequestContextData() ctx: RequestContext,
    @Param('metricKey') metricKey: string,
    @Query() query: BenchmarkQueryDto,
  ) {
    await this.requireSocialAccess(ctx);

    // Validated against the closed metric set before anything else, so an
    // unknown key is a 400 rather than an `available: false` that a caller might
    // read as "no data for this metric".
    if (!BENCHMARK_METRICS_BY_KEY.has(metricKey)) {
      throw new BadRequestException(
        `Unknown benchmark metric "${metricKey}". Supported: ${[
          ...BENCHMARK_METRICS_BY_KEY.keys(),
        ].join(', ')}.`,
      );
    }

    return this.benchmarkService.getBenchmark({
      metricKey: metricKey as BenchmarkMetricKey,
      cohort: {
        businessModeKey: query.businessModeKey,
        provider: query.provider,
        destination: query.destination as BenchmarkDestination,
        currency: query.currency ?? null,
      },
      windowKey:
        (query.window as BenchmarkWindowKey) ?? DEFAULT_BENCHMARK_WINDOW,
    });
  }

  /**
   * Social entitlement, checked explicitly.
   *
   * The identity fields are checked rather than cast for the reason the sibling
   * controller gives: a cast turns a future context change into an `undefined`
   * arriving at a permission lookup, and a permission lookup is the last place a
   * missing identity may be treated as a value.
   */
  private async requireSocialAccess(ctx: RequestContext): Promise<void> {
    if (!ctx.tenantId || !ctx.userId || !ctx.role) {
      throw new BadRequestException('Authenticated context is required.');
    }

    const allowed = await this.permissionService.canAccessProduct(
      {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        role: ctx.role,
      },
      'social',
    );

    if (!allowed) {
      throw new ForbiddenException(
        'Product "social" is not enabled for this tenant.',
      );
    }
  }
}
