import type { LeadFlowAnalyticsReportType } from '../dto/create-analytics-report.dto';
import type { CommercialJourneyAnalytics } from '../types/commercial-journey-analytics.types';
import type { OperationalAnalytics } from '../types/operational-analytics.types';

type ReportRenderInput = {
  reportType: LeadFlowAnalyticsReportType;
  reportTypes?: LeadFlowAnalyticsReportType[];
  title?: string;
  commercial: CommercialJourneyAnalytics | null;
  operational: OperationalAnalytics | null;
  generatedAt: Date;
};

const REPORT_LABELS: Record<LeadFlowAnalyticsReportType, string> = {
  overview: 'Visão executiva',
  commercial: 'Jornada comercial',
  messages: 'Conversas e atendimento',
  lead_score: 'Lead Score',
  automations: 'Automações',
};

export function buildLeadFlowAnalyticsReportHtml(
  input: ReportRenderInput,
): string {
  const period = input.commercial?.period ?? input.operational?.period;
  if (!period) {
    throw new Error('Analytics report requires at least one data source.');
  }

  const title =
    input.title?.trim() || `LeadFlow · ${REPORT_LABELS[input.reportType]}`;
  const reportTypes = new Set(
    input.reportTypes?.length ? input.reportTypes : [input.reportType],
  );
  const sections = [
    reportTypes.has('overview')
      ? renderExecutiveOverview(input.commercial, input.operational)
      : '',
    input.commercial &&
    (reportTypes.has('overview') || reportTypes.has('commercial'))
      ? renderCommercial(input.commercial)
      : '',
    input.operational &&
    (reportTypes.has('overview') || reportTypes.has('messages'))
      ? renderMessages(input.operational)
      : '',
    input.operational &&
    (reportTypes.has('overview') || reportTypes.has('lead_score'))
      ? renderLeadScore(input.operational)
      : '',
    input.operational &&
    (reportTypes.has('overview') || reportTypes.has('automations'))
      ? renderAutomations(input.operational)
      : '',
    renderDataQuality(input.commercial, input.operational),
  ].filter(Boolean);

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: light; font-family: Inter, Arial, sans-serif; color: #172033; }
      * { box-sizing: border-box; }
      body { margin: 0; font-size: 10px; line-height: 1.45; background: #fff; }
      header.report-header { padding: 20px 22px 16px; border-radius: 14px; background: #172554; color: #fff; }
      header.report-header span { display: block; color: #bfdbfe; font-size: 9px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
      header.report-header h1 { margin: 5px 0 3px; font-size: 23px; line-height: 1.15; }
      header.report-header p { margin: 0; color: #dbeafe; }
      .meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 12px 0 0; }
      .meta div { padding: 8px 10px; border: 1px solid #dfe4ec; border-radius: 9px; background: #f8fafc; }
      .meta span, .metric span { display: block; color: #667085; font-size: 8px; font-weight: 700; text-transform: uppercase; }
      .meta strong { display: block; margin-top: 2px; }
      section { margin-top: 16px; break-inside: auto; }
      section > h2 { margin: 0 0 3px; color: #172554; font-size: 16px; }
      section > p { margin: 0 0 9px; color: #667085; }
      .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; }
      .metric { min-height: 58px; padding: 9px; border: 1px solid #dfe4ec; border-radius: 9px; break-inside: avoid; }
      .metric strong { display: block; margin-top: 4px; font-size: 17px; line-height: 1.1; }
      .metric small { display: block; margin-top: 4px; color: #667085; }
      table { width: 100%; margin-top: 8px; border-collapse: collapse; font-size: 8.5px; break-inside: auto; }
      thead { display: table-header-group; }
      tr { break-inside: avoid; }
      th, td { padding: 6px 7px; border-bottom: 1px solid #e5e7eb; text-align: right; vertical-align: top; }
      th { color: #475467; background: #f1f5f9; font-size: 8px; text-transform: uppercase; }
      th:first-child, td:first-child { text-align: left; }
      .note { margin-top: 8px; padding: 8px 10px; border-left: 3px solid #2563eb; background: #eff6ff; color: #334155; }
      .quality { padding: 10px 12px; border: 1px solid #dfe4ec; border-radius: 9px; background: #f8fafc; }
      .quality ul { margin: 5px 0 0; padding-left: 16px; }
      footer { margin-top: 18px; padding-top: 8px; border-top: 1px solid #dfe4ec; color: #667085; font-size: 8px; }
      @page { size: A4; margin: 11mm; }
    </style>
  </head>
  <body>
    <header class="report-header">
      <span>Lyra LeadFlow · relatório operacional</span>
      <h1>${escapeHtml(title)}</h1>
      <p>Dados canônicos do CRM, Inbox, Lead Score e execuções de automação.</p>
    </header>
    <div class="meta">
      <div><span>Relatório</span><strong>${escapeHtml(
        reportTypes.size > 1
          ? 'Visões selecionadas'
          : REPORT_LABELS[input.reportType],
      )}</strong></div>
      <div><span>Período</span><strong>${formatDate(period.from)} — ${formatDate(period.to)}</strong></div>
      <div><span>Gerado em</span><strong>${formatDateTime(input.generatedAt.toISOString())}</strong></div>
    </div>
    ${sections.join('\n')}
    <footer>
      O relatório não contém conteúdo de mensagens, anexos ou payloads de provider. Métricas são calculadas
      query-time e respeitam o tenant, workspace e contexto operacional ativos.
    </footer>
  </body>
</html>`;
}

function renderExecutiveOverview(
  commercial: CommercialJourneyAnalytics | null,
  operational: OperationalAnalytics | null,
) {
  if (!commercial || !operational) return '';
  const commercialSummary = commercial.summary;
  const messages = operational.messages.summary;
  const scores = operational.leadScore.summary;
  const automations = operational.automations.summary;

  return section(
    'Resumo executivo',
    'Indicadores centrais do período selecionado.',
    metrics([
      [
        'Oportunidades',
        number(commercialSummary.opportunities),
        `${commercialSummary.open} abertas`,
      ],
      [
        'Conversão',
        percent(commercialSummary.winRate),
        `${commercialSummary.won} ganhos`,
      ],
      ['Mensagens', number(messages.total), `${messages.inbound} recebidas`],
      [
        'Primeira resposta',
        duration(messages.averageFirstResponseSeconds),
        percent(messages.firstResponseRate),
      ],
      [
        'Lead Score médio',
        decimal(scores.averageScore),
        `${scores.hotTransitions} aqueceram`,
      ],
      [
        'Runs produtivas',
        number(automations.live),
        `${automations.confirmedEffects} efeitos`,
      ],
      [
        'Falhas de automação',
        number(automations.failed),
        `${automations.failedAttempts} tentativas`,
      ],
      [
        'Influência da IA',
        percent(commercialSummary.aiInfluenceRate),
        `${commercialSummary.aiInfluencedWins} ganhos`,
      ],
    ]),
  );
}

function renderCommercial(report: CommercialJourneyAnalytics) {
  const summary = report.summary;
  const wonValue = report.wonValueByCurrency.length
    ? report.wonValueByCurrency
        .map((item) => currency(item.amount, item.currency))
        .join(' · ')
    : 'R$ 0,00';

  return section(
    'Jornada comercial',
    'A coorte usa a criação da oportunidade e preserva transferências entre pipelines.',
    `${metrics([
      [
        'Oportunidades',
        number(summary.opportunities),
        `${summary.open} abertas`,
      ],
      ['Conversão', percent(summary.winRate), `${summary.won} ganhos`],
      [
        'Handoff',
        percent(summary.handoffRate),
        `${summary.handoffAccepted} aceitos`,
      ],
      ['Valor ganho', wonValue, 'Sem soma cambial'],
    ])}
    ${table(
      ['Pipeline', 'Coorte', 'Visitas', 'Ganhos', 'Abertas', 'Tempo médio'],
      report.pipelines.map((item) => [
        item.name,
        item.cohortEntries,
        item.entries,
        item.wins,
        item.openAtEnd,
        duration(item.averageTimeSeconds),
      ]),
    )}
    ${table(
      [
        'Estágio',
        'Entradas',
        'Oportunidades',
        'Ganhos',
        'Perdas',
        'Tempo médio',
      ],
      report.stages.map((item) => [
        item.name,
        item.entries,
        item.uniqueOpportunities,
        item.wins,
        item.losses,
        duration(item.averageTimeSeconds),
      ]),
    )}`,
  );
}

function renderMessages(report: OperationalAnalytics) {
  const summary = report.messages.summary;
  return section(
    'Conversas e atendimento',
    'Tempos e volumes usam somente direção, remetente, status e timestamps estruturados.',
    `${metrics([
      ['Mensagens', number(summary.total), `${summary.inbound} recebidas`],
      [
        'Primeira resposta',
        duration(summary.averageFirstResponseSeconds),
        percent(summary.firstResponseRate),
      ],
      [
        'Resposta média',
        duration(summary.averageResponseSeconds),
        `${summary.respondedConversations} conversas`,
      ],
      [
        'Respostas após IA',
        number(summary.leadRepliesAfterFirstAgentReply),
        `${summary.automatedOutbound} envios de agentes`,
      ],
    ])}
    ${table(
      ['Canal', 'Recebidas', 'Enviadas', 'Conversas', 'Resposta média'],
      report.messages.byChannel.map((item) => [
        `${item.name} · ${item.type}`,
        item.inbound,
        item.outbound,
        item.conversations,
        duration(item.averageResponseSeconds),
      ]),
    )}
    ${table(
      [
        'Agente',
        'Enviadas',
        'Conversas',
        'Resposta média',
        'Leads que responderam',
      ],
      report.messages.byAgent.map((item) => [
        item.name,
        item.outbound,
        item.conversations,
        duration(item.averageResponseSeconds),
        item.leadRepliesAfterFirstReply,
      ]),
    )}`,
  );
}

function renderLeadScore(report: OperationalAnalytics) {
  const summary = report.leadScore.summary;
  return section(
    'Lead Score',
    'Distribuição baseada no último cálculo de cada oportunidade dentro do período.',
    `${metrics([
      [
        'Score médio',
        decimal(summary.averageScore),
        `${summary.opportunities} oportunidades`,
      ],
      [
        'Atingimento médio',
        percent(summary.averageAttainmentRate),
        'Score / máximo atingível',
      ],
      [
        'Delta médio',
        signedDecimal(summary.averageDelta),
        `${summary.calculations} cálculos`,
      ],
      [
        'Transições para quente',
        number(summary.hotTransitions),
        'Cruzamentos de faixa',
      ],
    ])}
    ${table(
      ['Faixa', 'Oportunidades', 'Participação'],
      report.leadScore.distribution.map((item) => [
        scoreBand(item.band),
        item.opportunities,
        percent(item.share),
      ]),
    )}
    ${table(
      ['Política', 'Cálculos', 'Oportunidades'],
      report.leadScore.policyVersions.map((item) => [
        item.policyVersion,
        item.calculations,
        item.opportunities,
      ]),
    )}`,
  );
}

function renderAutomations(report: OperationalAnalytics) {
  const summary = report.automations.summary;
  const ignoredFilters =
    report.dataQuality.filtersNotApplicableToAutomationRuns.length > 0
      ? `<div class="note">Canal e agente não filtram runs sem dimensão canônica; Business Mode continua aplicado.</div>`
      : '';

  return section(
    'Automações',
    'Runs live, shadow e dry-run permanecem separadas; skips corretos não contam como falha.',
    `${metrics([
      ['Runs', number(summary.runs), `${summary.live} produtivas`],
      [
        'Taxa de sucesso',
        percent(summary.successRate),
        'Skips fora do denominador',
      ],
      [
        'Efeitos confirmados',
        number(summary.confirmedEffects),
        `${summary.succeeded} concluídas`,
      ],
      [
        'Falhas',
        number(summary.failed),
        `${summary.failedAttempts} tentativas`,
      ],
    ])}
    ${ignoredFilters}
    ${table(
      [
        'Automação',
        'Business Mode',
        'Runs',
        'Live',
        'Sucesso',
        'Ignoradas',
        'Falhas',
        'Taxa',
      ],
      report.automations.byRecipe.map((item) => [
        `${item.name} · ${item.recipeKey}`,
        businessMode(item.businessMode),
        item.runs,
        item.live,
        item.succeeded,
        item.skipped,
        item.failed,
        percent(item.successRate),
      ]),
    )}
    ${table(
      [
        'Run recente',
        'Modo',
        'Status',
        'Efeitos',
        'Falhas',
        'Duração',
        'Início',
      ],
      report.automations.recentRuns.map((item) => [
        item.automationName,
        runMode(item.mode),
        runStatus(item.status),
        item.confirmedEffects,
        item.failedAttempts,
        item.durationMs === null ? '—' : milliseconds(item.durationMs),
        formatDateTime(item.createdAt),
      ]),
    )}`,
  );
}

function renderDataQuality(
  commercial: CommercialJourneyAnalytics | null,
  operational: OperationalAnalytics | null,
) {
  const notes: string[] = [];
  if (commercial) {
    notes.push(
      `${commercial.dataQuality.missingCreationFacts} oportunidades sem fato de criação; ` +
        `${commercial.dataQuality.legacyJourneyFallbacks} fallbacks legados.`,
    );
  }
  if (operational) {
    notes.push(
      `${operational.dataQuality.messageFacts} fatos de mensagem, ` +
        `${operational.dataQuality.scoreFacts} fatos de score e ` +
        `${operational.dataQuality.runFacts} runs processadas.`,
    );
    notes.push(
      'Dimensões históricas usam o contexto canônico atual do agregado, conforme declarado pela API.',
    );
  }

  return section(
    'Qualidade e atribuição',
    'Notas necessárias para interpretar o relatório.',
    `<div class="quality"><ul>${notes
      .map((note) => `<li>${escapeHtml(note)}</li>`)
      .join('')}</ul></div>`,
  );
}

function section(title: string, description: string, content: string) {
  return `<section><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p>${content}</section>`;
}

function metrics(items: Array<[string, string, string]>) {
  return `<div class="metrics">${items
    .map(
      ([label, value, detail]) =>
        `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></div>`,
    )
    .join('')}</div>`;
}

function table(headers: string[], rows: Array<Array<string | number>>) {
  const body = rows.length
    ? rows
        .map(
          (row) =>
            `<tr>${row
              .map((value) => `<td>${escapeHtml(String(value))}</td>`)
              .join('')}</tr>`,
        )
        .join('')
    : `<tr><td colspan="${headers.length}">Nenhum fato encontrado.</td></tr>`;
  return `<table><thead><tr>${headers
    .map((header) => `<th>${escapeHtml(header)}</th>`)
    .join('')}</tr></thead><tbody>${body}</tbody></table>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function number(value: number) {
  return new Intl.NumberFormat('pt-BR').format(value);
}

function decimal(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    maximumFractionDigits: 1,
  }).format(value);
}

function signedDecimal(value: number) {
  const formatted = decimal(Math.abs(value));
  return value > 0 ? `+${formatted}` : value < 0 ? `-${formatted}` : formatted;
}

function percent(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(value);
}

function currency(value: string, currencyCode: string) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: currencyCode,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

function duration(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}min`;
  if (seconds < 86_400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86_400).toFixed(1)}d`;
}

function milliseconds(value: number) {
  return value < 1000
    ? `${Math.round(value)}ms`
    : `${(value / 1000).toFixed(1)}s`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(
    new Date(value),
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));
}

function scoreBand(value: string) {
  if (value === 'cold') return 'Frio';
  if (value === 'warm') return 'Morno';
  if (value === 'hot') return 'Quente';
  return value;
}

function businessMode(value: string) {
  return value
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function runMode(value: string) {
  if (value === 'live') return 'Produtivo';
  if (value === 'shadow') return 'Shadow';
  if (value === 'dry_run') return 'Simulação';
  return value;
}

function runStatus(value: string) {
  if (value === 'succeeded') return 'Concluída';
  if (value === 'skipped') return 'Ignorada';
  if (value === 'failed') return 'Falhou';
  if (value === 'cancelled') return 'Cancelada';
  if (value === 'running') return 'Em execução';
  return 'Pendente';
}
