import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  NotificationActorType,
  NotificationInterestReason,
  NotificationProductKey,
} from '../../notifications/enums';
import { NotificationEventProcessorService } from '../../notifications/services';
import { TeamChatCardPostService } from '../../team-chat/services/team-chat-card-post.service';
import type {
  TeamChatCardGroup,
  TeamChatMessageCard,
} from '../../team-chat/types/team-chat-card.types';
import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import { LeadFlowAutomationErrorClass } from '../enums/leadflow-automation-run.enums';
import { localDayBounds } from '../services/leadflow-daily-schedule';
import { LeadFlowSummaryAgentResolver } from '../services/leadflow-summary-agent.resolver';
import { executorAvailability } from './automation-executors.registry';
import type {
  AutomationEffectRequest,
  AutomationEffectResult,
  AutomationExecutor,
  AutomationExecutorAvailability,
} from './automation-executor.types';

interface SummaryRow {
  key: string | null;
  name: string | null;
  openCount: string;
  createdCount: string;
  wonCount: string;
  lostCount: string;
  overdueFollowupCount: string;
}

interface SummaryMetrics {
  open: number;
  created: number;
  won: number;
  lost: number;
  overdueFollowups: number;
}

/** How many rows a breakdown shows before it collapses into "mais N". */
const BREAKDOWN_LIMIT = 5;

const FREQUENCY_LABELS: Record<string, string> = {
  daily: 'Diário',
  weekly: 'Semanal',
  monthly: 'Mensal',
};

const NOTIFICATION_CHANNELS = ['in_app', 'push', 'email'] as const;

/**
 * Produces the operational opportunity digest.
 *
 * The source of truth is CRM, not the Phase 11 analytical read model. This is a
 * point-in-time operational notification, so querying canonical opportunities
 * at fire time avoids stale summaries while keeping Analytics independently
 * evolvable.
 *
 * Two deliveries, deliberately different in shape: each responsible person is
 * notified about their own numbers, because that is what they can act on; the
 * Team Chat card carries the whole operation — agency and clients together —
 * because a channel is a room, not an inbox.
 */
@Injectable()
export class GenerateDailySummaryExecutor implements AutomationExecutor {
  readonly actionKey = 'generate_summary_placeholder';

  private readonly logger = new Logger(GenerateDailySummaryExecutor.name);

  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly notifications: NotificationEventProcessorService,
    private readonly teamChat: TeamChatCardPostService,
    private readonly agents: LeadFlowSummaryAgentResolver,
  ) {}

  availability(): AutomationExecutorAvailability {
    return executorAvailability(this.actionKey);
  }

  async execute(
    request: AutomationEffectRequest,
  ): Promise<AutomationEffectResult> {
    const localDate = stringField(request.payload.localDate);
    const timezone = stringField(request.payload.timezone) ?? 'UTC';
    const targetUserId = stringField(request.payload.targetUserId);
    const frequency = stringField(request.payload.frequency) ?? 'daily';
    const channels = channelList(request.payload.notificationChannels);
    const teamChatChannelId = request.payload.deliverToTeamChat
      ? stringField(request.payload.teamChatChannelId)
      : null;
    if (!localDate) return refused('daily_summary_date_required');

    try {
      const { start, end } = this.resolveWindow(request, localDate, timezone);
      // Only a client-scoped automation narrows the numbers. The agency's own
      // digest reports the whole operation, its clients included.
      const clientId =
        request.payload.contextType === LeadFlowSettingsContextType.Client
          ? stringField(request.payload.agencyClientId)
          : null;

      const rows = targetUserId
        ? [
            await this.singleRecipientSummary(
              request,
              targetUserId,
              start,
              end,
              clientId,
            ),
          ]
        : await this.ownerSummaries(request, start, end, clientId);

      let delivered = 0;
      let duplicates = 0;
      let skipped = 0;
      if (channels.length > 0) {
        for (const row of rows) {
          if (!row.key) continue;
          const result = await this.notifications.process({
            eventId: `${request.idempotencyKey}:${row.key}`,
            eventType: 'leadflow.daily_opportunity_summary.ready',
            tenantId: request.tenantId,
            workspaceId: request.workspaceId,
            productKey: NotificationProductKey.AGENCY,
            moduleKey: 'sales',
            actorType: NotificationActorType.SYSTEM,
            actorUserId: null,
            resourceType: 'leadflow_automation',
            resourceId: request.automationId,
            occurredAt: new Date().toISOString(),
            recipients: [
              {
                userId: row.key,
                interestReason: NotificationInterestReason.ASSIGNED,
              },
            ],
            payload: {
              title: `Resumo de oportunidades — ${periodLabel(start, end, timezone)}`,
              body: summaryBody(metricsOf(row)),
              actionUrl: '/leadflow/crm',
              deliveryChannels: channels,
              localDate,
              timezone,
              frequency,
              periodStart: start.toISOString(),
              periodEnd: end.toISOString(),
              metrics: metricsOf(row),
            },
          });
          if (result.status === 'created') delivered += 1;
          else if (result.status === 'duplicate') duplicates += 1;
          else skipped += 1;
        }
      }

      const teamChat = teamChatChannelId
        ? await this.publishToTeamChat(
            request,
            teamChatChannelId,
            { start, end, timezone, frequency, clientId },
            rows,
          )
        : null;

      if (teamChat === 'channel_unavailable') {
        return refused(
          'daily_summary_team_chat_channel_unavailable',
          'O canal do Team Chat escolhido não está mais disponível.',
        );
      }

      // Nothing was asked of this run: no channel selected and no chat
      // destination. Saying so is more useful than reporting a silent success.
      if (channels.length === 0 && !teamChat) {
        return refused('daily_summary_no_delivery_target');
      }
      if (!teamChat && rows.length === 0) {
        return refused('daily_summary_no_recipient');
      }
      if (!teamChat && delivered + duplicates === 0) {
        return refused('daily_summary_no_eligible_recipient');
      }

      return {
        status: 'confirmed',
        effectConfirmed: true,
        reference: `${request.automationId}:${localDate}`,
        details: {
          localDate,
          timezone,
          frequency,
          periodStart: start.toISOString(),
          periodEnd: end.toISOString(),
          recipientCount: rows.length,
          channels,
          delivered,
          duplicates,
          skipped,
          teamChat,
        },
      };
    } catch (error) {
      this.logger.error(
        `Opportunity summary failed for automation ${request.automationId}: ${
          error instanceof Error ? error.message : 'unknown_error'
        }`,
      );
      return {
        status: 'failed',
        effectConfirmed: false,
        errorClass: LeadFlowAutomationErrorClass.Transient,
        errorCode: 'daily_summary_generation_failed',
        errorMessage: 'O resumo diário não pôde ser gerado.',
        reference: null,
      };
    }
  }

  /**
   * The stretch the digest reports on: the window the trigger just closed.
   * Deliveries emitted before cadence existed carry no window and fall back to
   * the local day they named.
   */
  private resolveWindow(
    request: AutomationEffectRequest,
    localDate: string,
    timezone: string,
  ): { start: Date; end: Date } {
    const start = dateField(request.payload.periodStart);
    const end = dateField(request.payload.periodEnd);
    if (start && end && start.getTime() < end.getTime()) {
      return { start, end };
    }
    return localDayBounds(localDate, timezone);
  }

  private async publishToTeamChat(
    request: AutomationEffectRequest,
    channelId: string,
    window: {
      start: Date;
      end: Date;
      timezone: string;
      frequency: string;
      clientId: string | null;
    },
    owners: SummaryRow[],
  ): Promise<'posted' | 'duplicate' | 'channel_unavailable'> {
    const clients = await this.clientSummaries(
      request,
      window.start,
      window.end,
      window.clientId,
    );
    const totals = sumMetrics(owners.map(metricsOf));
    const agent = await this.agents.resolve({
      tenantId: request.tenantId,
      workspaceId: request.workspaceId,
      contextType:
        request.payload.contextType === LeadFlowSettingsContextType.Client
          ? LeadFlowSettingsContextType.Client
          : LeadFlowSettingsContextType.Agency,
      agencyClientId: window.clientId,
    });

    const result = await this.teamChat.postCard({
      tenantId: request.tenantId,
      workspaceId: request.workspaceId,
      channelId,
      dedupeKey: `leadflow-summary:${request.idempotencyKey}`,
      sender: {
        displayName: agent.name,
        agentId: agent.id,
        agentType: agent.type,
      },
      body: chatBody(totals, window.start, window.end, window.timezone),
      card: buildCard(
        totals,
        owners,
        clients,
        window.start,
        window.end,
        window.timezone,
        window.frequency,
      ),
      source: {
        module: 'leadflow-automations',
        resourceId: request.automationId,
      },
    });

    return result.status;
  }

  private async ownerSummaries(
    request: AutomationEffectRequest,
    start: Date,
    end: Date,
    clientId: string | null,
  ): Promise<SummaryRow[]> {
    const rows = await this.dataSource.query<SummaryRow[]>(
      `${summarySelect('o.assigned_user_id::text')}
         FROM crm_opportunities o
        WHERE o.tenant_id = $1
          AND o.workspace_id = $2
          AND o.deleted_at IS NULL
          AND o.assigned_user_id IS NOT NULL
          ${clientScope(6, clientId)}
        GROUP BY o.assigned_user_id
        ORDER BY o.assigned_user_id`,
      queryParams(request, start, end, clientId),
    );
    return this.withNames(
      rows,
      `SELECT profile.user_id::text AS "key", profile.display_name AS "name"
         FROM user_profile profile
        WHERE profile.tenant_id = $1
          AND profile.user_id::text = ANY($2::text[])`,
      request.tenantId,
    );
  }

  private async clientSummaries(
    request: AutomationEffectRequest,
    start: Date,
    end: Date,
    clientId: string | null,
  ): Promise<SummaryRow[]> {
    const rows = await this.dataSource.query<SummaryRow[]>(
      `${summarySelect("o.metadata ->> 'clientId'")}
         FROM crm_opportunities o
        WHERE o.tenant_id = $1
          AND o.workspace_id = $2
          AND o.deleted_at IS NULL
          ${clientScope(6, clientId)}
        GROUP BY o.metadata ->> 'clientId'`,
      queryParams(request, start, end, clientId),
    );
    return this.withNames(
      rows,
      `SELECT client.id::text AS "key", client.display_name AS "name"
         FROM agency_clients client
        WHERE client.tenant_id = $1
          AND client.id::text = ANY($2::text[])`,
      request.tenantId,
    );
  }

  private async singleRecipientSummary(
    request: AutomationEffectRequest,
    targetUserId: string,
    start: Date,
    end: Date,
    clientId: string | null,
  ): Promise<SummaryRow> {
    const rows = await this.dataSource.query<SummaryRow[]>(
      `${summarySelect('$6::text')}
         FROM crm_opportunities o
        WHERE o.tenant_id = $1
          AND o.workspace_id = $2
          AND o.deleted_at IS NULL
          ${clientScope(7, clientId)}`,
      [
        request.tenantId,
        request.workspaceId,
        start,
        end,
        new Date(),
        targetUserId,
        ...(clientId ? [clientId] : []),
      ],
    );
    return (
      rows[0] ?? {
        key: targetUserId,
        name: null,
        openCount: '0',
        createdCount: '0',
        wonCount: '0',
        lostCount: '0',
        overdueFollowupCount: '0',
      }
    );
  }

  /**
   * Names are resolved in a second pass because a correlated subquery cannot
   * reference the grouped expression, and joining the name table into the
   * aggregate would risk multiplying the counts it is meant to describe.
   */
  private async withNames(
    rows: SummaryRow[],
    nameQuery: string,
    tenantId: string,
  ): Promise<SummaryRow[]> {
    const keys = rows
      .map((row) => row.key)
      .filter((key): key is string => Boolean(key));
    if (keys.length === 0) return rows;

    const names = await this.dataSource.query<
      Array<{ key: string; name: string | null }>
    >(nameQuery, [tenantId, keys]);
    const byKey = new Map(names.map((entry) => [entry.key, entry.name]));
    return rows.map((row) => ({
      ...row,
      name: (row.key ? byKey.get(row.key) : null) ?? null,
    }));
  }
}

function queryParams(
  request: AutomationEffectRequest,
  start: Date,
  end: Date,
  clientId: string | null,
): unknown[] {
  const params: unknown[] = [
    request.tenantId,
    request.workspaceId,
    start,
    end,
    new Date(),
  ];
  if (clientId) params.push(clientId);
  return params;
}

function clientScope(position: number, clientId: string | null): string {
  return clientId ? `AND o.metadata ->> 'clientId' = $${position}` : '';
}

function summarySelect(keyExpression: string): string {
  return `SELECT ${keyExpression} AS "key",
                 NULL::text AS "name",
                 COUNT(*) FILTER (WHERE o.status = 'open')::text AS "openCount",
                 COUNT(*) FILTER (
                   WHERE o.created_at >= $3 AND o.created_at < $4
                 )::text AS "createdCount",
                 COUNT(*) FILTER (
                   WHERE o.won_at >= $3 AND o.won_at < $4
                 )::text AS "wonCount",
                 COUNT(*) FILTER (
                   WHERE o.lost_at >= $3 AND o.lost_at < $4
                 )::text AS "lostCount",
                 COUNT(*) FILTER (
                   WHERE o.status = 'open'
                     AND o.next_follow_up_at IS NOT NULL
                     AND o.next_follow_up_at < $5
                 )::text AS "overdueFollowupCount"`;
}

function metricsOf(row: SummaryRow): SummaryMetrics {
  return {
    open: finiteCount(row.openCount),
    created: finiteCount(row.createdCount),
    won: finiteCount(row.wonCount),
    lost: finiteCount(row.lostCount),
    overdueFollowups: finiteCount(row.overdueFollowupCount),
  };
}

function sumMetrics(all: SummaryMetrics[]): SummaryMetrics {
  return all.reduce<SummaryMetrics>(
    (total, metrics) => ({
      open: total.open + metrics.open,
      created: total.created + metrics.created,
      won: total.won + metrics.won,
      lost: total.lost + metrics.lost,
      overdueFollowups: total.overdueFollowups + metrics.overdueFollowups,
    }),
    { open: 0, created: 0, won: 0, lost: 0, overdueFollowups: 0 },
  );
}

function buildCard(
  totals: SummaryMetrics,
  owners: SummaryRow[],
  clients: SummaryRow[],
  start: Date,
  end: Date,
  timezone: string,
  frequency: string,
): TeamChatMessageCard {
  const groups: TeamChatCardGroup[] = [];
  const ownerGroup = breakdownGroup(
    'Por responsável',
    owners,
    'Sem responsável',
    'responsáveis',
  );
  if (ownerGroup) groups.push(ownerGroup);
  const clientGroup = breakdownGroup(
    'Por cliente',
    clients,
    'Agência',
    'clientes',
  );
  if (clientGroup) groups.push(clientGroup);

  return {
    kind: 'metrics_digest',
    title: 'Resumo de oportunidades',
    subtitle: `${FREQUENCY_LABELS[frequency] ?? 'Resumo'} · ${periodLabel(start, end, timezone)}`,
    metrics: [
      { label: 'Novas', value: String(totals.created) },
      { label: 'Ganhas', value: String(totals.won), tone: 'positive' },
      { label: 'Perdidas', value: String(totals.lost), tone: 'negative' },
      { label: 'Em aberto', value: String(totals.open) },
      {
        label: 'Follow-ups vencidos',
        value: String(totals.overdueFollowups),
        tone: totals.overdueFollowups > 0 ? 'warning' : 'neutral',
      },
    ],
    groups,
    cta: { label: 'Abrir CRM', href: '/leadflow/crm' },
  };
}

/**
 * One breakdown, ordered by what moved in the window and truncated so a card
 * stays a card. Rows with nothing at all in the period are dropped: a list of
 * zeros is noise, and the totals above already say the period was quiet.
 */
function breakdownGroup(
  title: string,
  rows: SummaryRow[],
  unnamedLabel: string,
  moreNoun: string,
): TeamChatCardGroup | null {
  const ranked = rows
    .map((row) => ({ row, metrics: metricsOf(row) }))
    .filter(
      ({ metrics }) =>
        metrics.created + metrics.won + metrics.lost + metrics.open > 0,
    )
    .sort(
      (left, right) =>
        right.metrics.created +
        right.metrics.won -
        (left.metrics.created + left.metrics.won),
    );
  if (ranked.length === 0) return null;

  const shown = ranked.slice(0, BREAKDOWN_LIMIT);
  const hidden = ranked.length - shown.length;
  return {
    title,
    rows: shown.map(({ row, metrics }) => ({
      label: row.name?.trim() || unnamedLabel,
      value: `${metrics.created} novas · ${metrics.won} ganhas · ${metrics.open} abertas`,
    })),
    ...(hidden > 0 ? { moreLabel: `mais ${hidden} ${moreNoun}` } : {}),
  };
}

function summaryBody(metrics: SummaryMetrics): string {
  return (
    `Período: ${metrics.created} novas, ${metrics.won} ganhas e ` +
    `${metrics.lost} perdidas. Carteira: ${metrics.open} abertas; ` +
    `${metrics.overdueFollowups} follow-ups vencidos.`
  );
}

/** The text a viewer sees where the card cannot render: previews and search. */
function chatBody(
  totals: SummaryMetrics,
  start: Date,
  end: Date,
  timezone: string,
): string {
  return `Resumo de oportunidades (${periodLabel(start, end, timezone)}) — ${summaryBody(totals)}`;
}

function periodLabel(start: Date, end: Date, timezone: string): string {
  return `${formatMoment(start, timezone)} → ${formatMoment(end, timezone)}`;
}

function formatMoment(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: timezone,
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

function channelList(value: unknown): string[] {
  if (!Array.isArray(value)) return ['in_app'];
  const allowed = new Set<string>(NOTIFICATION_CHANNELS);
  return value.filter(
    (item): item is string => typeof item === 'string' && allowed.has(item),
  );
}

function finiteCount(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function refused(
  errorCode: string,
  errorMessage = 'O resumo diário não encontrou destinatário elegível.',
): AutomationEffectResult {
  return {
    status: 'refused',
    effectConfirmed: false,
    errorClass: LeadFlowAutomationErrorClass.Permanent,
    errorCode,
    errorMessage,
    reference: null,
  };
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function dateField(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
