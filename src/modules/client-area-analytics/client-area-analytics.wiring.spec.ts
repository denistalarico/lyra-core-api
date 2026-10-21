import { Test } from '@nestjs/testing';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { getDataSourceToken } from '@nestjs/typeorm';
import { ClientAreaAnalyticsModule } from './client-area-analytics.module';
import { ClientAreaSourcesAdapter } from './client-area-sources.adapter';
import { ClientAreaSocialMetricsAdapter } from './client-area-social-metrics.adapter';
import { ClientAreaSourcesRegistry } from './client-area-sources.registry';
import { ClientAreaDashboardsService } from './client-area-dashboards.service';
import { ClientAreaCompanyHooksRegistry } from '../client-area/client-area-company-hooks.registry';
import { ClientAreaModule } from '../client-area/client-area.module';
import {
  ClientAreaBridgeRegistry,
  ClientAreaBridgeRegistryModule,
} from '../../common/client-area-bridge/client-area-bridge.registry';
import { CompanyProductsModule } from '../../common/company-products/company-products.module';
import { ProjectsModule } from '../projects/projects.module';
import { ProjectsCrudService } from '../projects/services/projects-crud.service';
import { TasksCrudService } from '../projects/services/tasks-crud.service';
import { ClientAgencyBillingModule } from '../client-agency-billing/client-agency-billing.module';
import { ClientAgencyBillingService } from '../client-agency-billing/client-agency-billing.service';
import { ClientAreaApprovalsModule } from '../social-approvals/client/client-approvals.module';
import { ClientApprovalsService } from '../social-approvals/client/client-approvals.service';
import { SocialPlannerModule } from '../social-planner/social-planner.module';
import { SocialPlannerService } from '../social-planner/services/social-planner.service';
import { SocialIntegrationsModule } from '../social-integrations/social-integrations.module';
import { SocialAnalyticsReadService } from '../social-integrations/services/social-analytics-read.service';
import { SocialAdBreakdownReadService } from '../social-integrations/services/social-ad-breakdown.read.service';
import { SocialOrganicModule } from '../social-organic/social-organic.module';
import { SocialOrganicAnalyticsReadService } from '../social-organic/analytics/social-organic-analytics-read.service';
import { SocialOrganicAudienceReadService } from '../social-organic/analytics/social-organic-audience-read.service';
import { SocialOrganicActivityReadService } from '../social-organic/analytics/social-organic-activity-read.service';
import { SocialCampaignsModule } from '../social-campaigns/social-campaigns.module';
import { MetaCampaignHierarchyReadService } from '../social-campaigns/services/meta-campaign-hierarchy-read.service';
import { InboxModule } from '../inbox/inbox.module';
import { InboxService } from '../inbox/inbox.service';
import { LeadFlowAgendaModule } from '../leadflow-agenda/leadflow-agenda.module';
import { LeadFlowAgendaService } from '../leadflow-agenda/leadflow-agenda.service';
import { LeadFlowAnalyticsModule } from '../leadflow-analytics/leadflow-analytics.module';
import { LeadFlowOverviewService } from '../leadflow-analytics/services/leadflow-overview.service';
import { LeadFlowOperationalAnalyticsService } from '../leadflow-analytics/services/leadflow-operational-analytics.service';
import { LeadFlowAnalyticsService } from '../leadflow-analytics/services/leadflow-analytics.service';
import { LeadFlowTimeseriesService } from '../leadflow-analytics/services/leadflow-timeseries.service';
import { LeadFlowIntelligenceService } from '../leadflow-analytics/services/leadflow-intelligence.service';
import { CLIENT_AREA_METRIC_READ_PERMISSION } from './client-area-analytics.controller';
import type { ClientAreaContext } from '../client-area/client-area.types';
jest.mock('otplib', () => ({ verify: jest.fn() }));
const dependencies = [
  [ProjectsModule, ProjectsCrudService],
  [ProjectsModule, TasksCrudService],
  [ClientAgencyBillingModule, ClientAgencyBillingService],
  [ClientAreaApprovalsModule, ClientApprovalsService],
  [SocialPlannerModule, SocialPlannerService],
  [SocialIntegrationsModule, SocialAnalyticsReadService],
  [SocialIntegrationsModule, SocialAdBreakdownReadService],
  [SocialOrganicModule, SocialOrganicAnalyticsReadService],
  [SocialOrganicModule, SocialOrganicAudienceReadService],
  [SocialOrganicModule, SocialOrganicActivityReadService],
  [SocialCampaignsModule, MetaCampaignHierarchyReadService],
  [InboxModule, InboxService],
  [LeadFlowAgendaModule, LeadFlowAgendaService],
  [LeadFlowAnalyticsModule, LeadFlowOverviewService],
  [LeadFlowAnalyticsModule, LeadFlowOperationalAnalyticsService],
  [LeadFlowAnalyticsModule, LeadFlowAnalyticsService],
  [LeadFlowAnalyticsModule, LeadFlowTimeseriesService],
  [LeadFlowAnalyticsModule, LeadFlowIntelligenceService],
] as const;
describe('CA13 real registry lifecycle and module boundaries', () => {
  it('imports the domains that actually export each canonical reader', () => {
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      ClientAreaAnalyticsModule,
    ) as unknown[];
    for (const [module, reader] of dependencies) {
      expect(imports).toContain(module);
      expect(Reflect.getMetadata(MODULE_METADATA.EXPORTS, module)).toContain(
        reader,
      );
    }
    expect(
      Reflect.getMetadata(MODULE_METADATA.PROVIDERS, ClientAreaAnalyticsModule),
    ).toEqual(
      expect.arrayContaining([
        ClientAreaSourcesAdapter,
        ClientAreaSocialMetricsAdapter,
        ClientAreaDashboardsService,
      ]),
    );
    expect(
      Reflect.getMetadata(MODULE_METADATA.PROVIDERS, ClientAreaModule),
    ).toContain(ClientAreaCompanyHooksRegistry);
    expect(
      Reflect.getMetadata(MODULE_METADATA.EXPORTS, ClientAreaModule),
    ).toContain(ClientAreaCompanyHooksRegistry);
  });
  it('registers providers at init on the same consumer instances and refuses other methods/routes', async () => {
    const projects = {
      list: jest
        .fn<Promise<unknown[]>, Parameters<ProjectsCrudService['list']>>()
        .mockResolvedValue([
          {
            id: 'p',
            name: 'P',
            status: 'active',
            priority: 'normal',
            dueDate: null,
            metadata: { secret: 'hidden' },
          },
        ]),
    };
    const ref = await Test.createTestingModule({
      imports: [ClientAreaBridgeRegistryModule, CompanyProductsModule],
      providers: [
        ClientAreaAnalyticsModule,
        ClientAreaSourcesRegistry,
        ClientAreaSourcesAdapter,
        ClientAreaSocialMetricsAdapter,
        ClientAreaDashboardsService,
        ClientAreaCompanyHooksRegistry,
        { provide: getDataSourceToken('agency'), useValue: {} },
        ...dependencies.map(([, reader]) => ({
          provide: reader,
          useValue: reader === ProjectsCrudService ? projects : {},
        })),
      ],
    }).compile();
    try {
      const registry = ref.get(ClientAreaSourcesRegistry);
      expect(() => registry.get('agency.projects')).toThrow();
      await ref.init();
      for (const key of [
        'agency.projects',
        'agency.invoices',
        'social.campaign',
        'leadflow.kpis',
        'metric.leadflow.timeseries',
        'metric.social.organic',
      ])
        expect(registry.get(key).key).toBe(key);
      const context = {
        tenantId: 't',
        workspaceId: 'w',
        agencyClientId: 'c',
        companyContextId: 'company',
        userId: 'u',
      } as ClientAreaContext;
      const result = await registry
        .get('agency.projects')
        .read({ scope: context, userId: 'u', context, query: {} });
      expect(result).toEqual([
        {
          id: 'p',
          name: 'P',
          status: 'active',
          priority: 'normal',
          dueDate: null,
        },
      ]);
      expect(projects.list.mock.calls[0][0]).toMatchObject({
        role: undefined,
        clientArea: context,
        managedContext: { clientId: 'c', companyContextId: 'company' },
      });
      const bridge = ref.get(ClientAreaBridgeRegistry),
        query = {
          method: 'GET',
          routePath: '/api/agency/client-area-analytics/metrics/:metricId',
          params: { metricId: 'agency.projects' },
        };
      expect(
        await bridge.resolveScope(
          'analytics',
          context,
          CLIENT_AREA_METRIC_READ_PERMISSION,
          query,
        ),
      ).toMatchObject({ tenantId: 't', companyContextId: 'company' });
      for (const patch of [
        { method: 'POST' },
        { routePath: '/leadflow/automations' },
        { params: { metricId: 'invented' } },
      ])
        expect(
          await bridge.resolveScope(
            'analytics',
            context,
            CLIENT_AREA_METRIC_READ_PERMISSION,
            { ...query, ...patch },
          ),
        ).toBeNull();
    } finally {
      await ref.close();
    }
  });
});
