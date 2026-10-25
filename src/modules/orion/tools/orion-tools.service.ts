import { Injectable, Logger } from '@nestjs/common';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { CrmService } from '../../crm/crm.service';
import { LeadFlowAgendaService } from '../../leadflow-agenda/leadflow-agenda.service';
import { LeadFlowAgentService } from '../../leadflow-agents/services/leadflow-agent.service';
import { LeadFlowAnalyticsService } from '../../leadflow-analytics/services/leadflow-analytics.service';
import { LeadFlowOperationalAnalyticsService } from '../../leadflow-analytics/services/leadflow-operational-analytics.service';
import type { OrionToolCallRecord } from '../entities';
import { ORION_CAPABILITIES_MANIFEST } from '../manifest/orion-capabilities.manifest';
import { OrionConfigService } from '../orion-config.service';
import type { OrionToolCall } from '../orion.provider';
import type { OrionCard, OrionUiAction } from '../orion.types';
import { OrionHelpSearchService } from './orion-help-search.service';
import {
  ORION_DAYS,
  ORION_PERIODS,
  resolveOrionDay,
  resolveOrionPeriod,
  zonedTime,
  type OrionDay,
  type OrionPeriod,
} from './orion-period';
import {
  OrionToolAccessService,
  type OrionAccess,
} from './orion-tool-access.service';
import { ORION_TOOL_CATALOG, type OrionToolName } from './orion-tool-catalog';

/** Everything a tool may use: the caller's context, proven by the request. */
export type OrionToolRun = {
  ctx: RequestContext;
  access: OrionAccess;
};

export type OrionToolExecution = {
  record: OrionToolCallRecord;
  /** What the model receives (framed as untrusted data by the prompt). */
  payload: unknown;
  card?: OrionCard;
  uiAction?: OrionUiAction;
};

type Args = Record<string, unknown>;
type Output = Omit<OrionToolExecution, 'record'>;

const THEMES = ['light', 'dark', 'system'] as const;
const ROUTES = new Set(ORION_CAPABILITIES_MANIFEST.routes.map((r) => r.path));
const TOP = 5;

/**
 * OR4 — executes one tool call of the model with the caller's permissions.
 *
 * Order per call: the tool must exist for the principal → arguments must be
 * valid (enums only; extra arguments are ignored, never read) → the explicit
 * permission check of the equivalent route → the service, with the caller's
 * `RequestContext` (scope from the JWT; services resolve the company via
 * `resolveCompanyAwareScope`). Outputs are aggregates and display names,
 * never IDs or contact data (§3.5 item 8).
 */
@Injectable()
export class OrionToolsService {
  private readonly logger = new Logger(OrionToolsService.name);

  constructor(
    private readonly access: OrionToolAccessService,
    private readonly help: OrionHelpSearchService,
    private readonly operational: LeadFlowOperationalAnalyticsService,
    private readonly analytics: LeadFlowAnalyticsService,
    private readonly agents: LeadFlowAgentService,
    private readonly crm: CrmService,
    private readonly agenda: LeadFlowAgendaService,
    private readonly config: OrionConfigService,
  ) {}

  async execute(
    call: OrionToolCall,
    run: OrionToolRun,
  ): Promise<OrionToolExecution> {
    const spec = ORION_TOOL_CATALOG.find(
      (tool) =>
        tool.name === call.name &&
        (run.access.kind === 'agency' || tool.clientArea),
    );
    const name = spec?.name ?? 'unknown';
    const fail = (
      outcome: OrionToolCallRecord['outcome'],
      error: string,
    ): OrionToolExecution => ({
      record: { name, outcome },
      payload: { error },
    });
    if (!spec) return fail('invalid', 'unknown_tool');

    const args = parseArguments(call.arguments);
    if (!args || !validArguments(spec.name, args))
      return fail('invalid', 'invalid_arguments');

    if (
      spec.requirement &&
      !(await this.access.allowed(run.access, spec.requirement))
    )
      return fail('denied', 'permission_denied');

    try {
      const output = await this.run(spec.name, args, run);
      if (!output) return fail('invalid', 'invalid_arguments');
      return { record: { name, outcome: 'ok' }, ...output };
    } catch (error) {
      // Codes and class names only: messages may carry data.
      this.logger.warn(
        `orion tool failed tool=${name} error=${(error as Error)?.constructor?.name ?? 'unknown'}`,
      );
      return fail('error', 'unavailable');
    }
  }

  private run(
    name: OrionToolName,
    args: Args,
    run: OrionToolRun,
  ): Promise<Output | null> {
    switch (name) {
      case 'search_help':
        return this.searchHelp(String(args.query), run);
      case 'leadflow_operational_overview':
        return this.operationalOverview(args.period as OrionPeriod, run.ctx);
      case 'leadflow_commercial_journey':
        return this.commercialJourney(args.period as OrionPeriod, run.ctx);
      case 'list_agents':
        return this.listAgents(run.ctx);
      case 'crm_pipeline_snapshot':
        return this.pipelineSnapshot(run.ctx);
      case 'agenda_for_day':
        return this.agendaForDay(args.day as OrionDay, run.ctx);
      case 'ui_action':
        return Promise.resolve(uiAction(args, run.access.kind));
    }
  }

  /** Also used without the LLM, as the limit fallback (D-OR-1). */
  async searchHelp(
    query: string,
    run: Pick<OrionToolRun, 'access'>,
  ): Promise<Output> {
    const hits = await this.help.search(query, { limit: 4 });
    // The Client Area has no Help Center screen: titles and excerpts only.
    const route = (slug: string) =>
      run.access.kind === 'agency' ? `/knowledge/help/articles/${slug}` : null;
    return {
      payload: {
        articles: hits.map((hit) => ({
          title: hit.title,
          summary: hit.summary,
          excerpt: hit.excerpt,
          route: route(hit.slug),
        })),
      },
      card: hits.length
        ? {
            kind: 'help_links',
            items: hits.map((hit) => ({
              title: hit.title,
              summary: hit.summary,
              route: route(hit.slug),
            })),
          }
        : undefined,
    };
  }

  private async operationalOverview(
    period: OrionPeriod,
    ctx: RequestContext,
  ): Promise<Output> {
    const { from, to } = resolveOrionPeriod(period, this.config.timeZone);
    const result = await this.operational.getOverview(ctx, {
      from: from.toISOString(),
      to: to.toISOString(),
    });
    const summary = result.messages.summary;
    return {
      payload: {
        period,
        messages: {
          total: summary.total,
          inbound: summary.inbound,
          outbound: summary.outbound,
          automatedOutbound: summary.automatedOutbound,
          humanOutbound: summary.humanOutbound,
          failedOutbound: summary.failedOutbound,
          conversations: summary.conversations,
          respondedConversations: summary.respondedConversations,
          firstResponseRate: summary.firstResponseRate,
          averageFirstResponseSeconds: summary.averageFirstResponseSeconds,
          averageResponseSeconds: summary.averageResponseSeconds,
        },
        byChannel: [...result.messages.byChannel]
          .sort((a, b) => b.conversations - a.conversations)
          .slice(0, TOP)
          .map((row) => ({
            channel: row.name,
            type: row.type,
            inbound: row.inbound,
            outbound: row.outbound,
            conversations: row.conversations,
          })),
        byAgent: [...result.messages.byAgent]
          .sort((a, b) => b.conversations - a.conversations)
          .slice(0, TOP)
          .map((row) => ({
            agent: row.name,
            outbound: row.outbound,
            conversations: row.conversations,
            averageResponseSeconds: row.averageResponseSeconds,
          })),
        leadScore: {
          opportunities: result.leadScore.summary.opportunities,
          averageScore: result.leadScore.summary.averageScore,
          hotTransitions: result.leadScore.summary.hotTransitions,
        },
      },
    };
  }

  private async commercialJourney(
    period: OrionPeriod,
    ctx: RequestContext,
  ): Promise<Output> {
    const { from, to } = resolveOrionPeriod(period, this.config.timeZone);
    const result = await this.analytics.getCommercialJourney(ctx, {
      from: from.toISOString(),
      to: to.toISOString(),
    });
    const s = result.summary;
    return {
      payload: {
        period,
        opportunities: {
          created: s.opportunities,
          open: s.open,
          won: s.won,
          lost: s.lost,
          winRate: s.winRate,
          handoffRequested: s.handoffRequested,
          handoffAccepted: s.handoffAccepted,
          aiInfluenced: s.aiInfluencedOpportunities,
          aiInfluencedWins: s.aiInfluencedWins,
        },
        wonValue: result.wonValueByCurrency.map((row) => ({
          currency: row.currency,
          amount: row.amount,
        })),
        stages: result.stages.slice(0, 15).map((stage) => ({
          stage: stage.name,
          pipeline:
            result.pipelines.find((p) => p.pipelineId === stage.pipelineId)
              ?.name ?? null,
          entries: stage.entries,
          openAtEnd: stage.openAtEnd,
          wins: stage.wins,
          losses: stage.losses,
        })),
      },
    };
  }

  private async listAgents(ctx: RequestContext): Promise<Output> {
    const listed = await this.agents.list(ctx);
    return {
      payload: {
        agents: listed.items
          .filter((agent) => !agent.deletedAt)
          .slice(0, 20)
          .map((agent) => ({
            name: agent.name,
            type: agent.type,
            status: agent.status,
            archived: Boolean(agent.archivedAt),
            channels: [...new Set(agent.channels.map((c) => c.channelKey))],
          })),
      },
    };
  }

  private async pipelineSnapshot(ctx: RequestContext): Promise<Output> {
    const [pipelines, stages, open] = await Promise.all([
      this.crm.listPipelines(ctx),
      this.crm.listStages(ctx),
      this.crm.listOpportunities(ctx, { status: 'open' }),
    ]);
    const perStage = new Map<string, number>();
    for (const opportunity of open)
      perStage.set(
        opportunity.stageId,
        (perStage.get(opportunity.stageId) ?? 0) + 1,
      );
    return {
      payload: {
        openOpportunities: open.length,
        pipelines: [...pipelines]
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .slice(0, 5)
          .map((pipeline) => ({
            pipeline: pipeline.name,
            stages: stages
              .filter((stage) => stage.pipelineId === pipeline.id)
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .slice(0, 15)
              .map((stage) => ({
                stage: stage.name,
                open: perStage.get(stage.id) ?? 0,
              })),
          })),
      },
    };
  }

  private async agendaForDay(
    day: OrionDay,
    ctx: RequestContext,
  ): Promise<Output> {
    const { from, to } = resolveOrionDay(day, this.config.timeZone);
    // Scheduled items only: workspace Activities are not company items in the
    // Client Area (CA11), and the bridge filter does not run for tools.
    const items = (await this.agenda.listAppointments(ctx))
      .map((item) => ({ item, at: item.startAt ?? item.dueAt ?? null }))
      .filter(
        (entry): entry is { item: typeof entry.item; at: Date } =>
          entry.at !== null &&
          entry.at.getTime() >= from.getTime() &&
          entry.at.getTime() < to.getTime(),
      )
      .sort((a, b) => a.at.getTime() - b.at.getTime());
    return {
      payload: {
        day,
        total: items.length,
        items: items.slice(0, 15).map(({ item, at }) => ({
          time: item.allDay ? 'dia todo' : zonedTime(at, this.config.timeZone),
          title: item.title.slice(0, 80),
          type: item.type,
          status: item.status,
        })),
      },
    };
  }
}

function parseArguments(raw: string): Args | null {
  try {
    const value: unknown = JSON.parse(raw || '{}');
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Args)
      : null;
  } catch {
    return null;
  }
}

function validArguments(name: OrionToolName, args: Args): boolean {
  switch (name) {
    case 'search_help':
      return typeof args.query === 'string' && args.query.trim().length > 0;
    case 'leadflow_operational_overview':
    case 'leadflow_commercial_journey':
      return (ORION_PERIODS as readonly unknown[]).includes(args.period);
    case 'agenda_for_day':
      return (ORION_DAYS as readonly unknown[]).includes(args.day);
    case 'ui_action':
      return typeof args.action === 'string' && typeof args.value === 'string';
    default:
      return true;
  }
}

function uiAction(args: Args, principal: OrionAccess['kind']): Output | null {
  if (
    args.action === 'set_theme' &&
    (THEMES as readonly unknown[]).includes(args.value)
  ) {
    const action: OrionUiAction = {
      action: 'set_theme',
      value: args.value as (typeof THEMES)[number],
    };
    return { payload: { done: true, ...action }, uiAction: action };
  }
  // Manifest routes are Agency screens; the client never navigates there.
  if (
    args.action === 'navigate' &&
    principal === 'agency' &&
    ROUTES.has(String(args.value))
  ) {
    const action: OrionUiAction = {
      action: 'navigate',
      value: String(args.value),
    };
    return { payload: { done: true, ...action }, uiAction: action };
  }
  return null;
}
