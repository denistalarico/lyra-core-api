import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  RequirePermission,
  RequireProductEntitlement,
} from '../permissions';
import { CreativeCostService } from './creative-cost.service';
import { CREATIVE_PRODUCTION_PERMISSIONS as P } from './creative-production.permissions';
import { creativeStudioScope } from './creative-studio.scope';

/**
 * CS6-B — real AI cost of Studio work, for agency operators. The route key is
 * the Studio's view key; the service also requires the Finance profitability
 * key (a route carries a single `@RequirePermission`). Scope only from the
 * request context: another company's item or version is a 404.
 */
@Controller('social/creative-studio')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('social')
export class CreativeCostController {
  constructor(private readonly costs: CreativeCostService) {}

  /** "How much did producing this content cost?" — total and selected version. */
  @Get('production/:contentItemId/costs')
  @RequirePermission(P.view)
  contentCosts(
    @RequestContextData() ctx: RequestContext,
    @Param('contentItemId', ParseUUIDPipe) contentItemId: string,
  ) {
    return this.costs.contentCosts(
      ctx,
      creativeStudioScope(ctx),
      contentItemId,
    );
  }

  /** "How much did reaching this version cost?" — direct and lineage. */
  @Get('assets/:assetId/versions/:versionId/costs')
  @RequirePermission(P.view)
  versionCosts(
    @RequestContextData() ctx: RequestContext,
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ) {
    return this.costs.versionCosts(
      ctx,
      creativeStudioScope(ctx),
      assetId,
      versionId,
    );
  }

  /**
   * Idempotent reconcile of this workspace's Studio costs: missing ledger
   * rows, unknown → known, late task/project links. Same code path as the
   * periodic worker pass.
   */
  @Post('costs/reconcile')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(P.view)
  reconcile(@RequestContextData() ctx: RequestContext) {
    return this.costs.reconcile(ctx, creativeStudioScope(ctx));
  }
}
