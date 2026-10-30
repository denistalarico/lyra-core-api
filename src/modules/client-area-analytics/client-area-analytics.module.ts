import { Module } from '@nestjs/common';
import { ClientAreaModule } from '../client-area/client-area.module';
import { PermissionsModule } from '../permissions';
import { ProjectsModule } from '../projects/projects.module';
import { ClientAgencyBillingModule } from '../client-agency-billing/client-agency-billing.module';
import { ClientAreaApprovalsModule } from '../social-approvals/client/client-approvals.module';
import { SocialPlannerModule } from '../social-planner/social-planner.module';
import { SocialIntegrationsModule } from '../social-integrations/social-integrations.module';
import { InboxModule } from '../inbox/inbox.module';
import { LeadFlowAgendaModule } from '../leadflow-agenda/leadflow-agenda.module';
import { LeadFlowAnalyticsModule } from '../leadflow-analytics/leadflow-analytics.module';
import { ClientAreaSourcesRegistry } from './client-area-sources.registry';
import { ClientAreaSourcesAdapter } from './client-area-sources.adapter';
import { ClientAreaOverviewService } from './client-area-overview.service';
import {
  ClientAreaOverviewController,
  ClientAreaSelfOverviewController,
} from './client-area-analytics.controller';
/** CA-AN3: only the Client Area `overview` module lives here; the CA13 dashboards facade was retired. */
@Module({
  imports: [
    ClientAreaModule,
    PermissionsModule,
    ProjectsModule,
    ClientAgencyBillingModule,
    ClientAreaApprovalsModule,
    SocialPlannerModule,
    SocialIntegrationsModule,
    InboxModule,
    LeadFlowAgendaModule,
    LeadFlowAnalyticsModule,
  ],
  controllers: [ClientAreaOverviewController, ClientAreaSelfOverviewController],
  providers: [
    ClientAreaSourcesRegistry,
    ClientAreaSourcesAdapter,
    ClientAreaOverviewService,
  ],
})
export class ClientAreaAnalyticsModule {}
