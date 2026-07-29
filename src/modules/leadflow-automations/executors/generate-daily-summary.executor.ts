import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  NotificationActorType,
  NotificationInterestReason,
  NotificationProductKey,
} from '../../notifications/enums';
import { NotificationEventProcessorService } from '../../notifications/services';
import { LeadFlowAutomationErrorClass } from '../enums/leadflow-automation-run.enums';
import { localDayBounds } from '../services/leadflow-daily-schedule';
import { executorAvailability } from './automation-executors.registry';
import type {
  AutomationEffectRequest,
  AutomationEffectResult,
  AutomationExecutor,
  AutomationExecutorAvailability,
} from './automation-executor.types';

interface SummaryRow {
  userId: string;
  openCount: string;
  createdCount: string;
  wonCount: string;
  lostCount: string;
  overdueFollowupCount: string;
}

/**
 * Produces the operational daily opportunity digest.
 *
 * The source of truth is CRM, not the Phase 11 analytical read model. This is a
 * point-in-time operational notification, so querying canonical opportunities
 * at fire time avoids stale summaries while keeping Analytics independently
 * evolvable.
 */
@Injectable()
export class GenerateDailySummaryExecutor implements AutomationExecutor {
  readonly actionKey = 'generate_summary_placeholder';

  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly notifications: NotificationEventProcessorService,
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
    if (!localDate) return refused('daily_summary_date_required');

    try {
      const { start, end } = localDayBounds(localDate, timezone);
      const rows = targetUserId
        ? [
            await this.workspaceSummary(
              request.tenantId,
              request.workspaceId,
              targetUserId,
              start,
              end,
            ),
          ]
        : await this.ownerSummaries(
            request.tenantId,
            request.workspaceId,
            start,
            end,
          );
      if (rows.length === 0) return refused('daily_summary_no_recipient');

      let delivered = 0;
      let duplicates = 0;
      let skipped = 0;
      for (const row of rows) {
        const metrics = normalizeMetrics(row);
        const result = await this.notifications.process({
          eventId: `${request.idempotencyKey}:${row.userId}`,
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
              userId: row.userId,
              interestReason: NotificationInterestReason.ASSIGNED,
            },
          ],
          payload: {
            title: `Resumo de oportunidades — ${localDate}`,
            body: summaryBody(metrics),
            actionUrl: '/leadflow/crm',
            deliveryChannels: ['in_app'],
            localDate,
            timezone,
            metrics,
          },
        });
        if (result.status === 'created') delivered += 1;
        else if (result.status === 'duplicate') duplicates += 1;
        else skipped += 1;
      }

      if (delivered + duplicates === 0) {
        return refused('daily_summary_no_eligible_recipient');
      }
      return {
        status: 'confirmed',
        effectConfirmed: true,
        reference: `${request.automationId}:${localDate}`,
        details: {
          localDate,
          timezone,
          recipientCount: rows.length,
          delivered,
          duplicates,
          skipped,
        },
      };
    } catch {
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

  private async ownerSummaries(
    tenantId: string,
    workspaceId: string,
    start: Date,
    end: Date,
  ): Promise<SummaryRow[]> {
    return this.dataSource.query<SummaryRow[]>(
      `${summarySelect('assigned_user_id::text')}
         FROM crm_opportunities
        WHERE tenant_id = $1
          AND workspace_id = $2
          AND deleted_at IS NULL
          AND assigned_user_id IS NOT NULL
        GROUP BY assigned_user_id
        ORDER BY assigned_user_id`,
      [tenantId, workspaceId, start, end, new Date()],
    );
  }

  private async workspaceSummary(
    tenantId: string,
    workspaceId: string,
    targetUserId: string,
    start: Date,
    end: Date,
  ): Promise<SummaryRow> {
    const rows = await this.dataSource.query<SummaryRow[]>(
      `${summarySelect('$6::text')}
         FROM crm_opportunities
        WHERE tenant_id = $1
          AND workspace_id = $2
          AND deleted_at IS NULL`,
      [tenantId, workspaceId, start, end, new Date(), targetUserId],
    );
    return (
      rows[0] ?? {
        userId: targetUserId,
        openCount: '0',
        createdCount: '0',
        wonCount: '0',
        lostCount: '0',
        overdueFollowupCount: '0',
      }
    );
  }
}

function summarySelect(userExpression: string): string {
  return `SELECT ${userExpression} AS "userId",
                 COUNT(*) FILTER (WHERE status = 'open')::text AS "openCount",
                 COUNT(*) FILTER (
                   WHERE created_at >= $3 AND created_at < $4
                 )::text AS "createdCount",
                 COUNT(*) FILTER (
                   WHERE won_at >= $3 AND won_at < $4
                 )::text AS "wonCount",
                 COUNT(*) FILTER (
                   WHERE lost_at >= $3 AND lost_at < $4
                 )::text AS "lostCount",
                 COUNT(*) FILTER (
                   WHERE status = 'open'
                     AND next_follow_up_at IS NOT NULL
                     AND next_follow_up_at < $5
                 )::text AS "overdueFollowupCount"`;
}

function normalizeMetrics(row: SummaryRow): {
  open: number;
  created: number;
  won: number;
  lost: number;
  overdueFollowups: number;
} {
  return {
    open: finiteCount(row.openCount),
    created: finiteCount(row.createdCount),
    won: finiteCount(row.wonCount),
    lost: finiteCount(row.lostCount),
    overdueFollowups: finiteCount(row.overdueFollowupCount),
  };
}

function summaryBody(metrics: ReturnType<typeof normalizeMetrics>): string {
  return (
    `Hoje: ${metrics.created} novas, ${metrics.won} ganhas e ` +
    `${metrics.lost} perdidas. Carteira: ${metrics.open} abertas; ` +
    `${metrics.overdueFollowups} follow-ups vencidos.`
  );
}

function finiteCount(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function refused(errorCode: string): AutomationEffectResult {
  return {
    status: 'refused',
    effectConfirmed: false,
    errorClass: LeadFlowAutomationErrorClass.Permanent,
    errorCode,
    errorMessage: 'O resumo diário não encontrou destinatário elegível.',
    reference: null,
  };
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
