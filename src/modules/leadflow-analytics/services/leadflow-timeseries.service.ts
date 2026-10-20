import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { resolveCompanyAwareScope } from '../../../common/context/company-aware-scope';
import type { RequestContext } from '../../../common/context/request-context.interface';
import type { GetLeadFlowTimeseriesDto } from '../dto/get-leadflow-timeseries.dto';
import {
  LEADFLOW_TIMESERIES_METRICS,
  type LeadFlowTimeseriesMetric,
} from '../dashboards/leadflow-metric.catalog';
import {
  LEADFLOW_SCOPE_SQL_COMPANY,
  leadFlowCompanyScopeParameters,
} from '../scope/leadflow-analytics-scope.sql';
import { LeadFlowAnalyticsService } from './leadflow-analytics.service';

type MessageDay = {
  day: string;
  messages_inbound: string;
  messages_outbound: string;
  conversations: string;
};

@Injectable()
export class LeadFlowTimeseriesService {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly commercial: LeadFlowAnalyticsService,
  ) {}

  async get(ctx: RequestContext, query: GetLeadFlowTimeseriesDto) {
    const scope = resolveCompanyAwareScope(ctx);
    const metrics = this.metrics(query.metrics);
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from
      ? new Date(query.from)
      : new Date(to.getTime() - 30 * 86400000);
    if (
      !Number.isFinite(from.getTime()) ||
      !Number.isFinite(to.getTime()) ||
      from > to ||
      to.getTime() > Date.now() + 300000 ||
      to.getTime() - from.getTime() > 366 * 86400000
    ) {
      throw new BadRequestException(
        'The analytics period is invalid or exceeds 366 days.',
      );
    }
    const parameters: unknown[] = [
      ...leadFlowCompanyScopeParameters({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        contextType: scope.agencyClientId ? 'client' : 'agency',
        clientId: scope.agencyClientId,
        companyContextId: scope.companyContextId,
      }),
      from.toISOString(),
      to.toISOString(),
    ];
    const filters: string[] = [];
    if (query.channelId) {
      parameters.push(query.channelId);
      filters.push(`conversation.channel_id = $${parameters.length}::uuid`);
    }
    if (query.businessMode) {
      parameters.push(query.businessMode);
      filters.push(`conversation.business_mode = $${parameters.length}`);
    }
    if (query.agentId) {
      parameters.push(query.agentId);
      const agent = `$${parameters.length}::uuid`;
      // Same attribution as operational-overview: successful outbound selects
      // the conversation; inbound plus only this agent's outbound are counted.
      filters.push(`EXISTS (SELECT 1 FROM inbox_messages selected_agent_message
        WHERE selected_agent_message.tenant_id = message.tenant_id
          AND selected_agent_message.workspace_id = message.workspace_id
          AND selected_agent_message.conversation_id = message.conversation_id
          AND selected_agent_message.sender_agent_id = ${agent}
          AND selected_agent_message.direction = 'outbound'
          AND selected_agent_message.status IN ('sent','delivered','read')
          AND selected_agent_message.occurred_at BETWEEN $6::timestamptz AND $7::timestamptz)
        AND (message.direction = 'inbound' OR message.sender_agent_id = ${agent})`);
    }
    const [messages, opportunities] = await Promise.all([
      metrics.some((metric) => !metric.startsWith('opportunities_'))
        ? this.dataSource.query<MessageDay[]>(
            `SELECT
          to_char(message.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS day,
          COUNT(*) FILTER (WHERE message.direction = 'inbound') AS messages_inbound,
          COUNT(*) FILTER (WHERE message.direction = 'outbound' AND message.status IN ('sent','delivered','read')) AS messages_outbound,
          COUNT(DISTINCT message.conversation_id) AS conversations
        FROM inbox_messages message
        INNER JOIN inbox_conversations conversation ON conversation.id = message.conversation_id
          AND conversation.tenant_id = message.tenant_id AND conversation.workspace_id = message.workspace_id
        LEFT JOIN inbox_channels channel ON channel.id = conversation.channel_id
          AND channel.tenant_id = conversation.tenant_id AND channel.workspace_id = conversation.workspace_id AND channel.deleted_at IS NULL
        WHERE message.tenant_id = $1 AND message.workspace_id = $2
          AND message.direction IN ('inbound','outbound')
          AND message.occurred_at BETWEEN $6::timestamptz AND $7::timestamptz
          AND ${LEADFLOW_SCOPE_SQL_COMPANY.CHANNEL}
          ${filters.map((filter) => `AND ${filter}`).join('\n')}
        GROUP BY 1 ORDER BY 1`,
            parameters,
          )
        : Promise.resolve([]),
      metrics.some((metric) => metric.startsWith('opportunities_'))
        ? this.commercial.getCommercialDaily(ctx, {
            from: from.toISOString(),
            to: to.toISOString(),
          })
        : Promise.resolve([]),
    ]);
    const messageDays = new Map(messages.map((row) => [row.day, row]));
    const commercialDays = new Map(opportunities.map((row) => [row.day, row]));
    const rows: Array<
      { day: string } & Partial<Record<LeadFlowTimeseriesMetric, number>>
    > = [];
    const day = new Date(from);
    day.setUTCHours(0, 0, 0, 0);
    for (
      ;
      day.getTime() <= to.getTime();
      day.setUTCDate(day.getUTCDate() + 1)
    ) {
      const key = day.toISOString().slice(0, 10);
      const values = { ...messageDays.get(key), ...commercialDays.get(key) };
      const row: (typeof rows)[number] = { day: key };
      for (const metric of metrics) row[metric] = Number(values[metric] ?? 0);
      rows.push(row);
    }
    return {
      period: {
        from: from.toISOString(),
        to: to.toISOString(),
        timezone: 'UTC',
        commercialGrain: 'opportunity_created_at_cohort_status_at_window_end',
      },
      // Commercial keeps its canonical period-only cohort; message dimensions
      // must never pretend to filter commercial totals.
      filtersNotApplicableToCommercial: [
        'channelId',
        'businessMode',
        'agentId',
      ].filter((key) => Boolean(query[key as keyof GetLeadFlowTimeseriesDto])),
      metrics,
      rows,
    };
  }

  private metrics(value?: string): LeadFlowTimeseriesMetric[] {
    if (value === undefined) return [...LEADFLOW_TIMESERIES_METRICS];
    const items = value.split(',');
    if (
      !items.length ||
      new Set(items).size !== items.length ||
      items.some(
        (item) =>
          !(LEADFLOW_TIMESERIES_METRICS as readonly string[]).includes(item),
      )
    ) {
      throw new BadRequestException('Unknown or repeated timeseries metric.');
    }
    return items as LeadFlowTimeseriesMetric[];
  }
}
