import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AiCostLedgerService } from '../ai-costs/ai-cost-ledger.service';
import type {
  OrionToolCallRecord,
  OrionTurnPrincipal,
  OrionTurnSurface,
} from './entities';
import { OrionConfigService } from './orion-config.service';
import { OrionLimitError } from './orion.errors';

export type OrionUsage = {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
};

export type OrionTurnScope = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  companyContextId: string | null;
  userId: string;
  principal: OrionTurnPrincipal;
  surface: OrionTurnSurface;
};

export type OrionReservation = {
  id: string;
  reservedCostUsd: number;
  scope: OrionTurnScope;
  provider: string;
  model: string;
  promptVersion: string;
};

type OrionTurnOutcome = {
  usage: OrionUsage;
  rounds: number;
  attempts: number;
  latencyMs: number;
  toolCalls: OrionToolCallRecord[];
};

/** Sum of the tenant's month: settled rows at their estimate, open ones at their reservation. */
const MONTH_SPEND_SQL = `
  SELECT COALESCE(SUM(
           CASE WHEN status = 'reserved' THEN reserved_cost_usd
                ELSE COALESCE(estimated_cost_usd, reserved_cost_usd) END
         ), 0)::text AS spent
    FROM orion_turns
   WHERE tenant_id = $1
     AND created_at >= (date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`;

/**
 * OR4 — reserve-then-settle budget for the Orion (D-OR-1), modeled on
 * `InboxProviderBudgetService` but on its own table (`orion_turns`); the
 * Inbox ledger is not touched.
 *
 * `reserve` runs under a per-tenant advisory lock, so two concurrent turns
 * cannot both pass a ceiling only one of them fits under. The hourly user
 * limit is counted in the same transaction. Only a `live` turn is a paid
 * operation: it is also materialized in `ai_operational_costs`
 * (`source_domain = 'orion'`) for Finance; `mock` turns settle at zero and
 * stay out of that ledger.
 */
@Injectable()
export class OrionBudgetService {
  private readonly logger = new Logger(OrionBudgetService.name);

  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly config: OrionConfigService,
    private readonly costs: AiCostLedgerService,
  ) {}

  async reserve(input: {
    scope: OrionTurnScope;
    idempotencyKey: string;
    provider: string;
    model: string;
    promptVersion: string;
  }): Promise<OrionReservation> {
    const reservedCostUsd = this.config.turnReserveUsd;
    const { scope } = input;
    return this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `orion:${scope.tenantId}`,
      ]);
      const existing: Array<{ status: string }> = await manager.query(
        `SELECT status FROM orion_turns
          WHERE tenant_id = $1 AND user_id = $2 AND idempotency_key = $3
          LIMIT 1`,
        [scope.tenantId, scope.userId, input.idempotencyKey],
      );
      if (existing[0])
        throw new OrionLimitError(
          existing[0].status === 'reserved'
            ? 'orion_turn_in_progress'
            : 'orion_turn_replayed',
        );
      const [spend]: Array<{ spent: string }> = await manager.query(
        MONTH_SPEND_SQL,
        [scope.tenantId],
      );
      const [hour]: Array<{ turns: number }> = await manager.query(
        `SELECT count(*)::int AS turns FROM orion_turns
          WHERE tenant_id = $1 AND user_id = $2
            AND created_at > now() - interval '1 hour'`,
        [scope.tenantId, scope.userId],
      );
      assertOrionLimits(
        {
          monthSpendUsd: Number(spend?.spent ?? 0),
          userTurnsLastHour: Number(hour?.turns ?? 0),
        },
        {
          monthlyBudgetUsd: this.config.tenantMonthlyBudgetUsd,
          userHourlyLimit: this.config.userHourlyLimit,
          reserveUsd: reservedCostUsd,
        },
      );
      const inserted: Array<{ id: string }> = await manager.query(
        `INSERT INTO orion_turns
           (tenant_id, workspace_id, agency_client_id, company_context_id,
            user_id, principal, surface, status, idempotency_key, provider,
            model, prompt_version, reserved_cost_usd)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'reserved',$8,$9,$10,$11,$12)
         RETURNING id`,
        [
          scope.tenantId,
          scope.workspaceId,
          scope.agencyClientId,
          scope.companyContextId,
          scope.userId,
          scope.principal,
          scope.surface,
          input.idempotencyKey,
          input.provider,
          input.model,
          input.promptVersion,
          reservedCostUsd,
        ],
      );
      return {
        id: inserted[0].id,
        reservedCostUsd,
        scope,
        provider: input.provider,
        model: input.model,
        promptVersion: input.promptVersion,
      };
    });
  }

  /** Whether the next turn would still fit under the tenant's monthly ceiling. */
  async monthlyBudgetAvailable(tenantId: string): Promise<boolean> {
    const [spend]: Array<{ spent: string }> = await this.dataSource.query(
      MONTH_SPEND_SQL,
      [tenantId],
    );
    return (
      Number(spend?.spent ?? 0) + this.config.turnReserveUsd <=
      this.config.tenantMonthlyBudgetUsd + 0.000001
    );
  }

  async succeed(
    reservation: OrionReservation,
    outcome: OrionTurnOutcome,
  ): Promise<number> {
    const live = reservation.provider !== 'mock';
    const priced = live
      ? estimateOrionCost(outcome.usage, this.config.prices())
      : 0;
    const estimated = priced ?? reservation.reservedCostUsd;
    await this.settle(reservation, 'succeeded', estimated, outcome, null);
    if (live) await this.materialize(reservation, 'succeeded', priced, outcome);
    return estimated;
  }

  async fail(
    reservation: OrionReservation,
    outcome: OrionTurnOutcome & { errorCode: string },
  ): Promise<void> {
    const live = reservation.provider !== 'mock';
    // A call that never left (or was never paid) costs nothing; one that did
    // and returned no usage keeps its reservation as the estimate.
    const paid = live && outcome.attempts > 0;
    const priced = paid
      ? estimateOrionCost(outcome.usage, this.config.prices())
      : null;
    const estimated = paid ? (priced ?? reservation.reservedCostUsd) : 0;
    await this.settle(
      reservation,
      'failed',
      estimated,
      outcome,
      outcome.errorCode.slice(0, 80),
    );
    if (paid) await this.materialize(reservation, 'failed', priced, outcome);
  }

  private async settle(
    reservation: OrionReservation,
    status: 'succeeded' | 'failed',
    estimatedCostUsd: number,
    outcome: OrionTurnOutcome,
    errorCode: string | null,
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE orion_turns SET
         status = $2, estimated_cost_usd = $3,
         input_tokens = $4, cached_input_tokens = $5, output_tokens = $6,
         tool_calls = $7::jsonb, rounds = $8, attempts = $9, latency_ms = $10,
         error_code = $11, completed_at = now(), updated_at = now()
       WHERE id = $1 AND status = 'reserved'`,
      [
        reservation.id,
        status,
        estimatedCostUsd,
        outcome.usage.inputTokens ?? null,
        outcome.usage.cachedInputTokens ?? null,
        outcome.usage.outputTokens ?? null,
        JSON.stringify(outcome.toolCalls),
        outcome.rounds,
        outcome.attempts,
        Math.round(outcome.latencyMs),
        errorCode,
      ],
    );
  }

  /**
   * The cost ledger is a projection: a failure here is logged and the turn
   * row (which already carries tokens and cost) stays the source to replay.
   */
  private async materialize(
    reservation: OrionReservation,
    outcome: 'succeeded' | 'failed',
    priced: number | null,
    result: OrionTurnOutcome,
  ): Promise<void> {
    const metrics = Object.fromEntries(
      Object.entries(result.usage).filter(
        (entry): entry is [string, number] => typeof entry[1] === 'number',
      ),
    );
    const totalTokens =
      (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0);
    try {
      await this.costs.record([
        {
          tenantId: reservation.scope.tenantId,
          workspaceId: reservation.scope.workspaceId,
          agencyClientId: reservation.scope.agencyClientId,
          companyContextId: reservation.scope.companyContextId,
          sourceDomain: 'orion',
          sourceType: 'orion_turn',
          sourceId: reservation.id,
          logicalType: 'orion_turn',
          logicalId: reservation.id,
          operationKind: 'chat_completion',
          provider: reservation.provider,
          model: reservation.model,
          outcome,
          usage: {
            unit: Object.keys(metrics).length ? 'tokens' : null,
            quantity: Object.keys(metrics).length ? String(totalTokens) : null,
            metrics: Object.keys(metrics).length ? metrics : null,
          },
          unitPrice: null,
          pricingVersion: priced === null ? null : this.config.pricingVersion(),
          cost:
            priced === null
              ? {
                  status: 'unknown',
                  reason: Object.keys(metrics).length
                    ? 'unpriced'
                    : outcome === 'failed'
                      ? 'outcome_unknown'
                      : 'usage_missing',
                }
              : {
                  status: 'known',
                  amount: priced.toFixed(6),
                  currency: 'USD',
                  source: 'lyra_calculated',
                },
          occurredAt: new Date(),
          correlation: { contentItemId: null, projectId: null, taskId: null },
          metadata: {
            surface: reservation.scope.surface,
            principal: reservation.scope.principal,
            promptVersion: reservation.promptVersion,
            rounds: result.rounds,
            attempts: result.attempts,
          },
        },
      ]);
    } catch (error) {
      this.logger.warn(
        `orion cost not materialized turn=${reservation.id}: ${(error as Error).message}`,
      );
    }
  }
}

export function assertOrionLimits(
  snapshot: { monthSpendUsd: number; userTurnsLastHour: number },
  limits: {
    monthlyBudgetUsd: number;
    userHourlyLimit: number;
    reserveUsd: number;
  },
): void {
  if (snapshot.userTurnsLastHour >= limits.userHourlyLimit)
    throw new OrionLimitError('orion_rate_limited');
  if (
    snapshot.monthSpendUsd + limits.reserveUsd >
    limits.monthlyBudgetUsd + 0.000001
  )
    throw new OrionLimitError('orion_budget_exhausted');
}

/** USD for the usage at the given rates; null when either is incomplete. */
export function estimateOrionCost(
  usage: OrionUsage,
  prices: { input: number; cached: number; output: number } | null,
): number | null {
  if (
    !prices ||
    usage.inputTokens === undefined ||
    usage.outputTokens === undefined
  )
    return null;
  const cached = Math.min(
    usage.inputTokens,
    Math.max(0, usage.cachedInputTokens ?? 0),
  );
  const uncached = Math.max(0, usage.inputTokens - cached);
  return (
    Math.round(
      ((uncached * prices.input +
        cached * prices.cached +
        usage.outputTokens * prices.output) /
        1_000_000) *
        1_000_000,
    ) / 1_000_000
  );
}
