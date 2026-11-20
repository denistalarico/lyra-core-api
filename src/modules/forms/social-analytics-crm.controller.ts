import {
  Controller,
  ForbiddenException,
  Get,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { resolveCompanyAwareScope } from '../../common/context/company-aware-scope';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ClientAreaExposed } from '../client-area/client-area.decorators';
import type { ClientAreaRequest } from '../client-area/client-area.types';
import {
  PermissionsGuard,
  RequirePermission,
  RequireProductEntitlement,
} from '../permissions';
import { AnalyticsOverviewQueryDto } from '../social-integrations/dto/analytics-overview.query.dto';
import { SocialAnalyticsCrmReadService } from './services/social-analytics-crm.read.service';

/** The same catalog permission as every Social Analytics read. */
const SOCIAL_ANALYTICS_READ_PERMISSION =
  'social.analytics.reports.view.operational';

/**
 * AN-CRM (D-A1): "Leads e vendas" cards of the Social Analytics. Served from
 * the Forms module, like GA-CONV, because Forms already imports the Social
 * read model.
 *
 * Client Area (owner decision, 2026-11-20): only the company's Owner. The
 * figures are aggregates (no contact), so a Member has no use for them; a
 * Member is refused here, after the Bridge and the Analytics grants. The
 * agency in its own Client Area (CA15) acts with its Agency permissions.
 */
@Controller('social/analytics')
export class SocialAnalyticsCrmController {
  constructor(private readonly service: SocialAnalyticsCrmReadService) {}

  @ClientAreaExposed('analytics')
  @Get('crm-leads')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ANALYTICS_READ_PERMISSION)
  crmLeads(
    @RequestContextData() ctx: RequestContext,
    @Req() request: ClientAreaRequest,
    @Query() query: AnalyticsOverviewQueryDto,
  ) {
    const clientArea = request.clientAreaContext;
    if (
      clientArea &&
      (clientArea.accountRole ?? clientArea.role) !== 'client_owner'
    )
      throw new ForbiddenException({
        code: 'client_area_owner_required',
        message: 'Leads e vendas estão disponíveis só para o Owner da empresa.',
      });
    return this.service.read({
      ...resolveCompanyAwareScope(ctx),
      connectionId: query.connectionId,
      since: query.since,
      until: query.until,
    });
  }
}
