import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthenticatedUser } from '../../auth/decorators/authenticated-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthTokenPayload } from '../../auth/types/auth-token-payload.type';
import { PermissionsGuard, RequirePermission } from '../../permissions';
import {
  AssignCompanyLegacyRowDto,
  ListCompanyLegacyRowsQueryDto,
} from '../dto';
import { CompanyLegacyReconciliationService } from '../reconciliation/company-legacy-reconciliation.service';

function contextFromUser(user: AuthTokenPayload) {
  return {
    tenantId: user.tenantId,
    workspaceId: user.workspaceId,
    userId: user.sub,
  };
}

/**
 * CC2G — the Agency/admin boundary for legacy reconciliation.
 *
 * This controller is intentionally outside every company-aware product route.
 * It reads the tenant/workspace from the authenticated token and never from
 * `managedContext`, so a company-mode session has no path to legacy counts,
 * ids or summaries: reconciliation is an agency-side activity by construction.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('agency/company-context/reconciliation')
export class CompanyContextReconciliationController {
  constructor(
    private readonly reconciliation: CompanyLegacyReconciliationService,
  ) {}

  /** The domain catalog, so the UI can render filters without hardcoding keys. */
  @Get('domains')
  @RequirePermission('agency.clients.company_context.reconcile.admin')
  domains() {
    return this.reconciliation
      .listDomains()
      .map(({ domainKey, label, product }) => ({ domainKey, label, product }));
  }

  @Get('summary')
  @RequirePermission('agency.clients.company_context.reconcile.admin')
  summary(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Query() query: ListCompanyLegacyRowsQueryDto,
  ) {
    return this.reconciliation.summary(contextFromUser(user), {
      agencyClientId: query.agencyClientId,
      domainKey: query.domainKey,
      product: query.product,
    });
  }

  @Get('rows')
  @RequirePermission('agency.clients.company_context.reconcile.admin')
  list(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Query() query: ListCompanyLegacyRowsQueryDto,
  ) {
    return this.reconciliation.list(
      contextFromUser(user),
      {
        agencyClientId: query.agencyClientId,
        domainKey: query.domainKey,
        product: query.product,
      },
      { limit: Number(query.limit), offset: Number(query.offset) },
    );
  }

  @Get(':domainKey/:rowId')
  @RequirePermission('agency.clients.company_context.reconcile.admin')
  get(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('domainKey') domainKey: string,
    @Param('rowId') rowId: string,
  ) {
    return this.reconciliation.get(contextFromUser(user), domainKey, rowId);
  }

  @Post(':domainKey/:rowId/assign')
  @RequirePermission('agency.clients.company_context.reconcile.admin')
  assign(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('domainKey') domainKey: string,
    @Param('rowId') rowId: string,
    @Body() dto: AssignCompanyLegacyRowDto,
  ) {
    return this.reconciliation.assign(
      contextFromUser(user),
      domainKey,
      rowId,
      dto,
    );
  }
}
