import { BadRequestException, Injectable } from '@nestjs/common';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { LeadFlowClientSettingsService } from '../../leadflow-settings/services/leadflow-client-settings.service';
import { WhatsAppChannelHealthService } from '../../inbox/channels/whatsapp/services/whatsapp-channel-health.service';
import type { GetLeadFlowOverviewDto } from '../dto/get-leadflow-overview.dto';
import type {
  LeadFlowOverviewDomainHealth,
  LeadFlowOverviewKpi,
  LeadFlowOverviewOperatingContext,
  LeadFlowOverviewPriority,
  LeadFlowOverviewResponse,
  LeadFlowOverviewWindow,
} from '../types/leadflow-overview.types';
import { LeadFlowAnalyticsService } from './leadflow-analytics.service';
import { LeadFlowOperationalAnalyticsService } from './leadflow-operational-analytics.service';

// The Overview is a "what needs attention right now" snapshot, not a
// historical report — the full-history/366-day case already belongs to
// /leadflow/analytics/{operational-overview,commercial-journey} (F11). A
// short default window keeps every KPI reading fresh, and the low cap keeps
// the two underlying analytics queries (each already bounded, but not free)
// cheap on every Overview load.
const DEFAULT_WINDOW_DAYS = 7;
const MAX_WINDOW_DAYS = 90;

type WhatsAppMappedChannel = {
  state:
    | 'not_connected'
    | 'connecting'
    | 'connected'
    | 'failed'
    | 'needs_action';
  metadata: Record<string, unknown>;
};

@Injectable()
export class LeadFlowOverviewService {
  constructor(
    private readonly operationalAnalytics: LeadFlowOperationalAnalyticsService,
    private readonly commercialAnalytics: LeadFlowAnalyticsService,
    private readonly whatsappHealth: WhatsAppChannelHealthService,
    private readonly clientSettings: LeadFlowClientSettingsService,
  ) {}

  async getOverview(
    ctx: RequestContext,
    query: GetLeadFlowOverviewDto,
  ): Promise<LeadFlowOverviewResponse> {
    const tenantId = this.requireTenantId(ctx);
    const workspaceId = this.requireWorkspaceId(ctx);
    const context = this.resolveContext(ctx);
    const { from, to } = this.resolvePeriod(query);
    const window: LeadFlowOverviewWindow = {
      from: from.toISOString(),
      to: to.toISOString(),
    };
    const periodQuery = { from: window.from, to: window.to };

    const [operational, commercial, whatsappStatus, capacity] =
      await Promise.all([
        this.operationalAnalytics.getOverview(ctx, periodQuery),
        this.commercialAnalytics.getCommercialJourney(ctx, periodQuery),
        this.whatsappHealth.listStatus({ tenantId, workspaceId }),
        context.operatingMode === 'agency'
          ? this.clientSettings.getCapacity(ctx)
          : Promise.resolve(null),
      ]);

    const scopedChannels = whatsappStatus.channels.filter((channel) =>
      isChannelForContext(channel, context),
    );
    const inboxConnectionState = resolveScopedConnectionState(scopedChannels);

    const kpis = this.buildKpis(window, operational, commercial);
    const domainHealth = {
      inbox: this.buildInboxHealth(window, operational, inboxConnectionState),
      crm: this.buildCrmHealth(window, commercial),
      automations: this.buildAutomationsHealth(window, operational),
    };
    const priorities = this.buildPriorities(
      operational,
      inboxConnectionState,
      scopedChannels.length > 0,
      context,
      capacity,
    );

    return {
      generatedAt: new Date().toISOString(),
      window: { ...window, days: differenceInDays(from, to) },
      context,
      kpis,
      domainHealth,
      priorities,
    };
  }

  private buildKpis(
    window: LeadFlowOverviewWindow,
    operational: Awaited<
      ReturnType<LeadFlowOperationalAnalyticsService['getOverview']>
    >,
    commercial: Awaited<
      ReturnType<LeadFlowAnalyticsService['getCommercialJourney']>
    >,
  ): LeadFlowOverviewKpi[] {
    const { messages, leadScore, automations } = operational;

    return [
      {
        key: 'first_response_rate',
        label: 'Taxa de primeira resposta',
        value: messages.summary.firstResponseRate,
        unit: 'percentage',
        formula:
          'conversas com entrada que receberam uma primeira resposta ÷ conversas com entrada no período',
        source:
          'GET /leadflow/analytics/operational-overview (messages.summary)',
        window,
        limitation:
          'conversas sem mensagem de entrada no período não entram no denominador; volume baixo faz a taxa oscilar bastante.',
      },
      {
        key: 'first_response_time_seconds',
        label: 'Tempo médio de primeira resposta',
        value: messages.summary.averageFirstResponseSeconds,
        unit: 'seconds',
        formula:
          'média do tempo entre a primeira mensagem de entrada e a primeira resposta, por conversa respondida',
        source:
          'GET /leadflow/analytics/operational-overview (messages.summary)',
        window,
        limitation:
          'é uma média simples (sem P50/P90); poucas respostas muito lentas distorcem o número.',
      },
      {
        key: 'hot_lead_transitions',
        label: 'Leads que ficaram quentes',
        value: leadScore.summary.hotTransitions,
        unit: 'count',
        formula:
          'quantidade de oportunidades cujo score cruzou para a faixa "hot" vindo de uma faixa diferente, dentro do período',
        source:
          'GET /leadflow/analytics/operational-overview (leadScore.summary)',
        window,
        limitation:
          'conta transições, não o total de oportunidades quentes agora; uma oportunidade pode transicionar mais de uma vez se o score oscilar perto do limite.',
      },
      {
        key: 'commercial_win_rate',
        label: 'Taxa de conversão comercial',
        value: commercial.summary.winRate,
        unit: 'percentage',
        formula:
          'oportunidades ganhas ÷ oportunidades criadas no período (coorte por criação)',
        source: 'GET /leadflow/analytics/commercial-journey (summary)',
        window,
        limitation:
          'o denominador inclui oportunidades ainda abertas (criadas há pouco tempo e sem chance de fechar), o que tende a subestimar a taxa em períodos curtos.',
      },
      {
        key: 'automation_success_rate',
        label: 'Taxa de sucesso das automações',
        value: automations.summary.successRate,
        unit: 'percentage',
        formula:
          'execuções com status "succeeded" ÷ execuções terminais (succeeded + failed) no período',
        source:
          'GET /leadflow/analytics/operational-overview (automations.summary)',
        window,
        limitation:
          'mistura execuções live, shadow e dry-run — não isola sucesso em produção real; ver LeadFlow Canary Executor para o estado atual do kill switch.',
      },
    ];
  }

  private buildInboxHealth(
    window: LeadFlowOverviewWindow,
    operational: Awaited<
      ReturnType<LeadFlowOperationalAnalyticsService['getOverview']>
    >,
    connectionState: ReturnType<typeof resolveScopedConnectionState>,
  ): LeadFlowOverviewDomainHealth {
    const { summary } = operational.messages;
    const base = {
      source:
        'GET /inbox/channels/whatsapp/status + operational-overview (messages.summary)',
      window,
      deepLink: '/leadflow/inbox',
    };

    if (connectionState === 'not_connected') {
      return {
        ...base,
        status: 'no_data',
        headline: 'Nenhum canal do WhatsApp configurado',
        detail:
          'Conecte um canal do WhatsApp para este contexto para começar a atender.',
        deepLink: '/leadflow/channels/whatsapp',
      };
    }
    if (connectionState === 'failed') {
      return {
        ...base,
        status: 'critical',
        headline: 'WhatsApp desconectado',
        detail:
          'O canal do WhatsApp está com falha de conexão e não deve estar entregando mensagens.',
        deepLink: '/leadflow/channels/whatsapp',
      };
    }
    if (
      connectionState === 'needs_action' ||
      connectionState === 'connecting'
    ) {
      return {
        ...base,
        status: 'attention',
        headline: 'WhatsApp precisa de atenção',
        detail:
          'O canal do WhatsApp ainda não concluiu a configuração ou validação.',
        deepLink: '/leadflow/channels/whatsapp',
      };
    }
    if (summary.inboundConversations === 0) {
      return {
        ...base,
        status: 'no_data',
        headline: 'Sem conversas no período',
        detail:
          'Nenhuma conversa recebeu mensagens de entrada na janela selecionada.',
      };
    }
    if (summary.failedOutbound > 0) {
      return {
        ...base,
        status: 'attention',
        headline: 'Mensagens falhando no envio',
        detail: `${summary.failedOutbound} mensagem(ns) de saída falharam no período.`,
      };
    }
    return {
      ...base,
      status: 'ok',
      headline: 'WhatsApp conectado e respondendo',
      detail: `${summary.respondedConversations} de ${summary.inboundConversations} conversas com primeira resposta no período.`,
    };
  }

  private buildCrmHealth(
    window: LeadFlowOverviewWindow,
    commercial: Awaited<
      ReturnType<LeadFlowAnalyticsService['getCommercialJourney']>
    >,
  ): LeadFlowOverviewDomainHealth {
    const { summary, dataQuality } = commercial;
    const base = {
      source:
        'GET /leadflow/analytics/commercial-journey (summary, dataQuality)',
      window,
      deepLink: '/leadflow/crm',
    };

    if (summary.opportunities === 0) {
      return {
        ...base,
        status: 'no_data',
        headline: 'Sem oportunidades no período',
        detail: 'Nenhuma oportunidade foi criada na janela selecionada.',
      };
    }
    if (
      dataQuality.missingCreationFacts > 0 ||
      dataQuality.legacyJourneyFallbacks > 0
    ) {
      return {
        ...base,
        status: 'attention',
        headline: 'Inconsistências no histórico do funil',
        detail: `${dataQuality.missingCreationFacts} oportunidade(s) sem evento de criação registrado.`,
      };
    }
    return {
      ...base,
      status: 'ok',
      headline: 'Funil comercial ativo',
      detail: `${summary.won} ganha(s) de ${summary.opportunities} oportunidade(s) criada(s) no período.`,
    };
  }

  private buildAutomationsHealth(
    window: LeadFlowOverviewWindow,
    operational: Awaited<
      ReturnType<LeadFlowOperationalAnalyticsService['getOverview']>
    >,
  ): LeadFlowOverviewDomainHealth {
    const { summary } = operational.automations;
    const base = {
      source:
        'GET /leadflow/analytics/operational-overview (automations.summary)',
      window,
      deepLink: '/leadflow/automations',
    };

    if (summary.runs === 0) {
      return {
        ...base,
        status: 'no_data',
        headline: 'Nenhuma automação executada no período',
        detail: 'Não houve execuções de automação na janela selecionada.',
      };
    }
    if (summary.failed > 0 && summary.succeeded === 0) {
      return {
        ...base,
        status: 'critical',
        headline: 'Automações não estão funcionando',
        detail: `${summary.failed} execução(ões) falharam e nenhuma teve sucesso no período.`,
      };
    }
    if (summary.failed > 0) {
      return {
        ...base,
        status: 'attention',
        headline: 'Algumas automações falharam',
        detail: `${summary.failed} de ${summary.succeeded + summary.failed} execução(ões) terminais falharam.`,
      };
    }
    return {
      ...base,
      status: 'ok',
      headline: 'Automações funcionando',
      detail: `${summary.succeeded} execução(ões) concluída(s) com sucesso no período.`,
    };
  }

  private buildPriorities(
    operational: Awaited<
      ReturnType<LeadFlowOperationalAnalyticsService['getOverview']>
    >,
    connectionState: ReturnType<typeof resolveScopedConnectionState>,
    hasScopedChannel: boolean,
    context: LeadFlowOverviewOperatingContext,
    capacity: Awaited<
      ReturnType<LeadFlowClientSettingsService['getCapacity']>
    > | null,
  ): LeadFlowOverviewPriority[] {
    const priorities: LeadFlowOverviewPriority[] = [];
    const channelSource = 'GET /inbox/channels/whatsapp/status';

    if (!hasScopedChannel) {
      priorities.push({
        key: 'whatsapp_not_configured',
        severity: 'critical',
        title: 'WhatsApp não configurado',
        detail: 'Este contexto ainda não tem um canal do WhatsApp conectado.',
        source: channelSource,
        deepLink: '/leadflow/channels/whatsapp',
      });
    } else if (
      connectionState === 'not_connected' ||
      connectionState === 'failed'
    ) {
      priorities.push({
        key: 'whatsapp_disconnected',
        severity: 'critical',
        title: 'WhatsApp desconectado',
        detail: 'O canal do WhatsApp está desconectado ou com falha.',
        source: channelSource,
        deepLink: '/leadflow/channels/whatsapp',
      });
    } else if (
      connectionState === 'needs_action' ||
      connectionState === 'connecting'
    ) {
      priorities.push({
        key: 'whatsapp_needs_action',
        severity: 'warning',
        title: 'WhatsApp precisa de atenção',
        detail: 'A configuração do canal do WhatsApp ainda não foi concluída.',
        source: channelSource,
        deepLink: '/leadflow/channels/whatsapp',
      });
    }

    const { failed, succeeded } = operational.automations.summary;
    if (failed > 0 && succeeded === 0) {
      priorities.push({
        key: 'automations_failing',
        severity: 'critical',
        title: 'Automações falhando',
        detail: `${failed} execução(ões) falharam e nenhuma teve sucesso no período.`,
        source:
          'GET /leadflow/analytics/operational-overview (automations.summary)',
        deepLink: '/leadflow/automations',
      });
    } else if (failed > 0) {
      priorities.push({
        key: 'automations_partial_failures',
        severity: 'warning',
        title: 'Automações com falhas',
        detail: `${failed} execução(ões) falharam no período.`,
        source:
          'GET /leadflow/analytics/operational-overview (automations.summary)',
        deepLink: '/leadflow/automations',
      });
    }

    if (
      context.operatingMode === 'agency' &&
      capacity &&
      capacity.limit !== null &&
      capacity.availableSlots === 0
    ) {
      priorities.push({
        key: 'company_capacity_full',
        severity: 'warning',
        title: 'Sem vagas disponíveis para novas empresas',
        detail: `${capacity.activeCompanies} de ${capacity.limit} empresa(s) ativa(s) — nenhuma vaga livre.`,
        source: 'GET /leadflow/clients/capacity',
        deepLink: '/leadflow/settings',
      });
    }

    const { hotTransitions } = operational.leadScore.summary;
    if (hotTransitions > 0) {
      priorities.push({
        key: 'hot_leads',
        severity: 'info',
        title: `${hotTransitions} lead(s) ficaram quentes`,
        detail:
          'Oportunidades entraram na faixa quente do lead score no período.',
        source:
          'GET /leadflow/analytics/operational-overview (leadScore.summary)',
        deepLink: '/leadflow/crm',
      });
    }

    return priorities;
  }

  private resolveContext(
    ctx: RequestContext,
  ): LeadFlowOverviewOperatingContext {
    if (ctx.managedContext?.operatingMode === 'client') {
      if (!ctx.managedContext.clientId) {
        throw new BadRequestException('Client context is required.');
      }
      return { operatingMode: 'client', clientId: ctx.managedContext.clientId };
    }
    return { operatingMode: 'agency', clientId: null };
  }

  private requireTenantId(ctx: RequestContext): string {
    if (!ctx.tenantId) {
      throw new BadRequestException('Tenant context is required.');
    }
    return ctx.tenantId;
  }

  private requireWorkspaceId(ctx: RequestContext): string {
    if (!ctx.workspaceId) {
      throw new BadRequestException('Workspace context is required.');
    }
    return ctx.workspaceId;
  }

  private resolvePeriod(query: GetLeadFlowOverviewDto) {
    const now = new Date();
    const to = query.to ? new Date(query.to) : now;
    const from = query.from
      ? new Date(query.from)
      : new Date(to.getTime() - DEFAULT_WINDOW_DAYS * 86_400_000);

    if (
      Number.isNaN(from.getTime()) ||
      Number.isNaN(to.getTime()) ||
      from.getTime() > to.getTime()
    ) {
      throw new BadRequestException('The overview period is invalid.');
    }
    if (to.getTime() > now.getTime() + 5 * 60 * 1000) {
      throw new BadRequestException(
        'The overview period cannot end in the future.',
      );
    }
    if (differenceInDays(from, to) > MAX_WINDOW_DAYS) {
      throw new BadRequestException(
        `The overview period cannot exceed ${MAX_WINDOW_DAYS} days. Use /leadflow/analytics for longer ranges.`,
      );
    }

    return { from, to };
  }
}

function differenceInDays(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

function isChannelForContext(
  channel: WhatsAppMappedChannel,
  context: LeadFlowOverviewOperatingContext,
): boolean {
  const metadata = channel.metadata ?? {};
  const operatingMode =
    metadata.operatingMode === 'client' ? 'client' : 'agency';

  if (context.operatingMode === 'client') {
    return operatingMode === 'client' && metadata.clientId === context.clientId;
  }
  return operatingMode === 'agency';
}

/**
 * Mirrors WhatsAppChannelHealthService.resolveWorkspaceState's "best of"
 * ranking, applied only to the channels scoped to this context — that
 * service itself is tenant/workspace-scoped only (no client filtering), so
 * we cannot reuse it directly for a per-client Overview.
 */
function resolveScopedConnectionState(
  channels: WhatsAppMappedChannel[],
): WhatsAppMappedChannel['state'] {
  const states = channels.map((channel) => channel.state);
  if (states.includes('connected')) return 'connected';
  if (states.includes('connecting')) return 'connecting';
  if (states.includes('failed')) return 'failed';
  if (states.includes('needs_action')) return 'needs_action';
  return 'not_connected';
}
