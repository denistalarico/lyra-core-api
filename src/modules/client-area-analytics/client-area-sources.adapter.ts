import { projectSocialAnalyticsData } from './client-area-social-data.projection';
import type { InboxConversationEntity } from '../inbox/entities/inbox-conversation.entity';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import type {
  RequestContext,
  ProductKey,
} from '../../common/context/request-context.interface';
import { ProjectsCrudService } from '../projects/services/projects-crud.service';
import { TasksCrudService } from '../projects/services/tasks-crud.service';
import { ProjectStatus } from '../projects/enums';
import { ClientAgencyBillingService } from '../client-agency-billing/client-agency-billing.service';
import { ClientApprovalsService } from '../social-approvals/client/client-approvals.service';
import { SocialPlannerService } from '../social-planner/services/social-planner.service';
import { SocialAnalyticsReadService } from '../social-integrations/services/social-analytics-read.service';
import { InboxService } from '../inbox/inbox.service';
import { LeadFlowAgendaService } from '../leadflow-agenda/leadflow-agenda.service';
import { LeadFlowOverviewService } from '../leadflow-analytics/services/leadflow-overview.service';
import { LeadFlowAnalyticsService } from '../leadflow-analytics/services/leadflow-analytics.service';
import {
  ClientAreaSourcesRegistry,
  AnalyticsSourceUnavailable,
  type AnalyticsSourceInput,
} from './client-area-sources.registry';

/** Scope was produced by toCompanyAwareScope (or the Agency's resolved managed context).
 * This adapter never constructs an Agency role for a client or accepts browser authority. */
export function analyticsDomainContext(
  input: AnalyticsSourceInput,
  productKey: ProductKey,
): RequestContext & { workspaceId: string; userId: string } {
  if (input.agencyContext) {
    return {
      ...input.agencyContext,
      workspaceId: input.agencyContext.workspaceId!,
      userId: input.userId,
      managedContext: {
        productKey,
        operatingMode: 'agency',
        clientId: null,
        companyContextId: null,
        managedTenantId: null,
      },
    };
  }
  if (!input.scope) throw new AnalyticsSourceUnavailable('module_unavailable');
  return {
    tenantId: input.scope.tenantId,
    workspaceId: input.scope.workspaceId,
    userId: input.userId,
    managedContext: {
      productKey,
      operatingMode: 'client',
      clientId: input.scope.agencyClientId,
      companyContextId: input.scope.companyContextId,
      managedTenantId: null,
    },
  };
}
function companyScope(input: AnalyticsSourceInput) {
  if (!input.scope) throw new AnalyticsSourceUnavailable('module_unavailable');
  return input.scope;
}
export function analyticsPeriod(input: AnalyticsSourceInput) {
  const to = input.query.to ? new Date(input.query.to) : new Date();
  const from = input.query.from
    ? new Date(input.query.from)
    : new Date(to.getTime() - 7 * 86400000);
  return { from: from.toISOString(), to: to.toISOString() };
}
/** The projection adapter registers real canonical readers at module init (D-09), never a DI token bound by a third module. */
@Injectable()
export class ClientAreaSourcesAdapter implements OnModuleInit {
  constructor(
    private readonly registry: ClientAreaSourcesRegistry,
    private readonly projects: ProjectsCrudService,
    private readonly tasks: TasksCrudService,
    private readonly billing: ClientAgencyBillingService,
    private readonly approvals: ClientApprovalsService,
    private readonly planner: SocialPlannerService,
    private readonly paid: SocialAnalyticsReadService,
    private readonly inbox: InboxService,
    private readonly agenda: LeadFlowAgendaService,
    private readonly lfOverview: LeadFlowOverviewService,
    private readonly commercial: LeadFlowAnalyticsService,
  ) {}
  onModuleInit() {
    this.registry.register({
      key: 'agency.projects',
      modules: ['agency_projects'],
      read: async (input) =>
        (
          await this.projects.list(
            {
              ...analyticsDomainContext(input, 'agency'),
              clientArea: input.context,
            },
            {
              ...(input.scope ? { clientId: input.scope.agencyClientId } : {}),
              status: ProjectStatus.Active,
            },
          )
        ).map((row) => ({
          id: row.id,
          name: row.name,
          status: row.status,
          priority: row.priority,
          dueDate: row.dueDate,
        })),
    });
    this.registry.register({
      key: 'agency.tasks',
      modules: ['agency_projects'],
      read: async (input) =>
        (
          await this.tasks.listWorkspaceTasks(
            {
              ...analyticsDomainContext(input, 'agency'),
              clientArea: input.context,
            },
            input.scope ? { clientId: input.scope.agencyClientId } : {},
          )
        )
          .filter(
            (row) =>
              row.dueDate &&
              row.dueDate.getTime() >= Date.now() &&
              !['done', 'cancelled', 'archived'].includes(row.status),
          )
          .sort((a, b) => a.dueDate!.getTime() - b.dueDate!.getTime())
          .slice(0, 10)
          .map((row) => ({
            id: row.id,
            title: row.title,
            status: row.status,
            priority: row.priority,
            dueDate: row.dueDate,
            projectId: row.projectId,
          })),
    });
    this.registry.register({
      key: 'agency.invoices',
      modules: ['agency_billing'],
      ownerOnly: true,
      read: async (input) => ({
        invoices: (
          await this.billing.invoicesInScope(companyScope(input))
        ).invoices.filter((row) =>
          ['issued', 'partially_paid', 'overdue'].includes(row.status),
        ),
      }),
    });
    this.registry.register({
      key: 'agency.contract',
      modules: ['agency_billing'],
      ownerOnly: true,
      read: async (input) => ({
        current: (
          await this.billing.contractHistoryInScope(companyScope(input))
        ).current,
      }),
    });
    this.registry.register({
      key: 'social.approvals',
      modules: ['approvals'],
      read: async (input) => ({
        items: (await this.approvals.list(companyScope(input))).items
          .filter((row) => row.needsYou || row.downloadable)
          .map((row) => ({
            id: row.id,
            title: row.title,
            status: row.status,
            needsYou: row.needsYou,
            downloadable: row.downloadable,
            versionLabel: row.versionLabel,
          })),
      }),
    });
    this.registry.register({
      key: 'social.contents',
      modules: ['social_planner'],
      read: async (input) => {
        const now = new Date(),
          from = now.toISOString().slice(0, 10),
          until = new Date(now.getTime() + 7 * 86400000)
            .toISOString()
            .slice(0, 10);
        const scope = companyScope(input);
        const plans = await this.planner.listPlans(scope);
        const groups = await Promise.all(
          plans.items.map((plan) => this.planner.listContent(scope, plan.id)),
        );
        return {
          period: { from, until, untilExclusive: true },
          items: groups
            .flatMap((g) => g.items)
            .filter(
              (row) =>
                row.plannedDate &&
                row.plannedDate >= from &&
                row.plannedDate < until,
            )
            .sort((a, b) =>
              String(a.plannedDate).localeCompare(String(b.plannedDate)),
            )
            .slice(0, 20)
            .map((row) => ({
              id: row.id,
              planId: row.planId,
              title: row.title,
              plannedDate: row.plannedDate,
              planningStatus: row.planningStatus,
            })),
        };
      },
    });
    this.registry.register({
      key: 'social.campaign',
      modules: ['social_campaigns'],
      read: async (input) => {
        const scope = companyScope(input);
        const connections = await this.paid.listConnections(scope);
        if (!connections.length)
          throw new AnalyticsSourceUnavailable('source_not_configured');
        const period = analyticsPeriod(input);
        const results = await Promise.all(
          connections.map((connection) =>
            this.paid.latestCampaign({
              ...scope,
              connectionId: connection.id,
              since: period.from.slice(0, 10),
              until: period.to.slice(0, 10),
            }),
          ),
        );
        const latest =
          results
            .filter((row): row is NonNullable<typeof row> => row !== null)
            .sort((a, b) => b.selectedAt.localeCompare(a.selectedAt))[0] ??
          null;
        return { campaign: projectSocialAnalyticsData(latest) };
      },
    });
    this.registry.register({
      key: 'leadflow.inbox',
      modules: ['leadflow_inbox'],
      read: async (input) => {
        const result = await this.inbox.listConversations(
          analyticsDomainContext(input, 'leadflow'),
          { status: 'open' },
        );
        return {
          total: result.total,
          limit: 100,
          items: (result.items as InboxConversationEntity[]).map((row) => ({
            id: row.id,
            title: row.title,
            status: row.status,
            unreadCount: row.unreadCount,
            lastMessageAt: row.lastMessageAt,
          })),
        };
      },
    });
    this.registry.register({
      key: 'leadflow.leads',
      modules: ['leadflow_crm'],
      read: async (input) => {
        const result = await this.commercial.getCommercialJourney(
          analyticsDomainContext(input, 'leadflow'),
          analyticsPeriod(input),
        );
        return {
          period: result.period,
          newOpportunities: result.summary.opportunities,
        };
      },
    });
    this.registry.register({
      key: 'leadflow.appointments',
      modules: ['leadflow_appointments'],
      read: async (input) => ({
        items: (
          await this.agenda.listAppointments(
            analyticsDomainContext(input, 'leadflow'),
          )
        )
          .filter(
            (row) =>
              row.startAt &&
              row.startAt.getTime() >= Date.now() &&
              !['cancelled', 'missed', 'completed'].includes(row.status),
          )
          .slice(0, 10)
          .map((row) => ({
            id: row.id,
            title: row.title,
            type: row.type,
            status: row.status,
            startAt: row.startAt,
            endAt: row.endAt,
          })),
      }),
    });
    this.registry.register({
      key: 'leadflow.kpis',
      modules: ['leadflow_inbox', 'leadflow_crm'],
      read: async (input) => {
        const result = await this.lfOverview.getOverview(
          analyticsDomainContext(input, 'leadflow'),
          analyticsPeriod(input),
        );
        return {
          window: result.window,
          kpis: result.kpis.map((k) => ({
            key: k.key,
            label: k.label,
            value: k.value,
            unit: k.unit,
            formula: k.formula,
            source: k.source,
            window: k.window,
            limitation: k.limitation,
          })),
        };
      },
    });
  }
}
