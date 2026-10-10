import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthenticatedUser } from '../../auth/decorators/authenticated-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthTokenPayload } from '../../auth/types/auth-token-payload.type';
import { PermissionsGuard, RequirePermission } from '../../permissions';
import { ClientProfitabilityMonthlyQueryDto } from '../dto';
import { ClientsProfitabilityService } from '../services/clients-profitability.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('agency/clients/profitability/portfolio/monthly')
export class ClientsPortfolioMonthlyController {
  constructor(private readonly profitability: ClientsProfitabilityService) {}

  @Get()
  @RequirePermission('agency.clients.profitability.view.owner_or_finance')
  getMonthly(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Query() query: ClientProfitabilityMonthlyQueryDto,
  ) {
    return this.profitability.getPortfolioMonthlyProfitability(
      {
        tenantId: user.tenantId,
        workspaceId: user.workspaceId,
        userId: user.sub,
      },
      query,
    );
  }
}
