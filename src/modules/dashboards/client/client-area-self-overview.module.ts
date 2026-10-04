import { Module } from '@nestjs/common';
import { ClientAreaModule } from '../../client-area/client-area.module';
import { DashboardsModule } from '../dashboards.module';
import { ClientAreaSelfOverviewController } from './client-area-self-overview.controller';
import { ClientAreaSelfOverviewService } from './client-area-self-overview.service';

/**
 * PD4 — the Client Area self-context executive surface.
 *
 * WHY IT IS A MODULE OF ITS OWN
 * -----------------------------
 * Same shape AP3 proved correct (`ClientAreaApprovalsModule`): the dependency
 * has to point one way, Client Area → domain. If `ClientAreaModule` imported
 * `DashboardsModule`, every spec that touches Client Area authentication would
 * transitively load Finance, Projects, Clients, Activities, Team, Calendar and
 * Platform; if `DashboardsModule` imported `ClientAreaModule`, the Agency
 * dashboard would drag in the Client Area credential stack and its ESM
 * `otplib` dependency. This module imports both sides, and neither side knows
 * it exists.
 *
 * `DashboardsModule` already exported `AgencyDashboardsService`, so no
 * domain module was reopened and no repository is reached directly (§6).
 */
@Module({
  imports: [DashboardsModule, ClientAreaModule],
  controllers: [ClientAreaSelfOverviewController],
  providers: [ClientAreaSelfOverviewService],
  exports: [ClientAreaSelfOverviewService],
})
export class ClientAreaSelfOverviewModule {}
