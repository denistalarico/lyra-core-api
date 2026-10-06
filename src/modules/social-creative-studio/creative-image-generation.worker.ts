import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { hostname } from 'node:os';
import { DataSource } from 'typeorm';
import {
  detectMediaAssetMimeType,
  type MediaAssetEntity,
  type MediaAssetScope,
  MediaAssetUploadService,
} from '../../common/media-assets';
import { CREATIVE_IMAGE_MAX_BYTES } from './creative-asset.service';
import { CreativeGenerationConfigService } from './creative-generation-config';
import {
  type ImageGenerationFailureCode,
  ImageGenerationProvider,
  ImageGenerationProviderError,
  type ImageGenerationProviderOutput,
  type ImageGenerationProviderResult,
  type ImageGenerationUsage,
} from './creative-image-generation.provider';
import { CreativeImageGenerationException } from './creative-image-generation.service';
import { CREATIVE_GENERATION_MEDIA_SOURCE } from './creative-retention';
import {
  CreativeGenerationEntity,
  CreativeGenerationOutputEntity,
  type CreativeGenerationStatus,
} from './entities';

/**
 * How long a claimed generation may sit in `processing` before another worker
 * may take it over. The CS3.3 adapter's timeout (plus storage of four outputs)
 * must stay well below this, or a slow call gets stolen mid-flight.
 */
export const CREATIVE_GENERATION_LEASE = '10 minutes';

/** Retry delay: 30s, 60s, 120s … capped at 10 minutes. */
const RETRY_BASE_SECONDS = 30;
const RETRY_MAX_SECONDS = 600;

const GENERATED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);
const EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/** `DataSource.query` answers `[rows, rowCount]` for UPDATE … RETURNING (S2.5 lesson). */
function returnedRows<T>(result: unknown): T[] {
  if (!Array.isArray(result)) return [];
  if (result.length === 2 && Array.isArray(result[0])) return result[0] as T[];
  return result as T[];
}

/**
 * CS3.2 — executes queued generations outside the HTTP request.
 *
 * Same claim loop as `SocialCopyGenerationWorker`/`SocialAdSyncWorker`: a
 * single-row `FOR UPDATE SKIP LOCKED` claim that stamps `locked_by`, then
 * work, then a terminal write guarded by `status = 'processing' AND
 * locked_by = me` — a worker that outlived its lease cannot overwrite the
 * run another worker took over (its outputs are compensated instead).
 *
 * Exhausted leases are failed BEFORE claiming, and the claim only revives a
 * stale lease that still has attempts left: a job that kills its worker every
 * time ends `failed/timeout` after `max_attempts`, never loops.
 *
 * Separation from the API needs no code: this is a plain provider with an
 * `@Interval`; a process with `CREATIVE_GENERATION_WORKER_ENABLED=false` never
 * claims, and any number of processes with it on share the queue.
 */
@Injectable()
export class CreativeImageGenerationWorker {
  private readonly logger = new Logger(CreativeImageGenerationWorker.name);
  readonly workerId = `${hostname()}:${process.pid}:creative-generation`;
  private running = false;

  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly provider: ImageGenerationProvider,
    private readonly mediaUpload: MediaAssetUploadService,
    private readonly config: CreativeGenerationConfigService,
  ) {}

  @Interval(5_000)
  async tick(): Promise<void> {
    if (!this.config.workerEnabled || this.running) return;
    this.running = true;
    try {
      await this.processPending();
    } catch (error) {
      this.logger.error(
        `creative generation cycle failed: ${(error as Error)?.name ?? typeof error}`,
      );
    } finally {
      this.running = false;
    }
  }

  /** One cycle: settle dead leases, claim up to the worker's concurrency, run them in parallel. */
  async processPending(): Promise<number> {
    await this.failExhaustedLeases();
    const ids: string[] = [];
    for (let slot = 0; slot < this.config.workerConcurrency; slot += 1) {
      const id = await this.claimOne();
      if (!id) break;
      ids.push(id);
    }
    await Promise.all(ids.map((id) => this.processOne(id)));
    return ids.length;
  }

  /**
   * One row per statement, so the per-tenant cap counts the claims this
   * worker just made. Oldest `available_at` first.
   */
  private async claimOne(): Promise<string | null> {
    const rows = returnedRows<{ id: string }>(
      await this.dataSource.query(
        `UPDATE social_creative_generations
            SET status = 'processing',
                locked_at = now(),
                locked_by = $1,
                started_at = COALESCE(started_at, now()),
                attempts = attempts + 1,
                updated_at = now()
          WHERE id = (
            SELECT candidate.id
              FROM social_creative_generations candidate
             WHERE (
                     (candidate.status = 'queued' AND candidate.available_at <= now())
                  OR (candidate.status = 'processing'
                      AND candidate.locked_at < now() - interval '${CREATIVE_GENERATION_LEASE}'
                      AND candidate.attempts < candidate.max_attempts)
                   )
               AND (
                     SELECT count(*)
                       FROM social_creative_generations running
                      WHERE running.tenant_id = candidate.tenant_id
                        AND running.status = 'processing'
                        AND running.locked_at >= now() - interval '${CREATIVE_GENERATION_LEASE}'
                   ) < $2
             ORDER BY candidate.available_at, candidate.id
             FOR UPDATE SKIP LOCKED
             LIMIT 1
          )
          RETURNING id`,
        [this.workerId, this.config.tenantConcurrency],
      ),
    );
    return rows[0]?.id ?? null;
  }

  private async failExhaustedLeases(): Promise<void> {
    await this.dataSource.query(
      `UPDATE social_creative_generations
          SET status = 'failed',
              failed_at = now(),
              error_code = 'timeout',
              error_retryable = true,
              locked_at = NULL,
              locked_by = NULL,
              updated_at = now()
        WHERE status = 'processing'
          AND locked_at < now() - interval '${CREATIVE_GENERATION_LEASE}'
          AND attempts >= max_attempts`,
    );
  }

  private async processOne(id: string): Promise<void> {
    const generation = await this.dataSource
      .getRepository(CreativeGenerationEntity)
      .findOneBy({
        id,
        status: 'processing' as CreativeGenerationStatus,
        lockedBy: this.workerId,
      });
    if (!generation) return;

    const scope: MediaAssetScope = {
      tenantId: generation.tenantId,
      workspaceId: generation.workspaceId,
      agencyClientId: generation.agencyClientId,
      companyContextId: generation.companyContextId,
    };
    const stored: MediaAssetEntity[] = [];
    let usage: ImageGenerationUsage | null = null;
    try {
      let result: ImageGenerationProviderResult;
      try {
        result = await this.provider.generate({
          prompt: generation.prompt,
          outputCount: generation.outputCount,
          aspectRatio: generation.aspectRatio,
          quality: generation.quality,
          references: [],
        });
      } catch (error) {
        throw this.sanitize(error);
      }
      usage = result.usage ?? null;
      const checked = this.checkOutputs(result.outputs, generation.outputCount);
      for (const [index, output] of checked.entries())
        stored.push(await this.store(scope, generation, index, output));

      if (!(await this.complete(generation, stored, usage))) {
        // Lease lost while working: the generation belongs to someone else now.
        await this.compensate(scope, stored);
      }
    } catch (error) {
      await this.compensate(scope, stored);
      await this.fail(generation, this.classify(error), usage);
    }
  }

  private async store(
    scope: MediaAssetScope,
    generation: CreativeGenerationEntity,
    index: number,
    output: { body: Buffer; mimeType: string },
  ) {
    try {
      return await this.mediaUpload.upload(scope, generation.requestedById, {
        file: {
          buffer: output.body,
          originalname: `imagem-gerada-${index + 1}.${EXTENSION[output.mimeType]}`,
          mimetype: output.mimeType,
          size: output.body.length,
        },
        source: CREATIVE_GENERATION_MEDIA_SOURCE,
        // Company Context lands in the row's own column (CS3.1.1); metadata
        // only groups the batch for cleanup tooling.
        metadata: { generationId: generation.id, outputIndex: index },
      });
    } catch (error) {
      // The shared upload refuses bytes whose metadata it cannot read; for a
      // generated output that is the provider's fault, not the caller's.
      if (error instanceof BadRequestException)
        throw this.failure('invalid_output', true);
      throw error;
    }
  }

  /**
   * Terminal success: the guarded status write and the output rows commit
   * together, so a generation is never `completed` without its outputs.
   */
  private complete(
    generation: CreativeGenerationEntity,
    stored: MediaAssetEntity[],
    usage: ImageGenerationUsage | null,
  ): Promise<boolean> {
    const accounted = this.usageColumns(generation, usage);
    return this.dataSource.transaction(async (manager) => {
      const updated = returnedRows<{ id: string }>(
        await manager.query(
          `UPDATE social_creative_generations
              SET status = 'completed',
                  completed_at = now(),
                  locked_at = NULL,
                  locked_by = NULL,
                  error_code = NULL,
                  error_retryable = NULL,
                  ${USAGE_SET}
            WHERE id = $1 AND status = 'processing' AND locked_by = $2
            RETURNING id`,
          [generation.id, this.workerId, ...accounted],
        ),
      );
      if (updated.length === 0) return false;
      await manager.getRepository(CreativeGenerationOutputEntity).insert(
        stored.map((asset, outputIndex) => ({
          generationId: generation.id,
          outputIndex,
          mediaAssetId: asset.id,
        })),
      );
      return true;
    });
  }

  /**
   * A retryable failure with attempts left goes back to `queued` with backoff;
   * anything else is `failed`. Both keep the attempt's usage: a provider call
   * that returned was paid for even if what it returned was unusable.
   */
  private async fail(
    generation: CreativeGenerationEntity,
    failure: CreativeImageGenerationException,
    usage: ImageGenerationUsage | null,
  ): Promise<void> {
    const retry =
      failure.retryable && generation.attempts < generation.maxAttempts;
    const delay = Math.min(
      RETRY_MAX_SECONDS,
      RETRY_BASE_SECONDS * 2 ** Math.max(0, generation.attempts - 1),
    );
    await this.dataSource.query(
      `UPDATE social_creative_generations
          SET status = $8::varchar,
              available_at = CASE WHEN $8::varchar = 'queued' THEN now() + make_interval(secs => $9::int) ELSE available_at END,
              failed_at = CASE WHEN $8::varchar = 'failed' THEN now() ELSE NULL END,
              error_code = $10,
              error_retryable = $11,
              locked_at = NULL,
              locked_by = NULL,
              ${USAGE_SET}
        WHERE id = $1 AND status = 'processing' AND locked_by = $2`,
      [
        generation.id,
        this.workerId,
        ...this.usageColumns(generation, usage),
        retry ? 'queued' : 'failed',
        delay,
        failure.code,
        failure.retryable,
      ],
    );
  }

  /**
   * Parameters `$3..$7` of `USAGE_SET`. Only the lease holder writes usage, so
   * merging metrics against the row read at claim time cannot lose an update.
   * Cost is summed in SQL (`numeric`, never a JS float); a provider answering
   * in a second currency is not summed into the first.
   */
  private usageColumns(
    generation: CreativeGenerationEntity,
    usage: ImageGenerationUsage | null,
  ): [string, string | null, string | null, string | null, string | null] {
    const metrics = { ...(generation.usageMetrics ?? {}) };
    for (const [key, value] of Object.entries(usage?.metrics ?? {}))
      if (
        /^[a-z0-9_.]{1,64}$/i.test(key) &&
        Number.isFinite(value) &&
        value >= 0 &&
        (key in metrics || Object.keys(metrics).length < 32)
      )
        metrics[key] = (metrics[key] ?? 0) + value;

    let amount: string | null = null;
    let currency: string | null = null;
    const cost = usage?.cost;
    if (
      cost &&
      /^\d{1,12}(\.\d{1,6})?$/.test(cost.amount) &&
      /^[A-Z]{3}$/.test(cost.currency)
    ) {
      if (generation.costCurrency && generation.costCurrency !== cost.currency)
        this.logger.warn(
          `generation=${generation.id} cost currency changed; not summed`,
        );
      else [amount, currency] = [cost.amount, cost.currency];
    } else if (cost) {
      this.logger.warn(`generation=${generation.id} malformed cost ignored`);
    }

    return [
      this.provider.id,
      usage?.model?.slice(0, 120) ?? null,
      Object.keys(metrics).length ? JSON.stringify(metrics) : null,
      amount,
      currency,
    ];
  }

  /**
   * Validates the whole batch before anything is stored. A provider that
   * returns more than was asked has broken the contract (and possibly the
   * bill); fewer is accepted, since providers may filter outputs.
   */
  private checkOutputs(
    outputs: readonly ImageGenerationProviderOutput[],
    requested: number,
  ) {
    if (
      !Array.isArray(outputs) ||
      outputs.length === 0 ||
      outputs.length > requested
    )
      throw this.failure('invalid_output', true);
    // `Array.isArray` widened `outputs` to `any[]`; re-assert the port type.
    return outputs.map((output: ImageGenerationProviderOutput | undefined) => {
      const body: unknown = output?.body;
      if (!Buffer.isBuffer(body) || body.length === 0)
        throw this.failure('invalid_output', true);
      const mimeType = detectMediaAssetMimeType(body);
      if (
        !mimeType ||
        !GENERATED_IMAGE_MIME_TYPES.has(mimeType) ||
        body.length > CREATIVE_IMAGE_MAX_BYTES
      )
        throw this.failure('invalid_output', true);
      return { body, mimeType };
    });
  }

  private async compensate(scope: MediaAssetScope, stored: MediaAssetEntity[]) {
    for (const asset of stored.splice(0))
      await this.mediaUpload.removeAfterFailedConsumerOperation(
        scope,
        asset.id,
      );
  }

  private sanitize(error: unknown): CreativeImageGenerationException {
    if (error instanceof ImageGenerationProviderError)
      return this.failure(error.code, error.retryable);
    // Unknown errors may carry vendor text, request ids or credentials: only
    // their class name is logged, and the generation records the generic code.
    this.logger.warn(
      `provider=${this.provider.id} unexpected ${(error as Error)?.name ?? typeof error}`,
    );
    return new CreativeImageGenerationException('failed', false);
  }

  /** Anything not already classified (storage, database) is a non-retryable `failed`. */
  private classify(error: unknown): CreativeImageGenerationException {
    if (error instanceof CreativeImageGenerationException) return error;
    this.logger.warn(
      `generation step failed: ${(error as Error)?.name ?? typeof error}`,
    );
    return new CreativeImageGenerationException('failed', false);
  }

  private failure(code: ImageGenerationFailureCode, retryable: boolean) {
    this.logger.warn(`provider=${this.provider.id} code=${code}`);
    return new CreativeImageGenerationException(code, retryable);
  }
}

/**
 * Shared SET fragment for usage: `$3` provider, `$4` model, `$5` merged
 * metrics (jsonb text), `$6`/`$7` cost amount and currency of THIS attempt.
 */
const USAGE_SET = `
  provider = $3,
  model = COALESCE($4, model),
  usage_metrics = COALESCE($5::jsonb, usage_metrics),
  cost_amount = CASE WHEN $6::numeric IS NULL THEN cost_amount
                     ELSE COALESCE(cost_amount, 0) + $6::numeric END,
  cost_currency = COALESCE(cost_currency, $7::char(3)),
  updated_at = now()`;
