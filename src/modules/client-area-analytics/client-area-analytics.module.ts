import { ClientAreaSocialMetricsAdapter } from './client-area-social-metrics.adapter';
import { SocialCampaignsModule } from '../social-campaigns/social-campaigns.module';
import { Module, type OnModuleInit } from '@nestjs/common';
import { ClientAreaModule } from '../client-area/client-area.module';
import { PermissionsModule } from '../permissions';
import { CompanyProductsModule } from '../../common/company-products/company-products.module';
import {
  ClientAreaBridgeRegistry,
  ClientAreaBridgeRegistryModule,
} from '../../common/client-area-bridge/client-area-bridge.registry';
import { ProjectsModule } from '../projects/projects.module';
import { ClientAgencyBillingModule } from '../client-agency-billing/client-agency-billing.module';
import { ClientAreaApprovalsModule } from '../social-approvals/client/client-approvals.module';
import { SocialPlannerModule } from '../social-planner/social-planner.module';
import { SocialIntegrationsModule } from '../social-integrations/social-integrations.module';
import { SocialOrganicModule } from '../social-organic/social-organic.module';
import { InboxModule } from '../inbox/inbox.module';
import { LeadFlowAgendaModule } from '../leadflow-agenda/leadflow-agenda.module';
import { LeadFlowAnalyticsModule } from '../leadflow-analytics/leadflow-analytics.module';
import { ClientAreaSourcesRegistry } from './client-area-sources.registry';
import { ClientAreaSourcesAdapter } from './client-area-sources.adapter';
import { ClientAreaDashboardsService } from './client-area-dashboards.service';
import { ClientAreaOverviewService } from './client-area-overview.service';
import { ClientAreaMetricDataService } from './client-area-metric-data.service';
import {
  ClientAreaOverviewController,
  ClientAreaDashboardsController,
  ClientAreaDashboardsAgencyController,
  ClientAreaMetricDataController,
  CLIENT_AREA_METRIC_READ_PERMISSION,
} from './client-area-analytics.controller';
import { metricById } from './client-area-layout.contract';
@Module({
  imports: [
    SocialCampaignsModule,
    ClientAreaModule,
    PermissionsModule,
    CompanyProductsModule,
    ClientAreaBridgeRegistryModule,
    ProjectsModule,
    ClientAgencyBillingModule,
    ClientAreaApprovalsModule,
    SocialPlannerModule,
    SocialIntegrationsModule,
    SocialOrganicModule,
    InboxModule,
    LeadFlowAgendaModule,
    LeadFlowAnalyticsModule,
  ],
  controllers: [
    ClientAreaOverviewController,
    ClientAreaDashboardsController,
    ClientAreaDashboardsAgencyController,
    ClientAreaMetricDataController,
  ],
  providers: [
    ClientAreaSourcesRegistry,
    ClientAreaSourcesAdapter,
    ClientAreaSocialMetricsAdapter,
    ClientAreaDashboardsService,
    ClientAreaOverviewService,
    ClientAreaMetricDataService,
  ],
})
export class ClientAreaAnalyticsModule implements OnModuleInit {
  constructor(private readonly bridge: ClientAreaBridgeRegistry) {}
  onModuleInit() {
    this.bridge.registerScopeResolver('analytics', (context, key, request) => {
      const path = request.routePath?.replace(/^\/api(?=\/)/, '');
      const id = request.params?.metricId;
      if (
        !['GET', 'HEAD'].includes(request.method ?? '') ||
        path !== '/agency/client-area-analytics/metrics/:metricId' ||
        key !== CLIENT_AREA_METRIC_READ_PERMISSION ||
        typeof id !== 'string' ||
        !metricById(id)
      )
        return Promise.resolve(null);
      return Promise.resolve({
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        agencyClientId: context.agencyClientId,
        companyContextId: context.companyContextId,
        createdById: null,
      });
    });
  }
}
