import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { InboxRuntimeConfigService } from './inbox-runtime-config.service';
import {
  InboxProviderError,
  InboxProviderUsage,
} from './inbox-runtime.contracts';

export type InboxProviderOperation = 'decision' | 'transcription' | 'vision';

export type InboxBudgetReservation = {
  id: string;
  operation: InboxProviderOperation;
  reservedCostUsd: number;
};

type BudgetSnapshot = {
  costUsd: number;
  decisionCalls: number;
  transcriptionCalls: number;
  visionCalls: number;
  imageInputs: number;
};

type BudgetLimits = {
  budgetUsd: number;
  maxDecisionCalls: number;
  maxTranscriptionCalls: number;
  maxVisionCalls: number;
  maxImageInputs: number;
};

@Injectable()
export class InboxProviderBudgetService {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly config: InboxRuntimeConfigService,
  ) {}

  async reserve(input: {
    tenantId: string;
    workspaceId: string;
    operation: InboxProviderOperation;
    idempotencyKey: string;
    correlationId?: string;
    provider: string;
    model: string;
    imageCount?: number;
  }): Promise<InboxBudgetReservation> {
    const reservedCostUsd = this.reservationCost(input.operation);
    return this.dataSource.transaction(async (manager) => {
      const lockKey = [
        input.tenantId,
        input.workspaceId,
        this.config.activationSessionId,
      ].join(':');
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        lockKey,
      ]);
      const existing: Array<{
        id: string;
        status: string;
        reserved_cost_usd: string;
      }> = await manager.query(
        `SELECT id, status, reserved_cost_usd
         FROM inbox_provider_usage_ledger
         WHERE tenant_id = $1 AND workspace_id = $2 AND session_id = $3
           AND operation = $4 AND idempotency_key = $5
         LIMIT 1`,
        [
          input.tenantId,
          input.workspaceId,
          this.config.activationSessionId,
          input.operation,
          input.idempotencyKey,
        ],
      );
      if (existing[0]) {
        if (existing[0].status === 'reserved')
          throw new InboxProviderError('provider_request_in_progress', true);
        if (
          existing[0].status === 'succeeded' ||
          existing[0].status === 'refused'
        )
          throw new InboxProviderError('provider_idempotency_replayed', false);
        await manager.query(
          `UPDATE inbox_provider_usage_ledger
           SET status = 'reserved', error_code = NULL, completed_at = NULL,
               updated_at = now()
           WHERE id = $1`,
          [existing[0].id],
        );
        return {
          id: existing[0].id,
          operation: input.operation,
          reservedCostUsd: Number(existing[0].reserved_cost_usd),
        };
      }
      const rows: Array<{
        cost_usd: string;
        decision_calls: number;
        transcription_calls: number;
        vision_calls: number;
        image_inputs: number;
      }> = await manager.query(
        `SELECT
           COALESCE(SUM(
             CASE WHEN status IN ('succeeded','refused')
               THEN COALESCE(estimated_cost_usd, reserved_cost_usd)
               ELSE reserved_cost_usd END
           ), 0)::text AS cost_usd,
           COUNT(*) FILTER (WHERE operation = 'decision')::int AS decision_calls,
           COUNT(*) FILTER (WHERE operation = 'transcription')::int AS transcription_calls,
           COUNT(*) FILTER (WHERE operation = 'vision')::int AS vision_calls,
           COALESCE(SUM(image_count), 0)::int AS image_inputs
         FROM inbox_provider_usage_ledger
         WHERE tenant_id = $1 AND workspace_id = $2 AND session_id = $3`,
        [input.tenantId, input.workspaceId, this.config.activationSessionId],
      );
      assertBudgetAvailable(
        {
          costUsd: Number(rows[0]?.cost_usd ?? 0),
          decisionCalls: Number(rows[0]?.decision_calls ?? 0),
          transcriptionCalls: Number(rows[0]?.transcription_calls ?? 0),
          visionCalls: Number(rows[0]?.vision_calls ?? 0),
          imageInputs: Number(rows[0]?.image_inputs ?? 0),
        },
        {
          budgetUsd: this.config.budgetUsd,
          maxDecisionCalls: this.config.maxDecisionCalls,
          maxTranscriptionCalls: this.config.maxTranscriptionCalls,
          maxVisionCalls: this.config.maxVisionCalls,
          maxImageInputs: this.config.maxImageInputs,
        },
        input.operation,
        reservedCostUsd,
        input.imageCount ?? 0,
      );
      const inserted: Array<{ id: string }> = await manager.query(
        `INSERT INTO inbox_provider_usage_ledger
          (tenant_id, workspace_id, session_id, operation, idempotency_key,
           correlation_id, provider, model, status, reserved_cost_usd,
           image_count, attempts)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'reserved',$9,$10,0)
         RETURNING id`,
        [
          input.tenantId,
          input.workspaceId,
          this.config.activationSessionId,
          input.operation,
          input.idempotencyKey,
          input.correlationId ?? null,
          input.provider,
          input.model,
          reservedCostUsd,
          input.imageCount ?? 0,
        ],
      );
      return {
        id: inserted[0].id,
        operation: input.operation,
        reservedCostUsd,
      };
    });
  }

  async succeed(
    reservation: InboxBudgetReservation,
    input: {
      model: string;
      usage: InboxProviderUsage;
      attempts: number;
      latencyMs: number;
    },
  ): Promise<number> {
    const estimatedCostUsd = estimateProviderCost(
      reservation.operation,
      input.model,
      input.usage,
      reservation.reservedCostUsd,
      this.config,
    );
    await this.dataSource.query(
      `UPDATE inbox_provider_usage_ledger SET
         status = 'succeeded', estimated_cost_usd = $2,
         input_tokens = $3, cached_input_tokens = $4, output_tokens = $5,
         audio_seconds = $6, attempts = $7, latency_ms = $8,
         error_code = NULL, completed_at = now(), updated_at = now()
       WHERE id = $1`,
      [
        reservation.id,
        estimatedCostUsd,
        input.usage.inputTokens ?? null,
        input.usage.cachedInputTokens ?? null,
        input.usage.outputTokens ?? null,
        input.usage.audioSeconds ?? null,
        input.attempts,
        input.latencyMs,
      ],
    );
    return estimatedCostUsd;
  }

  async fail(
    reservation: InboxBudgetReservation,
    input: {
      errorCode: string;
      attempts: number;
      latencyMs: number;
      refused?: boolean;
      usage?: InboxProviderUsage;
      model: string;
    },
  ): Promise<void> {
    const estimatedCostUsd = input.usage
      ? estimateProviderCost(
          reservation.operation,
          input.model,
          input.usage,
          reservation.reservedCostUsd,
          this.config,
        )
      : reservation.reservedCostUsd;
    await this.dataSource.query(
      `UPDATE inbox_provider_usage_ledger SET
         status = $2, estimated_cost_usd = $3, attempts = $4,
         latency_ms = $5, error_code = $6, completed_at = now(),
         updated_at = now()
       WHERE id = $1`,
      [
        reservation.id,
        input.refused ? 'refused' : 'failed',
        estimatedCostUsd,
        input.attempts,
        input.latencyMs,
        input.errorCode,
      ],
    );
  }

  private reservationCost(operation: InboxProviderOperation): number {
    if (operation === 'decision') return this.config.decisionReserveUsd;
    if (operation === 'transcription')
      return this.config.transcriptionReserveUsd;
    return this.config.visionReserveUsd;
  }
}

export function assertBudgetAvailable(
  snapshot: BudgetSnapshot,
  limits: BudgetLimits,
  operation: InboxProviderOperation,
  reservationCostUsd: number,
  imageCount: number,
): void {
  const calls =
    operation === 'decision'
      ? snapshot.decisionCalls
      : operation === 'transcription'
        ? snapshot.transcriptionCalls
        : snapshot.visionCalls;
  const maxCalls =
    operation === 'decision'
      ? limits.maxDecisionCalls
      : operation === 'transcription'
        ? limits.maxTranscriptionCalls
        : limits.maxVisionCalls;
  if (calls >= maxCalls)
    throw new InboxProviderError('provider_call_limit_exhausted', false);
  if (snapshot.imageInputs + imageCount > limits.maxImageInputs)
    throw new InboxProviderError('provider_image_limit_exhausted', false);
  if (snapshot.costUsd + reservationCostUsd > limits.budgetUsd + 0.000001)
    throw new InboxProviderError('provider_budget_exhausted', false);
}

export function estimateProviderCost(
  operation: InboxProviderOperation,
  model: string,
  usage: InboxProviderUsage,
  fallbackUsd: number,
  config: Pick<
    InboxRuntimeConfigService,
    | 'decisionInputUsdPerMillion'
    | 'decisionCachedInputUsdPerMillion'
    | 'decisionOutputUsdPerMillion'
    | 'transcriptionUsdPerMinute'
  >,
): number {
  if (operation === 'transcription') {
    const perMinute =
      config.transcriptionUsdPerMinute ??
      (model === 'gpt-4o-mini-transcribe' ? 0.003 : null);
    if (perMinute !== null && usage.audioSeconds !== undefined)
      return roundUsd((usage.audioSeconds / 60) * perMinute);
    return fallbackUsd;
  }
  const known =
    model === 'gpt-5.6-terra'
      ? { input: 2.5, cached: 0.25, output: 15 }
      : model === 'gpt-5.6-luna'
        ? { input: 1, cached: 0.1, output: 6 }
        : null;
  const inputRate = config.decisionInputUsdPerMillion ?? known?.input;
  const cachedRate =
    config.decisionCachedInputUsdPerMillion ?? known?.cached ?? inputRate;
  const outputRate = config.decisionOutputUsdPerMillion ?? known?.output;
  if (
    inputRate === undefined ||
    cachedRate === undefined ||
    outputRate === undefined ||
    usage.inputTokens === undefined ||
    usage.outputTokens === undefined
  )
    return fallbackUsd;
  const cached = Math.min(
    usage.inputTokens,
    Math.max(0, usage.cachedInputTokens ?? 0),
  );
  const uncached = Math.max(0, usage.inputTokens - cached);
  return roundUsd(
    (uncached * inputRate +
      cached * cachedRate +
      usage.outputTokens * outputRate) /
      1_000_000,
  );
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
