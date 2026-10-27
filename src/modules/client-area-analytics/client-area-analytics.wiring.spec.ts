import { Test } from '@nestjs/testing';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ClientAreaAnalyticsModule } from './client-area-analytics.module';
import { ClientAreaSourcesAdapter } from './client-area-sources.adapter';
import { ClientAreaSourcesRegistry } from './client-area-sources.registry';
import {
  ClientAreaOverviewService,
  OVERVIEW_SOURCES,
} from './client-area-overview.service';
import { ClientAreaOverviewController } from './client-area-analytics.controller';
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
import { InboxModule } from '../inbox/inbox.module';
import { InboxService } from '../inbox/inbox.service';
import { LeadFlowAgendaModule } from '../leadflow-agenda/leadflow-agenda.module';
import { LeadFlowAgendaService } from '../leadflow-agenda/leadflow-agenda.service';
import { LeadFlowAnalyticsModule } from '../leadflow-analytics/leadflow-analytics.module';
import { LeadFlowOverviewService } from '../leadflow-analytics/services/leadflow-overview.service';
import { LeadFlowAnalyticsService } from '../leadflow-analytics/services/leadflow-analytics.service';
import type { ClientAreaContext } from '../client-area/client-area.types';
jest.mock('otplib', () => ({ verify: jest.fn() }));
const dependencies = [
  [ProjectsModule, ProjectsCrudService],
  [ProjectsModule, TasksCrudService],
  [ClientAgencyBillingModule, ClientAgencyBillingService],
  [ClientAreaApprovalsModule, ClientApprovalsService],
  [SocialPlannerModule, SocialPlannerService],
  [SocialIntegrationsModule, SocialAnalyticsReadService],
  [InboxModule, InboxService],
  [LeadFlowAgendaModule, LeadFlowAgendaService],
  [LeadFlowAnalyticsModule, LeadFlowOverviewService],
  [LeadFlowAnalyticsModule, LeadFlowAnalyticsService],
] as const;
describe('Client Area Overview registry lifecycle and module boundaries', () => {
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
    // CA-AN3: the CA13 dashboards facade is gone; only the Overview sources remain.
    expect(
      Reflect.getMetadata(MODULE_METADATA.PROVIDERS, ClientAreaAnalyticsModule),
    ).toEqual([
      ClientAreaSourcesRegistry,
      ClientAreaSourcesAdapter,
      ClientAreaOverviewService,
    ]);
    expect(
      Reflect.getMetadata(
        MODULE_METADATA.CONTROLLERS,
        ClientAreaAnalyticsModule,
      ),
    ).toEqual([ClientAreaOverviewController]);
  });
  it('registers the Overview sources at init on the same consumer instances and no CA13 metric wiring', async () => {
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
      for (const key of OVERVIEW_SOURCES)
        expect(registry.get(key).key).toBe(key);
      for (const key of ['metric.leadflow.timeseries', 'metric.social.organic'])
        expect(() => registry.get(key)).toThrow();
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
      // No CA13 metric scope resolver remains.
      expect(
        await ref
          .get(ClientAreaBridgeRegistry)
          .resolveScope('analytics', context, 'agency.dashboards.view.agency', {
            method: 'GET',
            routePath: '/api/agency/client-area-analytics/metrics/:metricId',
            params: { metricId: 'agency.projects' },
          }),
      ).toBeNull();
    } finally {
      await ref.close();
    }
  });
});
