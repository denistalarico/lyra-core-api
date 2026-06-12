import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RequestContextData } from '../../../common/context/request-context.decorator';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AgencyDashboardsService } from '../services/agency-dashboards.service';

@Controller('agency/dashboards')
@UseGuards(JwtAuthGuard)
export class AgencyDashboardsController {
  constructor(
    private readonly dashboardsService: AgencyDashboardsService,
  ) {}

  @Get('overview')
  getOverview(
    @RequestContextData() context: RequestContext,
    @Query('clientId') clientId?: string,
    @Query('market') market?: string,
  ) {
    if (
      market !== undefined &&
      !['US', 'BR', 'ALL'].includes(market)
    ) {
      throw new BadRequestException(
        'market must be US, BR or ALL.',
      );
    }

    return this.dashboardsService.getOverview(context, {
      clientId,
      market: market as 'US' | 'BR' | 'ALL' | undefined,
    });
  }
}
