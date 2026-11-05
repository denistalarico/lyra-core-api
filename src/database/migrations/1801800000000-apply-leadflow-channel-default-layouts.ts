import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * LF-DEF1: apply the matching sections of the production Visão Geral snapshot
 * to the four fixed LeadFlow channel dashboards.
 *
 * The sections are embedded so this migration remains immutable if product
 * defaults change later. Existing layouts are backed up once and restored by
 * down(); custom dashboards and Visão Geral are never overwritten.
 */
const CHANNEL_SECTIONS: Record<string, unknown> = {
  service: {
    id: 'section-service',
    cards: [
      {
        id: 'messages.conversations',
        kind: 'kpi',
        size: {
          h: 1,
          w: 2,
        },
        title: 'Conversas',
        metric: 'messages.conversations',
        gridRow: 0,
        gridColumn: 0,
        description: null,
        highlighted: true,
      },
      {
        id: 'messages.inboundConversations',
        kind: 'kpi',
        size: {
          h: 1,
          w: 2,
        },
        title: 'Conversas recebidas',
        metric: 'messages.inboundConversations',
        gridRow: 0,
        gridColumn: 4,
        description: null,
      },
      {
        id: 'messages.respondedConversations',
        kind: 'kpi',
        size: {
          h: 1,
          w: 2,
        },
        title: 'Conversas respondidas',
        metric: 'messages.respondedConversations',
        gridRow: 0,
        gridColumn: 2,
        description: null,
      },
      {
        id: 'messages.averageFirstResponseSeconds',
        kind: 'kpi',
        size: {
          h: 1,
          w: 2,
        },
        title: 'Tempo de primeira resposta',
        metric: 'messages.averageFirstResponseSeconds',
        gridRow: 0,
        gridColumn: 6,
        description: null,
        highlighted: true,
      },
      {
        id: 'messages.averageResponseSeconds',
        kind: 'kpi',
        size: {
          h: 1,
          w: 2,
        },
        title: 'Tempo médio de resposta',
        metric: 'messages.averageResponseSeconds',
        gridRow: 0,
        gridColumn: 8,
        description: null,
        highlighted: true,
      },
      {
        id: 'messages.total',
        kind: 'kpi',
        size: {
          h: 1,
          w: 2,
        },
        title: 'Mensagens',
        metric: 'messages.total',
        gridRow: 1,
        gridColumn: 0,
        description: null,
      },
      {
        id: 'messages.outbound',
        kind: 'kpi',
        size: {
          h: 1,
          w: 2,
        },
        title: 'Mensagens enviadas',
        metric: 'messages.outbound',
        gridRow: 1,
        gridColumn: 2,
        description: null,
      },
      {
        id: 'messages.inbound',
        kind: 'kpi',
        size: {
          h: 1,
          w: 2,
        },
        title: 'Mensagens recebidas',
        metric: 'messages.inbound',
        gridRow: 1,
        gridColumn: 4,
        description: null,
      },
      {
        id: 'messages.firstResponseRate',
        kind: 'kpi',
        size: {
          h: 1,
          w: 2,
        },
        title: 'Taxa de primeira resposta',
        metric: 'messages.firstResponseRate',
        gridRow: 1,
        gridColumn: 6,
        description: null,
      },
      {
        id: 'messages.leadRepliesAfterFirstAgentReply',
        kind: 'kpi',
        size: {
          h: 1,
          w: 2,
        },
        title: 'Respostas do lead após a primeira resposta',
        metric: 'messages.leadRepliesAfterFirstAgentReply',
        gridRow: 1,
        gridColumn: 8,
        description: null,
      },
      {
        id: 'messages.channels',
        kind: 'table',
        size: {
          h: 5,
          w: 6,
        },
        title: 'Por canal',
        source: 'messages.channels',
        compact: true,
        gridRow: 2,
        gridColumn: 0,
        description: null,
      },
      {
        id: 'messages.composition',
        kind: 'breakdown',
        size: {
          h: 5,
          w: 4,
        },
        title: 'Composição de mensagens',
        metric: 'messages.composition',
        render: 'chart',
        gridRow: 2,
        gridColumn: 6,
        description: null,
      },
      {
        id: 'messages.agents',
        kind: 'table',
        size: {
          h: 5,
          w: 6,
        },
        title: 'Por agente',
        source: 'messages.agents',
        compact: true,
        gridRow: 4,
        gridColumn: 0,
        description: null,
      },
      {
        id: 'messages.humanOutbound',
        kind: 'kpi',
        size: {
          h: 1,
          w: 2,
        },
        title: 'Saídas humanas',
        metric: 'messages.humanOutbound',
        gridRow: 6,
        gridColumn: 0,
        description: null,
        highlighted: true,
      },
      {
        id: 'messages.automatedOutbound',
        kind: 'kpi',
        size: {
          h: 1,
          w: 2,
        },
        title: 'Saídas automatizadas',
        metric: 'messages.automatedOutbound',
        gridRow: 6,
        gridColumn: 2,
        description: null,
        highlighted: true,
      },
      {
        id: 'messages.failedOutbound',
        kind: 'kpi',
        size: {
          h: 1,
          w: 2,
        },
        title: 'Saídas com falha',
        metric: 'messages.failedOutbound',
        gridRow: 6,
        gridColumn: 4,
        description: null,
        highlighted: true,
      },
      {
        id: 'timeseries.messages_inbound',
        kind: 'chart',
        size: {
          h: 4,
          w: 5,
        },
        title: 'Mensagens recebidas por dia',
        gridRow: 7,
        chartType: 'line',
        metricIds: ['timeseries.messages_inbound'],
        gridColumn: 0,
        description: null,
      },
      {
        id: 'timeseries.conversations',
        kind: 'chart',
        size: {
          h: 4,
          w: 5,
        },
        title: 'Conversas por dia',
        gridRow: 7,
        chartType: 'line',
        metricIds: ['timeseries.conversations'],
        gridColumn: 5,
        description: null,
      },
    ],
    title: 'Atendimento',
    channel: 'service',
  },
  commercial: {
    id: 'section-commercial',
    cards: [
      {
        id: 'commercial.funnel',
        kind: 'comparison',
        size: {
          h: 1,
          w: 6,
        },
        title: 'Oportunidades → ganhas',
        metric: 'commercial.funnel',
        source: 'commercial.funnel',
        gridRow: 0,
        gridColumn: 0,
        description: null,
        orientation: 'horizontal',
      },
      {
        id: 'commercial.winRate',
        kind: 'kpi',
        size: {
          h: 1,
          w: 2,
        },
        title: 'Taxa de ganho',
        metric: 'commercial.winRate',
        gridRow: 0,
        gridColumn: 6,
        description: null,
      },
      {
        id: 'commercial.open',
        kind: 'kpi',
        size: {
          h: 1,
          w: 2,
        },
        title: 'Abertas',
        metric: 'commercial.open',
        gridRow: 0,
        gridColumn: 8,
        description: null,
      },
      {
        id: 'commercial.transferredOpportunities',
        kind: 'kpi',
        size: {
          h: 1,
          w: 2,
        },
        title: 'Oportunidades transferidas',
        metric: 'commercial.transferredOpportunities',
        gridRow: 1,
        gridColumn: 0,
        description: null,
      },
      {
        id: 'commercial.linkedConversations',
        kind: 'kpi',
        size: {
          h: 1,
          w: 2,
        },
        title: 'Conversas vinculadas',
        metric: 'commercial.linkedConversations',
        gridRow: 1,
        gridColumn: 2,
        description: null,
      },
      {
        id: 'commercial.transfers',
        kind: 'kpi',
        size: {
          h: 1,
          w: 2,
        },
        title: 'Transferências',
        metric: 'commercial.transfers',
        gridRow: 1,
        gridColumn: 4,
        description: null,
      },
      {
        id: 'commercial.lost',
        kind: 'kpi',
        size: {
          h: 1,
          w: 2,
        },
        title: 'Perdidas',
        metric: 'commercial.lost',
        gridRow: 1,
        gridColumn: 6,
        description: null,
        highlighted: false,
      },
      {
        id: 'commercial.handoffRate',
        kind: 'kpi',
        size: {
          h: 1,
          w: 2,
        },
        title: 'Taxa de handoff',
        metric: 'commercial.handoffRate',
        gridRow: 1,
        gridColumn: 8,
        description: null,
      },
      {
        id: 'commercial.pipelines',
        kind: 'table',
        size: {
          h: 5,
          w: 10,
        },
        title: 'Pipelines',
        source: 'commercial.pipelines',
        compact: true,
        gridRow: 2,
        gridColumn: 0,
        description: null,
      },
      {
        id: 'commercial.stages',
        kind: 'funnel',
        size: {
          h: 6,
          w: 4,
        },
        title: 'Etapas',
        source: 'commercial.stages',
        gridRow: 4,
        gridColumn: 0,
        description: null,
        orientation: 'vertical',
      },
      {
        id: 'timeseries.opportunities_created',
        kind: 'chart',
        size: {
          h: 4,
          w: 6,
        },
        title: 'Oportunidades criadas por dia',
        gridRow: 4,
        chartType: 'line',
        metricIds: ['timeseries.opportunities_created'],
        gridColumn: 4,
        description: null,
      },
      {
        id: 'commercial.aiInfluenceRate',
        kind: 'kpi',
        size: {
          h: 1,
          w: 2,
        },
        title: 'Taxa de influência da IA',
        metric: 'commercial.aiInfluenceRate',
        gridRow: 8,
        gridColumn: 4,
        description: null,
      },
      {
        id: 'commercial.aiInfluencedOpportunities',
        kind: 'kpi',
        size: {
          h: 1,
          w: 2,
        },
        title: 'Oportunidades com influência da IA',
        metric: 'commercial.aiInfluencedOpportunities',
        gridRow: 8,
        gridColumn: 6,
        description: null,
      },
      {
        id: 'commercial.aiInfluencedWins',
        kind: 'kpi',
        size: {
          h: 1,
          w: 2,
        },
        title: 'Ganhos com influência da IA',
        metric: 'commercial.aiInfluencedWins',
        gridRow: 8,
        gridColumn: 8,
        description: null,
      },
    ],
    title: 'Comercial',
    channel: 'commercial',
  },
  lead_quality: {
    id: 'section-lead_quality',
    cards: [
      {
        id: 'leadScore.distribution',
        kind: 'funnel',
        size: {
          h: 5,
          w: 4,
        },
        steps: [
          {
            id: 'step-0-Frio',
            label: 'Frio',
            metric: 'Frio',
          },
          {
            id: 'step-1-Morno',
            label: 'Morno',
            metric: 'Morno',
          },
        ],
        title: 'Lead Score',
        metric: 'leadScore.distribution',
        render: 'chart',
        source: 'leadScore.distribution',
        gridRow: 0,
        gridColumn: 0,
        description: null,
        orientation: 'horizontal',
      },
      {
        id: 'leadScore.averageScore',
        kind: 'kpi',
        size: {
          h: 1,
          w: 3,
        },
        title: 'Score médio',
        metric: 'leadScore.averageScore',
        gridRow: 0,
        gridColumn: 4,
        description: null,
        highlighted: true,
      },
      {
        id: 'leadScore.hotTransitions',
        kind: 'kpi',
        size: {
          h: 1,
          w: 3,
        },
        title: 'Transições para quente',
        metric: 'leadScore.hotTransitions',
        gridRow: 0,
        gridColumn: 7,
        description: null,
        highlighted: true,
      },
      {
        id: 'leadScore.businessModes',
        kind: 'table',
        size: {
          h: 5,
          w: 6,
        },
        title: 'Qualidade por business mode',
        source: 'leadScore.businessModes',
        compact: true,
        gridRow: 1,
        gridColumn: 4,
        description: null,
      },
      {
        id: 'leadScore.opportunities',
        kind: 'kpi',
        size: {
          h: 1,
          w: 2,
        },
        title: 'Oportunidades avaliadas',
        metric: 'leadScore.opportunities',
        gridRow: 3,
        gridColumn: 4,
        description: null,
      },
      {
        id: 'leadScore.averageDelta',
        kind: 'kpi',
        size: {
          h: 1,
          w: 2,
        },
        title: 'Delta médio',
        metric: 'leadScore.averageDelta',
        gridRow: 3,
        gridColumn: 6,
        description: null,
      },
      {
        id: 'leadScore.averageAttainmentRate',
        kind: 'kpi',
        size: {
          h: 1,
          w: 2,
        },
        title: 'Atingimento médio',
        metric: 'leadScore.averageAttainmentRate',
        gridRow: 3,
        gridColumn: 8,
        description: null,
      },
    ],
    title: 'Qualidade dos leads',
    channel: 'lead_quality',
  },
  automations: {
    id: 'section-automations',
    cards: [
      {
        id: 'automations.status',
        kind: 'breakdown',
        size: {
          h: 4,
          w: 4,
        },
        title: 'Status de execuções',
        metric: 'automations.status',
        render: 'chart',
        gridRow: 0,
        gridColumn: 0,
        description: null,
      },
      {
        id: 'automations.succeeded',
        kind: 'kpi',
        size: {
          h: 1,
          w: 2,
        },
        title: 'Sucesso',
        metric: 'automations.succeeded',
        gridRow: 0,
        gridColumn: 4,
        description: null,
      },
      {
        id: 'automations.skipped',
        kind: 'kpi',
        size: {
          h: 1,
          w: 2,
        },
        title: 'Ignoradas',
        metric: 'automations.skipped',
        gridRow: 0,
        gridColumn: 6,
        description: null,
      },
      {
        id: 'automations.failed',
        kind: 'kpi',
        size: {
          h: 1,
          w: 2,
        },
        title: 'Falhas',
        metric: 'automations.failed',
        gridRow: 0,
        gridColumn: 8,
        description: null,
      },
      {
        id: 'automations.averageDurationMs',
        kind: 'kpi',
        size: {
          h: 1,
          w: 2,
        },
        title: 'Duração média',
        metric: 'automations.averageDurationMs',
        gridRow: 1,
        gridColumn: 4,
        description: null,
      },
      {
        id: 'automations.confirmedEffects',
        kind: 'kpi',
        size: {
          h: 1,
          w: 2,
        },
        title: 'Efeitos confirmados',
        metric: 'automations.confirmedEffects',
        gridRow: 1,
        gridColumn: 6,
        description: null,
      },
      {
        id: 'automations.cancelled',
        kind: 'kpi',
        size: {
          h: 1,
          w: 2,
        },
        title: 'Canceladas',
        metric: 'automations.cancelled',
        gridRow: 1,
        gridColumn: 8,
        description: null,
      },
      {
        id: 'automations.live',
        kind: 'kpi',
        size: {
          h: 1,
          w: 2,
        },
        title: 'Live',
        metric: 'automations.live',
        gridRow: 2,
        gridColumn: 4,
        description: null,
      },
      {
        id: 'automations.runs',
        kind: 'kpi',
        size: {
          h: 1,
          w: 2,
        },
        title: 'Execuções',
        metric: 'automations.runs',
        gridRow: 2,
        gridColumn: 6,
        description: null,
      },
      {
        id: 'automations.successRate',
        kind: 'kpi',
        size: {
          h: 1,
          w: 2,
        },
        title: 'Taxa de sucesso',
        metric: 'automations.successRate',
        gridRow: 2,
        gridColumn: 8,
        description: null,
      },
      {
        id: 'automations.recipes',
        kind: 'table',
        size: {
          h: 5,
          w: 10,
        },
        title: 'Por receita',
        source: 'automations.recipes',
        compact: true,
        gridRow: 4,
        gridColumn: 0,
        description: null,
      },
    ],
    title: 'Automações',
    channel: 'automations',
  },
};

const REASON = 'LF-DEF1';

export class ApplyLeadflowChannelDefaultLayouts1801800000000 implements MigrationInterface {
  name = 'ApplyLeadflowChannelDefaultLayouts1801800000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE IF NOT EXISTS leadflow_analytics_dashboard_layout_backups (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        dashboard_id uuid NOT NULL,
        layout jsonb NOT NULL,
        reason varchar(64) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await runner.query(
      `INSERT INTO leadflow_analytics_dashboard_layout_backups
         (dashboard_id, layout, reason)
       SELECT d.id, d.layout, $1::varchar
         FROM leadflow_analytics_dashboards d
        WHERE d.channel_key = ANY($2::varchar[])
          AND NOT EXISTS (
            SELECT 1
              FROM leadflow_analytics_dashboard_layout_backups b
             WHERE b.dashboard_id = d.id
               AND b.reason = $1::varchar
          )`,
      [REASON, Object.keys(CHANNEL_SECTIONS)],
    );

    for (const [channel, section] of Object.entries(CHANNEL_SECTIONS)) {
      await runner.query(
        `UPDATE leadflow_analytics_dashboards
            SET layout = $1::jsonb,
                updated_at = now()
          WHERE channel_key = $2`,
        [JSON.stringify({ version: 1, sections: [section] }), channel],
      );
    }
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      `UPDATE leadflow_analytics_dashboards d
          SET layout = b.layout,
              updated_at = now()
         FROM leadflow_analytics_dashboard_layout_backups b
        WHERE b.dashboard_id = d.id
          AND b.reason = $1`,
      [REASON],
    );
    await runner.query(
      `DELETE FROM leadflow_analytics_dashboard_layout_backups
        WHERE reason = $1`,
      [REASON],
    );
  }
}
