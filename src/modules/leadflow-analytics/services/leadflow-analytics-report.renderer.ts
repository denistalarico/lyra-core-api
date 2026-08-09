import type { LeadFlowAnalyticsReportType } from '../dto/create-analytics-report.dto';
import type { CommercialJourneyAnalytics } from '../types/commercial-journey-analytics.types';
import type { OperationalAnalytics } from '../types/operational-analytics.types';

type ReportRenderInput = {
  reportType: LeadFlowAnalyticsReportType;
  reportTypes?: LeadFlowAnalyticsReportType[];
  summaryTypes?: string[];
  sectionIds?: string[];
  chartModes?: Record<string, string>;
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
  const hasExplicitSections = Boolean(input.sectionIds?.length);
  const sectionIds = new Set(input.sectionIds ?? []);
  const includeSection = (id: string, fallback: boolean) =>
    hasExplicitSections ? sectionIds.has(id) : fallback;
  const summaryTypes = input.summaryTypes?.length
    ? input.summaryTypes
    : reportTypes.has('overview')
      ? ['executive']
      : Array.from(reportTypes).map((type) =>
          type === 'messages'
            ? 'service'
            : type === 'automations'
              ? 'automation'
              : type === 'commercial'
                ? 'commercial'
                : 'executive',
        );
  const sections = [
    ...summaryTypes.map((type) =>
      renderSummary(type, input.commercial, input.operational),
    ),
    input.commercial &&
    includeSection(
      'commercial_performance',
      reportTypes.has('overview') || reportTypes.has('commercial'),
    )
      ? renderCommercial(input.commercial, input.chartModes)
      : '',
    input.operational &&
    includeSection(
      'service_performance',
      reportTypes.has('overview') || reportTypes.has('messages'),
    )
      ? renderMessages(input.operational, input.chartModes)
      : '',
    input.operational &&
    includeSection(
      'lead_quality',
      reportTypes.has('overview') || reportTypes.has('lead_score'),
    )
      ? renderLeadScore(input.operational, input.chartModes)
      : '',
    input.operational &&
    includeSection(
      'automation_performance',
      reportTypes.has('overview') || reportTypes.has('automations'),
    )
      ? renderAutomations(input.operational, input.chartModes)
      : '',
    includeSection('data_quality', true)
      ? renderDataQuality(input.commercial, input.operational)
      : '',
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
      .chart { margin-top: 10px; padding: 10px 0 12px; border-top: 1px solid #dfe4ec; break-inside: avoid; }
      .chart h3 { margin: 0 0 2px; font-size: 12px; }
      .chart > p { margin: 0 0 8px; color: #667085; font-size: 8px; }
      .hbars { display: grid; gap: 6px; }
      .hbar { display: grid; grid-template-columns: 120px 1fr 42px; align-items: center; gap: 7px; }
      .hbar > span { overflow: hidden; color: #475467; white-space: nowrap; text-overflow: ellipsis; }
      .hbar-track { height: 10px; overflow: hidden; border-radius: 3px; background: #eef2f6; }
      .hbar-fill { height: 100%; background: #2563eb; }
      .hbar strong { text-align: right; }
      .vbars { display: flex; align-items: end; gap: 7px; height: 132px; padding-top: 8px; border-bottom: 1px solid #94a3b8; }
      .vbar { display: grid; grid-template-rows: 1fr auto; align-items: end; min-width: 0; flex: 1; height: 100%; text-align: center; }
      .vbar-fill { min-height: 2px; background: #2563eb; border-radius: 3px 3px 0 0; }
      .vbar span { overflow: hidden; padding-top: 4px; color: #667085; font-size: 7px; white-space: nowrap; text-overflow: ellipsis; }
      .pie-layout { display: flex; align-items: center; gap: 18px; }
      .pie { width: 118px; height: 118px; flex: 0 0 auto; border-radius: 50%; }
      .pie-legend { display: grid; gap: 5px; }
      .pie-legend div { display: grid; grid-template-columns: 8px 1fr auto; align-items: center; gap: 6px; }
      .pie-legend i { width: 8px; height: 8px; border-radius: 2px; }
      .line-chart { width: 100%; height: 145px; }
      .line-chart text { fill: #667085; font-size: 7px; }
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

function renderSummary(
  type: string,
  commercial: CommercialJourneyAnalytics | null,
  operational: OperationalAnalytics | null,
) {
  if (type === 'executive') {
    return renderExecutiveOverview(commercial, operational);
  }
  if (type === 'service' && operational) {
    const summary = operational.messages.summary;
    return section(
      'Resumo Atendimento',
      'Velocidade e volume das conversas no período.',
      metrics([
        ['Conversas', number(summary.conversations), 'No período'],
        [
          'Primeira resposta',
          duration(summary.averageFirstResponseSeconds),
          percent(summary.firstResponseRate),
        ],
        ['Mensagens', number(summary.total), `${summary.inbound} recebidas`],
        [
          'Respostas após IA',
          number(summary.leadRepliesAfterFirstAgentReply),
          `${summary.automatedOutbound} envios de agentes`,
        ],
      ]),
    );
  }
  if (type === 'automation' && operational) {
    const summary = operational.automations.summary;
    return section(
      'Resumo Automação',
      'Execuções e efeitos confirmados no período.',
      metrics([
        ['Execuções', number(summary.runs), `${summary.live} produtivas`],
        [
          'Sucesso',
          percent(summary.successRate),
          `${summary.succeeded} concluídas`,
        ],
        [
          'Efeitos confirmados',
          number(summary.confirmedEffects),
          'Ações realizadas',
        ],
        [
          'Falhas',
          number(summary.failed),
          `${summary.failedAttempts} tentativas`,
        ],
      ]),
    );
  }
  if (type === 'commercial' && commercial) {
    const summary = commercial.summary;
    return section(
      'Resumo Comercial',
      'Conversão e influência da IA no período.',
      metrics([
        [
          'Oportunidades',
          number(summary.opportunities),
          `${summary.open} abertas`,
        ],
        ['Conversão', percent(summary.winRate), `${summary.won} ganhos`],
        [
          'Influência da IA',
          percent(summary.aiInfluenceRate),
          `${summary.aiInfluencedWins} ganhos`,
        ],
        [
          'Handoffs aceitos',
          number(summary.handoffAccepted),
          `${summary.handoffRequested} solicitados`,
        ],
      ]),
    );
  }
  return '';
}

function renderCommercial(
  report: CommercialJourneyAnalytics,
  chartModes: Record<string, string> = {},
) {
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
    ${chart(
      'Oportunidades por estágio',
      report.stages.slice(0, 12).map((item) => ({
        label: item.name,
        value: item.uniqueOpportunities,
      })),
      chartModes.commercial_stages,
    )}
    ${chart(
      'Funil de handoff',
      [
        { label: 'Solicitados', value: summary.handoffRequested },
        { label: 'Aceitos', value: summary.handoffAccepted },
        { label: 'Concluídos', value: summary.handoffTransferCompleted },
      ],
      chartModes.commercial_handoff,
    )}
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

function renderMessages(
  report: OperationalAnalytics,
  chartModes: Record<string, string> = {},
) {
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
    ${chart(
      'Mensagens por canal',
      report.messages.byChannel.slice(0, 12).map((item) => ({
        label: item.name,
        value: item.inbound + item.outbound,
      })),
      chartModes.message_channels,
    )}
    ${chart(
      'Atuação dos agentes de IA',
      report.messages.byAgent.slice(0, 12).map((item) => ({
        label: item.name,
        value: item.outbound,
      })),
      chartModes.agent_performance,
    )}
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

function renderLeadScore(
  report: OperationalAnalytics,
  chartModes: Record<string, string> = {},
) {
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
    ${chart(
      'Distribuição do Lead Score',
      report.leadScore.distribution.map((item) => ({
        label: scoreBand(item.band),
        value: item.opportunities,
      })),
      chartModes.lead_score_distribution,
    )}
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

function renderAutomations(
  report: OperationalAnalytics,
  chartModes: Record<string, string> = {},
) {
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
    ${chart(
      'Desfechos por automação',
      report.automations.byRecipe.slice(0, 12).map((item) => ({
        label: item.name,
        value: item.runs,
      })),
      chartModes.automation_outcomes,
    )}
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

function chart(
  title: string,
  items: Array<{ label: string; value: number }>,
  requestedMode = 'horizontal_bar',
) {
  const data = items.filter((item) => Number.isFinite(item.value));
  if (!data.length) return '';
  const mode = [
    'horizontal_bar',
    'vertical_bar',
    'pie',
    'line',
    'area',
  ].includes(requestedMode)
    ? requestedMode
    : 'horizontal_bar';
  const max = Math.max(...data.map((item) => item.value), 1);
  const description =
    mode === 'pie'
      ? 'Participação no total.'
      : mode === 'line' || mode === 'area'
        ? 'Progressão na ordem apresentada.'
        : 'Comparação em valores absolutos.';

  if (mode === 'pie') {
    const palette = ['#2563eb', '#b45309', '#7c3aed', '#94a3b8', '#64748b'];
    const total = Math.max(
      data.reduce((sum, item) => sum + item.value, 0),
      1,
    );
    let cursor = 0;
    const stops = data.map((item, index) => {
      const start = cursor;
      cursor += (item.value / total) * 100;
      return `${palette[index % palette.length]} ${start}% ${cursor}%`;
    });
    return `<div class="chart"><h3>${escapeHtml(title)}</h3><p>${description}</p><div class="pie-layout"><div class="pie" style="background:conic-gradient(${stops.join(',')})"></div><div class="pie-legend">${data
      .map(
        (item, index) =>
          `<div><i style="background:${palette[index % palette.length]}"></i><span>${escapeHtml(item.label)}</span><strong>${number(item.value)}</strong></div>`,
      )
      .join('')}</div></div></div>`;
  }

  if (mode === 'vertical_bar') {
    return `<div class="chart"><h3>${escapeHtml(title)}</h3><p>${description}</p><div class="vbars">${data
      .map(
        (item) =>
          `<div class="vbar"><div class="vbar-fill" title="${escapeHtml(item.label)}: ${item.value}" style="height:${Math.max(2, (item.value / max) * 100)}%"></div><span>${escapeHtml(item.label)}</span></div>`,
      )
      .join('')}</div></div>`;
  }

  if (mode === 'line' || mode === 'area') {
    const width = 720;
    const height = 116;
    const step = data.length > 1 ? width / (data.length - 1) : width / 2;
    const points = data.map((item, index) => ({
      x: data.length > 1 ? index * step : width / 2,
      y: height - (item.value / max) * (height - 16),
      ...item,
    }));
    const polyline = points.map((point) => `${point.x},${point.y}`).join(' ');
    const areaPoints = `0,${height} ${polyline} ${width},${height}`;
    return `<div class="chart"><h3>${escapeHtml(title)}</h3><p>${description}</p><svg class="line-chart" viewBox="0 0 ${width} 145" role="img" aria-label="${escapeHtml(title)}">${
      mode === 'area'
        ? `<polygon points="${areaPoints}" fill="#2563eb" fill-opacity=".14"></polygon>`
        : ''
    }<polyline points="${polyline}" fill="none" stroke="#2563eb" stroke-width="3"></polyline>${points
      .map(
        (point) =>
          `<circle cx="${point.x}" cy="${point.y}" r="4" fill="#2563eb"></circle><text x="${point.x}" y="138" text-anchor="middle">${escapeHtml(point.label.slice(0, 18))}</text>`,
      )
      .join('')}</svg></div>`;
  }

  return `<div class="chart"><h3>${escapeHtml(title)}</h3><p>${description}</p><div class="hbars">${data
    .map(
      (item) =>
        `<div class="hbar"><span>${escapeHtml(item.label)}</span><div class="hbar-track"><div class="hbar-fill" style="width:${(item.value / max) * 100}%"></div></div><strong>${number(item.value)}</strong></div>`,
    )
    .join('')}</div></div>`;
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
