import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import type { RequestContext } from '../../../common/context/request-context.interface';
import type { GetOperationalAnalyticsDto } from '../dto/get-operational-analytics.dto';
import type {
  OperationalAnalyticsAttemptMetric,
  OperationalAnalyticsDimensionOptions,
  OperationalAnalyticsMessageFact,
  OperationalAnalyticsRunFact,
  OperationalAnalyticsScoreFact,
} from '../types/operational-analytics.types';
import { projectOperationalAnalytics } from './operational-analytics-projector';

const MAX_PERIOD_DAYS = 366;
const MAX_MESSAGE_FACTS = 50_000;
const MAX_SCORE_FACTS = 25_000;
const MAX_RUN_FACTS = 20_000;

type AnalyticsScope = {
  tenantId: string;
  workspaceId: string;
  contextType: 'agency' | 'client';
  clientId: string | null;
};

type RawChannelOption = { id: string; name: string; type: string };
type RawAgentOption = { id: string; name: string; type: string };
type RawBusinessModeOption = { businessMode: string };

@Injectable()
export class LeadFlowOperationalAnalyticsService {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
  ) {}

  async getOverview(ctx: RequestContext, query: GetOperationalAnalyticsDto) {
    const scope = this.resolveScope(ctx);
    const { from, to } = this.resolvePeriod(query);
    const filters = {
      channelId: query.channelId ?? null,
      businessMode: query.businessMode ?? null,
      agentId: query.agentId ?? null,
    };

    const [channels, agents, businessModes, messages, scores, runs] =
      await Promise.all([
        this.loadChannels(scope),
        this.loadAgents(scope),
        this.loadBusinessModes(scope),
        this.loadMessages(scope, from, to, filters),
        this.loadScores(scope, from, to, filters),
        this.loadRuns(scope, from, to, filters.businessMode),
      ]);

    const options: OperationalAnalyticsDimensionOptions = {
      channels: channels.sort(
        (left, right) =>
          left.name.localeCompare(right.name) ||
          left.id.localeCompare(right.id),
      ),
      businessModes: businessModes
        .map((item) => item.businessMode)
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right)),
      agents: agents.sort(
        (left, right) =>
          left.name.localeCompare(right.name) ||
          left.id.localeCompare(right.id),
      ),
    };
    this.assertKnownFilters(filters, options);
    this.assertFactLimit('message', messages, MAX_MESSAGE_FACTS);
    this.assertFactLimit('lead score', scores, MAX_SCORE_FACTS);
    this.assertFactLimit('automation run', runs, MAX_RUN_FACTS);

    const boundedMessages = messages.map(mapMessageFact);
    const boundedScores = scores.map(mapScoreFact);
    const boundedRuns = runs.map(mapRunFact);
    const attempts = await this.loadAttemptMetrics(
      scope,
      boundedRuns.map((run) => run.id),
    );

    return projectOperationalAnalytics({
      from,
      to,
      filters,
      options,
      messages: boundedMessages,
      scores: boundedScores,
      runs: boundedRuns,
      attempts: attempts.map(mapAttemptMetric),
      agentNames: new Map(agents.map((agent) => [agent.id, agent.name])),
    });
  }

  private loadChannels(scope: AnalyticsScope) {
    return this.dataSource.query<RawChannelOption[]>(
      `
        /* leadflow-analytics:channel-options */
        SELECT channel.id, channel.name, channel.type
        FROM inbox_channels channel
        WHERE channel.tenant_id = $1
          AND channel.workspace_id = $2
          AND channel.deleted_at IS NULL
          AND (
            ($3 = 'client' AND channel.metadata->>'clientId' = $4)
            OR
            ($3 = 'agency' AND (
              channel.metadata->>'clientId' IS NULL
              OR channel.metadata->>'operatingMode' = 'agency'
            ))
          )
        ORDER BY channel.name ASC, channel.id ASC
      `,
      scopeParameters(scope),
    );
  }

  private loadAgents(scope: AnalyticsScope) {
    return this.dataSource.query<RawAgentOption[]>(
      `
        /* leadflow-analytics:agent-options */
        SELECT agent.id, agent.name, agent.type
        FROM leadflow_agents agent
        WHERE agent.tenant_id = $1
          AND agent.workspace_id = $2
          AND agent.context_type = $3
          AND (
            ($3 = 'client' AND agent.agency_client_id = $4::uuid)
            OR ($3 = 'agency' AND agent.agency_client_id IS NULL)
          )
        ORDER BY agent.name ASC, agent.id ASC
      `,
      scopeParameters(scope),
    );
  }

  private loadBusinessModes(scope: AnalyticsScope) {
    return this.dataSource.query<RawBusinessModeOption[]>(
      `
        /* leadflow-analytics:business-mode-options */
        SELECT DISTINCT modes.business_mode AS "businessMode"
        FROM (
          SELECT conversation.business_mode
          FROM inbox_conversations conversation
          LEFT JOIN inbox_channels channel
            ON channel.id = conversation.channel_id
           AND channel.tenant_id = conversation.tenant_id
           AND channel.workspace_id = conversation.workspace_id
           AND channel.deleted_at IS NULL
          WHERE conversation.tenant_id = $1
            AND conversation.workspace_id = $2
            AND (
              ($3 = 'client' AND channel.metadata->>'clientId' = $4)
              OR
              ($3 = 'agency' AND (
                conversation.channel_id IS NULL
                OR channel.metadata->>'clientId' IS NULL
                OR channel.metadata->>'operatingMode' = 'agency'
              ))
            )

          UNION

          SELECT opportunity.business_mode
          FROM crm_opportunities opportunity
          WHERE opportunity.tenant_id = $1
            AND opportunity.workspace_id = $2
            AND (
              ($3 = 'client' AND opportunity.metadata->>'clientId' = $4)
              OR
              ($3 = 'agency' AND (
                opportunity.metadata->>'clientId' IS NULL
                OR opportunity.metadata->>'operatingMode' = 'agency'
              ))
            )

          UNION

          SELECT automation.business_mode_key AS business_mode
          FROM leadflow_automations automation
          WHERE automation.tenant_id = $1
            AND automation.workspace_id = $2
            AND automation.context_type = $3
            AND (
              ($3 = 'client' AND automation.agency_client_id = $4::uuid)
              OR ($3 = 'agency' AND automation.agency_client_id IS NULL)
            )
        ) modes
        WHERE NULLIF(BTRIM(modes.business_mode), '') IS NOT NULL
        ORDER BY "businessMode" ASC
      `,
      scopeParameters(scope),
    );
  }

  private loadMessages(
    scope: AnalyticsScope,
    from: Date,
    to: Date,
    filters: {
      channelId: string | null;
      businessMode: string | null;
      agentId: string | null;
    },
  ) {
    const params: unknown[] = [
      ...scopeParameters(scope),
      from.toISOString(),
      to.toISOString(),
    ];
    const clauses = [
      'message.tenant_id = $1',
      'message.workspace_id = $2',
      "message.direction IN ('inbound', 'outbound')",
      'message.occurred_at BETWEEN $5::timestamptz AND $6::timestamptz',
      `(
        ($3 = 'client' AND channel.metadata->>'clientId' = $4)
        OR
        ($3 = 'agency' AND (
          conversation.channel_id IS NULL
          OR channel.metadata->>'clientId' IS NULL
          OR channel.metadata->>'operatingMode' = 'agency'
        ))
      )`,
    ];
    if (filters.channelId) {
      clauses.push(
        `conversation.channel_id = ${bind(params, filters.channelId)}::uuid`,
      );
    }
    if (filters.businessMode) {
      clauses.push(
        `conversation.business_mode = ${bind(params, filters.businessMode)}`,
      );
    }
    if (filters.agentId) {
      const agent = bind(params, filters.agentId);
      clauses.push(
        `(
          EXISTS (
            SELECT 1
            FROM inbox_messages selected_agent_message
            WHERE selected_agent_message.tenant_id = message.tenant_id
              AND selected_agent_message.workspace_id = message.workspace_id
              AND selected_agent_message.conversation_id = message.conversation_id
              AND selected_agent_message.sender_agent_id = ${agent}::uuid
              AND selected_agent_message.direction = 'outbound'
              AND selected_agent_message.status IN ('sent', 'delivered', 'read')
              AND selected_agent_message.occurred_at
                BETWEEN $5::timestamptz AND $6::timestamptz
          )
          AND (
            message.direction = 'inbound'
            OR message.sender_agent_id = ${agent}::uuid
          )
        )`,
      );
    }
    params.push(MAX_MESSAGE_FACTS + 1);

    return this.dataSource.query<Record<string, unknown>[]>(
      `
        /* leadflow-analytics:message-facts */
        SELECT
          message.id,
          message.conversation_id AS "conversationId",
          message.direction,
          message.sender_type AS "senderType",
          message.sender_agent_id AS "senderAgentId",
          message.status,
          message.occurred_at AS "occurredAt",
          conversation.channel_id AS "channelId",
          channel.name AS "channelName",
          channel.type AS "channelType",
          conversation.business_mode AS "businessMode",
          conversation.assigned_agent_id AS "assignedAgentId"
        FROM inbox_messages message
        INNER JOIN inbox_conversations conversation
          ON conversation.id = message.conversation_id
         AND conversation.tenant_id = message.tenant_id
         AND conversation.workspace_id = message.workspace_id
        LEFT JOIN inbox_channels channel
          ON channel.id = conversation.channel_id
         AND channel.tenant_id = conversation.tenant_id
         AND channel.workspace_id = conversation.workspace_id
         AND channel.deleted_at IS NULL
        WHERE ${clauses.join('\n          AND ')}
        ORDER BY message.occurred_at ASC, message.id ASC
        LIMIT $${params.length}
      `,
      params,
    );
  }

  private loadScores(
    scope: AnalyticsScope,
    from: Date,
    to: Date,
    filters: {
      channelId: string | null;
      businessMode: string | null;
      agentId: string | null;
    },
  ) {
    const params: unknown[] = [
      ...scopeParameters(scope),
      from.toISOString(),
      to.toISOString(),
    ];
    const clauses = [
      'snapshot.tenant_id = $1',
      'snapshot.workspace_id = $2',
      'snapshot.calculated_at BETWEEN $5::timestamptz AND $6::timestamptz',
      `(
        ($3 = 'client' AND opportunity.metadata->>'clientId' = $4)
        OR
        ($3 = 'agency' AND (
          opportunity.metadata->>'clientId' IS NULL
          OR opportunity.metadata->>'operatingMode' = 'agency'
        ))
      )`,
    ];
    if (filters.channelId) {
      clauses.push(
        `conversation.channel_id = ${bind(params, filters.channelId)}::uuid`,
      );
    }
    if (filters.businessMode) {
      clauses.push(
        `opportunity.business_mode = ${bind(params, filters.businessMode)}`,
      );
    }
    if (filters.agentId) {
      clauses.push(
        `conversation.assigned_agent_id = ${bind(params, filters.agentId)}::uuid`,
      );
    }
    params.push(MAX_SCORE_FACTS + 1);

    return this.dataSource.query<Record<string, unknown>[]>(
      `
        /* leadflow-analytics:score-facts */
        SELECT
          snapshot.opportunity_id AS "opportunityId",
          snapshot.score,
          snapshot.band,
          snapshot.previous_score AS "previousScore",
          snapshot.previous_band AS "previousBand",
          snapshot.policy_version AS "policyVersion",
          snapshot.max_achievable AS "maxAchievable",
          snapshot.calculated_at AS "calculatedAt",
          opportunity.business_mode AS "businessMode",
          conversation.channel_id AS "channelId",
          channel.type AS "channelType",
          conversation.assigned_agent_id AS "assignedAgentId"
        FROM crm_lead_score_snapshots snapshot
        INNER JOIN crm_opportunities opportunity
          ON opportunity.id = snapshot.opportunity_id
         AND opportunity.tenant_id = snapshot.tenant_id
         AND opportunity.workspace_id = snapshot.workspace_id
        LEFT JOIN inbox_conversations conversation
          ON conversation.id = opportunity.inbox_conversation_id
         AND conversation.tenant_id = opportunity.tenant_id
         AND conversation.workspace_id = opportunity.workspace_id
        LEFT JOIN inbox_channels channel
          ON channel.id = conversation.channel_id
         AND channel.tenant_id = conversation.tenant_id
         AND channel.workspace_id = conversation.workspace_id
         AND channel.deleted_at IS NULL
        WHERE ${clauses.join('\n          AND ')}
        ORDER BY snapshot.calculated_at ASC, snapshot.id ASC
        LIMIT $${params.length}
      `,
      params,
    );
  }

  private loadRuns(
    scope: AnalyticsScope,
    from: Date,
    to: Date,
    businessMode: string | null,
  ) {
    const params: unknown[] = [
      ...scopeParameters(scope),
      from.toISOString(),
      to.toISOString(),
    ];
    const clauses = [
      'run.tenant_id = $1',
      'run.workspace_id = $2',
      'run.created_at BETWEEN $5::timestamptz AND $6::timestamptz',
      'automation.context_type = $3',
      `(
        ($3 = 'client' AND automation.agency_client_id = $4::uuid)
        OR ($3 = 'agency' AND automation.agency_client_id IS NULL)
      )`,
    ];
    if (businessMode) {
      clauses.push(
        `automation.business_mode_key = ${bind(params, businessMode)}`,
      );
    }
    params.push(MAX_RUN_FACTS + 1);

    return this.dataSource.query<Record<string, unknown>[]>(
      `
        /* leadflow-analytics:run-facts */
        SELECT
          run.id,
          run.automation_id AS "automationId",
          automation.name AS "automationName",
          run.recipe_key AS "recipeKey",
          automation.business_mode_key AS "businessMode",
          run.mode,
          run.status,
          run.skip_reason AS "skipReason",
          run.error_code AS "errorCode",
          run.attempt_count AS "attemptCount",
          run.created_at AS "createdAt",
          run.started_at AS "startedAt",
          run.finished_at AS "finishedAt",
          CASE
            WHEN run.started_at IS NOT NULL AND run.finished_at IS NOT NULL
            THEN ROUND(EXTRACT(EPOCH FROM (run.finished_at - run.started_at)) * 1000)
            ELSE NULL
          END AS "durationMs"
        FROM leadflow_automation_runs run
        INNER JOIN leadflow_automations automation
          ON automation.id = run.automation_id
         AND automation.tenant_id = run.tenant_id
         AND automation.workspace_id = run.workspace_id
        WHERE ${clauses.join('\n          AND ')}
        ORDER BY run.created_at DESC, run.id DESC
        LIMIT $${params.length}
      `,
      params,
    );
  }

  private loadAttemptMetrics(scope: AnalyticsScope, runIds: string[]) {
    if (runIds.length === 0) {
      return Promise.resolve([] as Record<string, unknown>[]);
    }
    return this.dataSource.query<Record<string, unknown>[]>(
      `
        /* leadflow-analytics:attempt-metrics */
        SELECT
          attempt.run_id AS "runId",
          COUNT(*) FILTER (WHERE attempt.effect_confirmed = TRUE) AS "confirmedEffects",
          COUNT(*) FILTER (WHERE attempt.status = 'failed') AS "failedAttempts"
        FROM leadflow_automation_run_attempts attempt
        WHERE attempt.tenant_id = $1
          AND attempt.workspace_id = $2
          AND attempt.run_id = ANY($3::uuid[])
        GROUP BY attempt.run_id
      `,
      [scope.tenantId, scope.workspaceId, runIds],
    );
  }

  private resolveScope(ctx: RequestContext): AnalyticsScope {
    if (!ctx.tenantId) {
      throw new BadRequestException('Tenant context is required.');
    }
    if (!ctx.workspaceId) {
      throw new BadRequestException('Workspace context is required.');
    }
    if (ctx.managedContext?.operatingMode === 'client') {
      if (!ctx.managedContext.clientId) {
        throw new BadRequestException('Client context is required.');
      }
      return {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        contextType: 'client',
        clientId: ctx.managedContext.clientId,
      };
    }
    return {
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      contextType: 'agency',
      clientId: null,
    };
  }

  private resolvePeriod(query: GetOperationalAnalyticsDto) {
    const now = new Date();
    const to = query.to ? new Date(query.to) : now;
    const from = query.from
      ? new Date(query.from)
      : new Date(to.getTime() - 30 * 86_400_000);
    if (
      Number.isNaN(from.getTime()) ||
      Number.isNaN(to.getTime()) ||
      from.getTime() > to.getTime()
    ) {
      throw new BadRequestException('The analytics period is invalid.');
    }
    if (to.getTime() > now.getTime() + 5 * 60_000) {
      throw new BadRequestException(
        'The analytics period cannot end in the future.',
      );
    }
    if ((to.getTime() - from.getTime()) / 86_400_000 > MAX_PERIOD_DAYS) {
      throw new BadRequestException(
        `The analytics period cannot exceed ${MAX_PERIOD_DAYS} days.`,
      );
    }
    return { from, to };
  }

  private assertKnownFilters(
    filters: {
      channelId: string | null;
      businessMode: string | null;
      agentId: string | null;
    },
    options: OperationalAnalyticsDimensionOptions,
  ) {
    if (
      filters.channelId &&
      !options.channels.some((channel) => channel.id === filters.channelId)
    ) {
      throw new BadRequestException(
        'The analytics channel is not available in this context.',
      );
    }
    if (
      filters.agentId &&
      !options.agents.some((agent) => agent.id === filters.agentId)
    ) {
      throw new BadRequestException(
        'The analytics agent is not available in this context.',
      );
    }
    if (
      filters.businessMode &&
      !options.businessModes.includes(filters.businessMode)
    ) {
      throw new BadRequestException(
        'The analytics business mode is not available in this context.',
      );
    }
  }

  private assertFactLimit(label: string, facts: unknown[], maximum: number) {
    if (facts.length > maximum) {
      throw new BadRequestException(
        `The selected period exceeds ${maximum} ${label} facts. Reduce the period or add filters.`,
      );
    }
  }
}

function scopeParameters(scope: AnalyticsScope) {
  return [scope.tenantId, scope.workspaceId, scope.contextType, scope.clientId];
}

function bind(params: unknown[], value: unknown) {
  params.push(value);
  return `$${params.length}`;
}

function mapMessageFact(
  row: Record<string, unknown>,
): OperationalAnalyticsMessageFact {
  return {
    id: asString(row.id),
    conversationId: asString(row.conversationId),
    direction: row.direction === 'inbound' ? 'inbound' : 'outbound',
    senderType: asString(row.senderType),
    senderAgentId: asNullableString(row.senderAgentId),
    status: asString(row.status),
    occurredAt: asIsoString(row.occurredAt),
    channelId: asNullableString(row.channelId),
    channelName: asNullableString(row.channelName),
    channelType: asNullableString(row.channelType),
    businessMode: asString(row.businessMode, 'general'),
    assignedAgentId: asNullableString(row.assignedAgentId),
  };
}

function mapScoreFact(
  row: Record<string, unknown>,
): OperationalAnalyticsScoreFact {
  return {
    opportunityId: asString(row.opportunityId),
    score: asNumber(row.score),
    band: asString(row.band, 'unknown'),
    previousScore:
      row.previousScore === null || row.previousScore === undefined
        ? null
        : asNumber(row.previousScore),
    previousBand: asNullableString(row.previousBand),
    policyVersion: asString(row.policyVersion, 'unknown'),
    maxAchievable: asNumber(row.maxAchievable),
    calculatedAt: asIsoString(row.calculatedAt),
    businessMode: asString(row.businessMode, 'general'),
    channelId: asNullableString(row.channelId),
    channelType: asNullableString(row.channelType),
    assignedAgentId: asNullableString(row.assignedAgentId),
  };
}

function mapRunFact(row: Record<string, unknown>): OperationalAnalyticsRunFact {
  return {
    id: asString(row.id),
    automationId: asString(row.automationId),
    automationName: asString(row.automationName, 'Automação removida'),
    recipeKey: asString(row.recipeKey),
    businessMode: asString(row.businessMode, 'general'),
    mode: asString(row.mode),
    status: asString(row.status),
    skipReason: asNullableString(row.skipReason),
    errorCode: asNullableString(row.errorCode),
    attemptCount: asNumber(row.attemptCount),
    createdAt: asIsoString(row.createdAt),
    startedAt:
      row.startedAt === null || row.startedAt === undefined
        ? null
        : asIsoString(row.startedAt),
    finishedAt:
      row.finishedAt === null || row.finishedAt === undefined
        ? null
        : asIsoString(row.finishedAt),
    durationMs:
      row.durationMs === null || row.durationMs === undefined
        ? null
        : asNumber(row.durationMs),
  };
}

function mapAttemptMetric(
  row: Record<string, unknown>,
): OperationalAnalyticsAttemptMetric {
  return {
    runId: asString(row.runId),
    confirmedEffects: asNumber(row.confirmedEffects),
    failedAttempts: asNumber(row.failedAttempts),
  };
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' && value ? value : fallback;
}

function asNullableString(value: unknown) {
  return typeof value === 'string' && value ? value : null;
}

function asNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function asIsoString(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value));
  return date.toISOString();
}
