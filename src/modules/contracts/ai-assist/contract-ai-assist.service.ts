import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import type { AuthorizedRequestContext } from '../../../common/context/authorized-context.decorator';
import {
  AiCostLedgerService,
  type AiCostEntryInput,
} from '../../ai-costs/ai-cost-ledger.service';
import { ContractAiAssistRun } from '../entities/contract-ai-assist-run.entity';
import { sanitizeContractHtml } from '../contracts-sanitize';
import { applyContractVariableMapping } from './contract-ai-assist-apply';
import { ContractAiAssistConfigService } from './contract-ai-assist-config.service';
import { ContractAiAssistDto } from './contract-ai-assist.dto';
import {
  CONTRACT_AI_ASSIST_PROMPT_VERSION,
  ContractAiAssistProvider,
} from './contract-ai-assist.provider';
import {
  ContractAiAssistProviderError,
  type ContractAiAssistProviderResult,
  type ContractAiAssistResult,
  type ContractAiAssistUsage,
} from './contract-ai-assist.types';
import { CONTRACT_AI_UNPRICED_COST } from './contract-ai-pricing';

@Injectable()
export class ContractAiAssistService {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly config: ContractAiAssistConfigService,
    private readonly provider: ContractAiAssistProvider,
    private readonly ledger: AiCostLedgerService,
  ) {}

  async assist(
    context: AuthorizedRequestContext,
    dto: ContractAiAssistDto,
    idempotencyKey: string | undefined,
  ): Promise<ContractAiAssistResult> {
    if (!idempotencyKey?.trim() || idempotencyKey.length > 120)
      throw new BadRequestException({
        code: 'contract_ai_idempotency_key_invalid',
      });
    const hasText = dto.sourceText !== undefined;
    const hasHtml = dto.sourceHtml !== undefined;
    if (hasText === hasHtml)
      fail(
        422,
        'contract_ai_input_empty',
        'Provide exactly one of sourceText or sourceHtml.',
      );
    const source = dto.sourceText ?? dto.sourceHtml ?? '';
    if (source.length > this.config.maxInputChars)
      fail(422, 'contract_ai_input_too_large');
    const visible = hasHtml
      ? sanitizeContractHtml(source)
          .replace(/<[^>]*>/g, '')
          .replace(/&nbsp;|&#160;/g, ' ')
      : source;
    if (!visible.trim()) fail(422, 'contract_ai_input_empty');

    // Every prompt-affecting field participates in the fingerprint. Keep the
    // legal text exact: trimming it would silently change replay semantics.
    const inputSha256 = createHash('sha256')
      .update(
        JSON.stringify({
          sourceText: dto.sourceText ?? null,
          sourceHtml: dto.sourceHtml ?? null,
          targetType: dto.targetType,
          categoryOptions: (dto.categoryOptions ?? []).map((c) => ({
            value: c.value,
            label: c.label,
          })),
        }),
      )
      .digest('hex');
    const reservation = await this.dataSource.transaction(async (manager) => {
      // Short transaction only. Serialize daily reservations for this scope,
      // never hold a database lock during a paid network call.
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`contract_ai_assist:${context.tenantId}:${context.workspaceId}`],
      );
      const repository = manager.getRepository(ContractAiAssistRun);
      const existing = await repository.findOneBy({
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        idempotencyKey,
      });
      if (existing) {
        if (existing.inputSha256 !== inputSha256)
          fail(422, 'idempotency_key_reused');
        if (existing.status === 'processing')
          fail(409, 'contract_ai_run_in_progress');
        if (existing.status === 'failed' || !existing.result)
          fail(502, existing.errorCode ?? 'contract_ai_provider_failed');
        return { run: existing, replay: true };
      }
      if (this.config.mode === 'disabled') fail(503, 'contract_ai_disabled');
      const counts = await manager.query<{ count: number }[]>(
        `
        SELECT count(*)::int AS count FROM agency_contract_ai_assist_runs
        WHERE tenant_id = $1 AND workspace_id = $2
          AND created_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
          AND created_at < ((date_trunc('day', now() AT TIME ZONE 'UTC') + interval '1 day') AT TIME ZONE 'UTC')
      `,
        [context.tenantId, context.workspaceId],
      );
      if (counts[0].count >= this.config.dailyLimitPerWorkspace)
        fail(429, 'contract_ai_daily_limit');
      const run = await repository.save(
        repository.create({
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          idempotencyKey,
          inputSha256,
          inputChars: source.length,
          targetType: dto.targetType,
          status: 'processing',
          model: this.config.model,
          promptVersion: CONTRACT_AI_ASSIST_PROMPT_VERSION,
          createdById: context.userId,
          result: null,
          usage: null,
          errorCode: null,
          latencyMs: null,
          finishedAt: null,
        }),
      );
      return { run, replay: false };
    });
    if (reservation.replay) return reservation.run.result!;
    const run = reservation.run;
    const started = Date.now();
    let response: ContractAiAssistProviderResult | undefined;
    let result: ContractAiAssistResult | null = null;
    let error: ContractAiAssistProviderError | null = null;
    try {
      // Internal UUID also scopes the provider's idempotency key across tenants.
      response = await this.provider.generate(dto, run.id);
      const applied = applyContractVariableMapping(dto, response.output);
      result = {
        runId: run.id,
        model: response.model,
        promptVersion: run.promptVersion,
        ...applied,
        suggestions: response.output.suggestions,
        reviewNotes: response.output.reviewNotes,
        usage: {
          inputTokens: response.usage.inputTokens ?? null,
          outputTokens: response.usage.outputTokens ?? null,
        },
      };
    } catch (caught) {
      error =
        caught instanceof ContractAiAssistProviderError
          ? caught
          : new ContractAiAssistProviderError(
              'application_failed',
              response?.paid ?? false,
              response?.usage ?? {},
            );
    }
    const usage = response?.usage ?? error?.usage ?? {};
    const paid = response?.paid ?? error?.paid ?? false;
    // The closure and its cost are atomic. A storage failure leaves processing
    // reserved; replay must never retry a potentially paid provider operation.
    await this.dataSource.transaction(async (manager) => {
      const status = error ? 'failed' : 'succeeded';
      const closed = await manager.getRepository(ContractAiAssistRun).update(
        {
          id: run.id,
          tenantId: run.tenantId,
          workspaceId: run.workspaceId,
          status: 'processing',
        },
        {
          status,
          result,
          usage,
          model: response?.model ?? run.model,
          errorCode: error ? 'contract_ai_provider_failed' : null,
          latencyMs: Date.now() - started,
          finishedAt: new Date(),
        },
      );
      if (closed.affected !== 1)
        throw new Error('contract_ai_run_closure_failed');
      if (paid)
        await this.ledger.record(
          [this.costEntry(run, usage, status, result)],
          manager,
        );
    });
    if (error) fail(502, 'contract_ai_provider_failed');
    return result!;
  }

  private costEntry(
    run: ContractAiAssistRun,
    usage: ContractAiAssistUsage,
    outcome: 'succeeded' | 'failed',
    result: ContractAiAssistResult | null,
  ): AiCostEntryInput {
    const metrics: Record<string, number> = {};
    if (usage.inputTokens !== undefined)
      metrics.input_tokens = usage.inputTokens;
    if (usage.cachedInputTokens !== undefined)
      metrics.cached_input_tokens = usage.cachedInputTokens;
    if (usage.outputTokens !== undefined)
      metrics.output_tokens = usage.outputTokens;
    return {
      tenantId: run.tenantId,
      workspaceId: run.workspaceId,
      agencyClientId: null,
      companyContextId: null,
      sourceDomain: 'agency.contracts',
      sourceType: 'template_ai_assist_run',
      sourceId: run.id,
      logicalType: 'contract_template_ai_assist',
      logicalId: run.id,
      operationKind: 'variable_mapping',
      provider: 'openai',
      model: result?.model ?? run.model,
      outcome,
      usage: {
        unit: 'tokens',
        quantity:
          usage.inputTokens !== undefined && usage.outputTokens !== undefined
            ? String(usage.inputTokens + usage.outputTokens)
            : null,
        metrics: Object.keys(metrics).length ? metrics : null,
      },
      unitPrice: null,
      pricingVersion: null,
      cost: CONTRACT_AI_UNPRICED_COST,
      occurredAt: run.createdAt,
      correlation: { contentItemId: null, projectId: null, taskId: null },
      metadata: {
        promptVersion: run.promptVersion,
        inputChars: run.inputChars,
        replacements:
          result?.replacements.reduce((sum, r) => sum + r.occurrences, 0) ?? 0,
      },
    };
  }
}

function fail(status: number, code: string, message = code): never {
  throw new HttpException({ code, message }, status);
}
