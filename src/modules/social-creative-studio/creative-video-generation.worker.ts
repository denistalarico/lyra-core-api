import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import type { Readable } from 'node:stream';
import { DataSource } from 'typeorm';
import {
  detectMediaAssetMimeType,
  type MediaAssetEntity,
  type MediaAssetScope,
  MediaAssetUploadService,
} from '../../common/media-assets';
import { SocialBrandKitContextPort } from '../brand-kit/services/social-brand-kit-context.port';
import { CreativeGenerationConfigService } from './creative-generation-config';
import { CREATIVE_VIDEO_GENERATION_MEDIA_SOURCE } from './creative-retention';
import { CreativeVideoProviderRegistry } from './creative-video-generation.binding';
import { CreativeVideoGenerationConfigService } from './creative-video-generation-config';
import {
  type ProviderVideoSubmitted,
  type VideoGenerationFailureCode,
  type VideoGenerationProvider,
  VideoGenerationProviderError,
  type VideoGenerationReference,
  type VideoGenerationSubmitInput,
  type VideoGenerationUsage,
} from './creative-video-generation.provider';
import type { CreativeVideoCostSnapshot } from './creative-video-pricing';
import {
  CreativeVideoAvatarEntity,
  CreativeVideoGenerationEntity,
  CreativeVideoOperationEntity,
  CreativeVideoReferenceEntity,
} from './entities';

/**
 * Lease of ONE step (submit, recover, poll or download). Not the job: the
 * provider works for minutes with no lease held. The download of a 300 MB
 * Reel plus storage must fit inside it.
 */
export const CREATIVE_VIDEO_STEP_LEASE = '10 minutes';

const RETRY_BASE_SECONDS = 30;
const RETRY_MAX_SECONDS = 600;
/** Waiting for a provider slot is not a failure: short, fixed recheck. */
const SLOT_WAIT_SECONDS = 15;
const VIDEO_MAX_BYTES = 300 * 1024 * 1024;
const REFERENCE_MAX_BYTES = 16 * 1024 * 1024;
const POSTER_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function returnedRows<T>(result: unknown): T[] {
  if (!Array.isArray(result)) return [];
  if (result.length === 2 && Array.isArray(result[0])) return result[0] as T[];
  return result as T[];
}

/** A step outcome the loop turns into one terminal or scheduling write. */
class StepFailure extends Error {
  constructor(
    readonly code: VideoGenerationFailureCode,
    readonly retryable: boolean,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(`video_generation_${code}`);
  }
}

/**
 * CS4-B — drives queued Reel generations through their provider operations,
 * outside any HTTP request.
 *
 *   claim (SKIP LOCKED, short lease) → ONE step → release with next time
 *
 * Steps, chosen from the current operation (lowest sequence not succeeded):
 *   pending     → submit       stamp `submitting` FIRST, then call; the job id
 *                              is written the moment the answer arrives;
 *   submitting  → recover      the answer was lost: ask the provider whether
 *                              the job exists (`found` → adopt it, `absent`
 *                              → submit again, `unknown` → wait; never a
 *                              blind resubmit — a Reel is paid per job);
 *   submitted   → poll         status; succeeded → cost snapshot, next op;
 *   (all done)  → download     bytes → temporary media → `completed`.
 *
 * Callbacks never run a step: they only move `available_at` to now.
 *
 * A worker that lost its lease writes nothing terminal (every write is
 * guarded by `locked_by = me`), except the provider job id itself — that one
 * is guarded by the operation's own `submitting` state, because losing it is
 * exactly the double-charge this design exists to prevent.
 */
@Injectable()
export class CreativeVideoGenerationWorker {
  private readonly logger = new Logger(CreativeVideoGenerationWorker.name);
  readonly workerId = `${hostname()}:${process.pid}:creative-video`;
  private running = false;

  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly providers: CreativeVideoProviderRegistry,
    private readonly mediaUpload: MediaAssetUploadService,
    private readonly generationConfig: CreativeGenerationConfigService,
    private readonly config: CreativeVideoGenerationConfigService,
    private readonly brandKit: SocialBrandKitContextPort,
  ) {}

  @Interval(5_000)
  async tick(): Promise<void> {
    if (!this.generationConfig.workerEnabled || this.running) return;
    this.running = true;
    try {
      await this.processPending();
    } catch (error) {
      this.logger.error(
        `creative video cycle failed: ${(error as Error)?.name ?? typeof error}`,
      );
    } finally {
      this.running = false;
    }
  }

  async processPending(): Promise<number> {
    await this.failPastDeadline();
    const ids: string[] = [];
    for (let slot = 0; slot < this.config.workerConcurrency; slot += 1) {
      const id = await this.claimOne();
      if (!id) break;
      ids.push(id);
    }
    await Promise.all(ids.map((id) => this.step(id)));
    return ids.length;
  }

  /**
   * Due rows only. A queued row also needs a tenant slot (generations of the
   * tenant already in flight); a processing row is always continued — it may
   * hold a paid job.
   */
  private async claimOne(): Promise<string | null> {
    const rows = returnedRows<{ id: string }>(
      await this.dataSource.query(
        `UPDATE social_creative_video_generations
            SET status = 'processing',
                locked_at = now(),
                locked_by = $1,
                started_at = COALESCE(started_at, now()),
                updated_at = now()
          WHERE id = (
            SELECT candidate.id
              FROM social_creative_video_generations candidate
             WHERE candidate.status IN ('queued', 'processing')
               AND candidate.available_at <= now()
               AND candidate.deadline_at > now()
               AND (candidate.locked_at IS NULL
                    OR candidate.locked_at < now() - interval '${CREATIVE_VIDEO_STEP_LEASE}')
               AND (candidate.status = 'processing' OR (
                     SELECT count(*)
                       FROM social_creative_video_generations active
                      WHERE active.tenant_id = candidate.tenant_id
                        AND active.status = 'processing'
                   ) < $2)
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

  /**
   * Past the deadline and not mid-step: `timeout`. Non-terminal operations
   * are closed with it; a job the provider is still running is no longer
   * followed (its cost, if any, stays unknown — recorded as such).
   */
  private async failPastDeadline(): Promise<void> {
    await this.dataSource.query(
      `WITH expired AS (
         UPDATE social_creative_video_generations
            SET status = 'failed', failed_at = now(), error_code = 'timeout',
                error_retryable = true, locked_at = NULL, locked_by = NULL,
                updated_at = now()
          WHERE status IN ('queued', 'processing')
            AND deadline_at <= now()
            AND (locked_at IS NULL OR locked_at < now() - interval '${CREATIVE_VIDEO_STEP_LEASE}')
          RETURNING id)
       UPDATE social_creative_video_generation_operations op
          SET status = 'failed', failed_at = now(), error_code = 'timeout', updated_at = now()
         FROM expired
        WHERE op.generation_id = expired.id
          AND op.status IN ('pending', 'submitting', 'submitted')`,
    );
  }

  async step(id: string): Promise<void> {
    const generation = await this.dataSource
      .getRepository(CreativeVideoGenerationEntity)
      .findOneBy({ id, status: 'processing', lockedBy: this.workerId });
    if (!generation) return;
    const operations = await this.dataSource
      .getRepository(CreativeVideoOperationEntity)
      .find({ where: { generationId: id }, order: { sequence: 'ASC' } });
    const provider = this.providers.byId(generation.provider);
    const started = Date.now();
    let outcome = 'released';
    try {
      if (!provider) throw new StepFailure('unavailable', false);
      const current = operations.find((op) => op.status !== 'succeeded');
      if (!current)
        outcome = await this.download(generation, operations, provider);
      else if (current.status === 'pending')
        outcome = await this.submit(generation, operations, current, provider);
      else if (current.status === 'submitting')
        outcome = await this.recover(generation, operations, current, provider);
      else if (current.status === 'submitted')
        outcome = await this.poll(generation, operations, current, provider);
      else throw new StepFailure(current.errorCode ?? 'provider_failed', false);
    } catch (error) {
      const failure = this.classify(error);
      outcome = await this.handleFailure(generation, failure);
      this.logger.warn(
        `video generation=${generation.id} code=${failure.code} retryable=${failure.retryable} outcome=${outcome}`,
      );
    }
    this.logger.log(
      `video generation=${generation.id} provider=${generation.provider} outcome=${outcome} durationMs=${Date.now() - started}`,
    );
  }

  // ── submit ──────────────────────────────────────────────────────────────

  private async submit(
    generation: CreativeVideoGenerationEntity,
    operations: CreativeVideoOperationEntity[],
    operation: CreativeVideoOperationEntity,
    provider: VideoGenerationProvider,
  ): Promise<string> {
    // Kill switch / mode disabled: no NEW paid call, even mid-generation.
    if (!this.providers.canSubmit(provider.id))
      throw new StepFailure('unavailable', false);
    if (operation.submitAttempts >= this.config.maxSubmitAttempts)
      throw new StepFailure('provider_failed', false);
    // Fast path only; the authoritative check is inside the stamp.
    if (
      (await this.activeJobs(provider.id)) >= this.config.providerConcurrency
    ) {
      await this.release(generation, SLOT_WAIT_SECONDS, 'keep');
      return 'waiting_provider_slot';
    }
    // Bytes verified BEFORE the stamp: a missing reference costs nothing.
    const input = await this.submitInput(
      generation,
      operations,
      operation,
      true,
    );
    const dispatchKey = `lyra-video-${operation.id}-${operation.submitAttempts + 1}`;
    const stamped = await this.stampSubmitting(
      operation,
      provider,
      dispatchKey,
    );
    if (stamped === 'no_slot') {
      await this.release(generation, SLOT_WAIT_SECONDS, 'keep');
      return 'waiting_provider_slot';
    }
    if (stamped === 'lease_lost') return 'lease_lost';
    const context = { dispatchKey, callbackUrl: this.callbackUrl(provider) };
    let submitted: ProviderVideoSubmitted;
    try {
      submitted = await provider.submit(input, context);
    } catch (error) {
      const failure =
        error instanceof VideoGenerationProviderError
          ? error
          : // An unexpected throw after the request may have left: unknown.
            new VideoGenerationProviderError(
              'provider_failed',
              true,
              'unknown',
            );
      if (failure.dispatch === 'unknown') {
        await this.release(
          generation,
          this.backoff(generation, failure.retryAfterSeconds),
          'increment',
        );
        return 'submit_unknown';
      }
      await this.revertToPending(operation);
      throw new StepFailure(
        failure.code,
        failure.retryable,
        failure.retryAfterSeconds,
      );
    }
    await this.accept(generation, operation, submitted, input);
    return 'submitted';
  }

  private async recover(
    generation: CreativeVideoGenerationEntity,
    operations: CreativeVideoOperationEntity[],
    operation: CreativeVideoOperationEntity,
    provider: VideoGenerationProvider,
  ): Promise<string> {
    const input = await this.submitInput(
      generation,
      operations,
      operation,
      true,
    );
    const recovery = await provider.recover(
      input,
      {
        dispatchKey: operation.dispatchKey as string,
        callbackUrl: this.callbackUrl(provider),
      },
      operation.dispatchStartedAt as Date,
    );
    if (recovery.state === 'found') {
      await this.accept(generation, operation, recovery.submitted, input);
      return 'recovered';
    }
    if (recovery.state === 'absent') {
      await this.revertToPending(operation);
      await this.release(generation, 0, 'keep');
      return 'recovered_absent';
    }
    // Cannot prove either way: wait, and give up as `timeout` — never buy twice.
    if (generation.transientFailures + 1 > generation.maxStepRetries)
      throw new StepFailure('timeout', false);
    await this.release(generation, this.backoff(generation, null), 'increment');
    return 'recover_unknown';
  }

  /** Writes the job id the moment the provider answered (op guard, not lease). */
  private async accept(
    generation: CreativeVideoGenerationEntity,
    operation: CreativeVideoOperationEntity,
    submitted: ProviderVideoSubmitted,
    input: VideoGenerationSubmitInput,
  ) {
    const cost = this.safeCost(
      input,
      submitted.usage,
      submitted.model,
      generation,
    );
    const rows = returnedRows<{ id: string }>(
      await this.dataSource.query(
        `UPDATE social_creative_video_generation_operations
            SET status = 'submitted',
                provider_job_id = $2,
                provider_model = $3,
                provider_operation = $4,
                resolution = $5,
                accepted_at = now(),
                usage_metrics = COALESCE($6::jsonb, usage_metrics),
                ${COST_SET},
                updated_at = now()
          WHERE id = $1 AND status = 'submitting'
          RETURNING id`,
        [
          operation.id,
          submitted.jobId,
          submitted.model.slice(0, 120),
          submitted.operation.slice(0, 40),
          submitted.resolution.slice(0, 16),
          metricsJson(submitted.usage),
          ...costParams(cost),
        ],
      ),
    );
    if (!rows.length) return;
    await this.dataSource.query(
      `UPDATE social_creative_video_generations
          SET provider_job_id = CASE WHEN $3::int = 0 THEN COALESCE(provider_job_id, $4) ELSE provider_job_id END,
              provider_model = CASE WHEN $3::int = 0 THEN COALESCE(provider_model, $5) ELSE provider_model END,
              submitted_at = COALESCE(submitted_at, now()),
              transient_failures = 0,
              available_at = now() + make_interval(secs => $6::int),
              locked_at = NULL, locked_by = NULL, updated_at = now()
        WHERE id = $1 AND locked_by = $2`,
      [
        generation.id,
        this.workerId,
        operation.sequence,
        submitted.jobId,
        submitted.model.slice(0, 120),
        this.config.pollIntervalSeconds,
      ],
    );
  }

  /**
   * Reserves a provider slot and marks the attempt STARTED, atomically. The
   * per-provider advisory lock serializes every stamp of that provider across
   * all workers and processes, so "count active jobs, then claim one" cannot
   * race (two parallel steps of one worker used to both see a free slot).
   */
  private stampSubmitting(
    operation: CreativeVideoOperationEntity,
    provider: VideoGenerationProvider,
    dispatchKey: string,
  ): Promise<'stamped' | 'no_slot' | 'lease_lost'> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `creative_video_provider_slot:${provider.id}`,
      ]);
      const [active] = await manager.query<{ count: number }[]>(
        `SELECT count(*)::int AS count
           FROM social_creative_video_generation_operations
          WHERE provider = $1 AND status IN ('submitting', 'submitted')`,
        [provider.id],
      );
      if ((active?.count ?? 0) >= this.config.providerConcurrency)
        return 'no_slot';
      const rows = returnedRows<{ id: string }>(
        await manager.query(
          `UPDATE social_creative_video_generation_operations op
              SET status = 'submitting', dispatch_key = $3,
                  dispatch_started_at = now(),
                  submit_attempts = op.submit_attempts + 1, updated_at = now()
             FROM social_creative_video_generations generation
            WHERE op.id = $1 AND op.status = 'pending'
              AND generation.id = op.generation_id
              AND generation.status = 'processing' AND generation.locked_by = $2
            RETURNING op.id`,
          [operation.id, this.workerId, dispatchKey],
        ),
      );
      return rows.length > 0 ? 'stamped' : 'lease_lost';
    });
  }

  /** Only after PROOF that no job exists (refused / not sent / absent). */
  private async revertToPending(operation: CreativeVideoOperationEntity) {
    await this.dataSource.query(
      `UPDATE social_creative_video_generation_operations
          SET status = 'pending', updated_at = now()
        WHERE id = $1 AND status = 'submitting' AND provider_job_id IS NULL`,
      [operation.id],
    );
  }

  // ── poll ────────────────────────────────────────────────────────────────

  private async poll(
    generation: CreativeVideoGenerationEntity,
    operations: CreativeVideoOperationEntity[],
    operation: CreativeVideoOperationEntity,
    provider: VideoGenerationProvider,
  ): Promise<string> {
    const status = await provider.getStatus({
      jobId: operation.providerJobId as string,
      outputRef: operation.providerOutputRef,
    });
    if (status.state === 'pending') {
      await this.release(generation, this.config.pollIntervalSeconds, 'reset');
      return 'provider_pending';
    }
    const input = await this.submitInput(
      generation,
      operations,
      operation,
      false,
    );
    const usage = status.usage ?? storedUsage(operation);
    const cost = this.safeCost(
      input,
      usage,
      operation.providerModel ?? '',
      generation,
    );
    if (status.state === 'failed') {
      await this.closeOperation(operation, 'failed', usage, cost, {
        errorCode: status.code,
      });
      throw new StepFailure(status.code, false);
    }
    await this.closeOperation(operation, 'succeeded', usage, cost, {
      outputRef: status.outputRef,
      durationSeconds: status.durationSeconds,
    });
    await this.release(generation, 0, 'reset');
    return 'operation_succeeded';
  }

  private async closeOperation(
    operation: CreativeVideoOperationEntity,
    status: 'succeeded' | 'failed',
    usage: VideoGenerationUsage | null,
    cost: CreativeVideoCostSnapshot | null,
    extra: {
      outputRef?: string | null;
      durationSeconds?: number | null;
      errorCode?: VideoGenerationFailureCode;
    },
  ) {
    await this.dataSource.query(
      `UPDATE social_creative_video_generation_operations
          SET status = $2::varchar,
              completed_at = CASE WHEN $2::varchar = 'succeeded' THEN now() END,
              failed_at = CASE WHEN $2::varchar = 'failed' THEN now() END,
              error_code = $3,
              provider_output_ref = COALESCE($4, provider_output_ref),
              output_duration_seconds = COALESCE($5::numeric, output_duration_seconds),
              usage_metrics = COALESCE($6::jsonb, usage_metrics),
              ${COST_SET},
              updated_at = now()
        WHERE id = $1 AND status = 'submitted'`,
      [
        operation.id,
        status,
        extra.errorCode ?? null,
        extra.outputRef ?? null,
        extra.durationSeconds === null || extra.durationSeconds === undefined
          ? null
          : extra.durationSeconds.toFixed(3),
        metricsJson(usage),
        ...costParams(cost),
      ],
    );
  }

  // ── download ────────────────────────────────────────────────────────────

  private async download(
    generation: CreativeVideoGenerationEntity,
    operations: CreativeVideoOperationEntity[],
    provider: VideoGenerationProvider,
  ): Promise<string> {
    const last = operations[operations.length - 1];
    const scope = scopeOf(generation);
    const result = await provider.getResult({
      jobId: last.providerJobId as string,
      outputRef: last.providerOutputRef,
    });
    const mime = detectMediaAssetMimeType(result.video);
    if (mime !== 'video/mp4' || result.video.length > VIDEO_MAX_BYTES)
      // Paid output that cannot be used: final, never re-bought.
      throw new StepFailure('invalid_output', false);
    const stored: MediaAssetEntity[] = [];
    try {
      const video = await this.store(
        scope,
        generation,
        result.video,
        'reel-gerado.mp4',
        'video/mp4',
      );
      stored.push(video);
      const posterMime = result.poster
        ? detectMediaAssetMimeType(result.poster)
        : null;
      if (result.poster && posterMime && POSTER_MIME_TYPES.has(posterMime))
        try {
          stored.push(
            await this.store(
              scope,
              generation,
              result.poster,
              'capa',
              posterMime,
            ),
          );
        } catch {
          // The cover is a convenience; the Reel never fails over it.
        }
      const measured =
        video.durationMs !== null && video.durationMs !== undefined
          ? Number(video.durationMs) / 1000
          : null;
      const reported =
        last.outputDurationSeconds === null
          ? null
          : Number(last.outputDurationSeconds);
      const actual = measured ?? reported;
      if (actual === null) throw new StepFailure('invalid_output', false);
      const planned = operations.reduce(
        (sum, op) => sum + (op.durationSeconds ?? 0),
        0,
      );
      if (
        generation.mode === 'generative_reel' &&
        Math.abs(actual - planned) > 1.5
      )
        // Extensions are expected to return the whole continued video. A
        // mismatch is kept (the output is paid and real) and made visible.
        this.logger.warn(
          `video generation=${generation.id} duration mismatch planned=${planned} actual=${actual.toFixed(3)}`,
        );
      const hasAudio =
        generation.mode === 'ugc_avatar'
          ? true
          : generation.audioRequested && operations.length === 1;
      const completed = await this.complete(
        generation,
        stored,
        actual,
        hasAudio,
      );
      if (!completed) {
        await this.compensate(scope, stored);
        return 'lease_lost';
      }
      return 'completed';
    } catch (error) {
      await this.compensate(scope, stored).catch(() => undefined);
      throw error;
    }
  }

  private async store(
    scope: MediaAssetScope,
    generation: CreativeVideoGenerationEntity,
    body: Buffer,
    name: string,
    mimeType: string,
  ) {
    try {
      return await this.mediaUpload.upload(scope, generation.requestedById, {
        file: {
          buffer: body,
          originalname: name,
          mimetype: mimeType,
          size: body.length,
        },
        source: CREATIVE_VIDEO_GENERATION_MEDIA_SOURCE,
        metadata: { videoGenerationId: generation.id },
      });
    } catch (error) {
      // Unreadable metadata = the provider's bytes are broken; paid, final.
      if (error instanceof BadRequestException)
        throw new StepFailure('invalid_output', false);
      throw new StepFailure('unavailable', true);
    }
  }

  private complete(
    generation: CreativeVideoGenerationEntity,
    stored: MediaAssetEntity[],
    actualSeconds: number,
    hasAudio: boolean,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const rows = returnedRows<{ id: string }>(
        await manager.query(
          `UPDATE social_creative_video_generations
              SET status = 'completed', completed_at = now(),
                  output_media_asset_id = $3, poster_media_asset_id = $4,
                  duration_actual_seconds = $5::numeric, has_audio = $6,
                  error_code = NULL, error_retryable = NULL,
                  ${TOTAL_COST_SET},
                  locked_at = NULL, locked_by = NULL, updated_at = now()
            WHERE id = $1 AND status = 'processing' AND locked_by = $2
            RETURNING id`,
          [
            generation.id,
            this.workerId,
            stored[0].id,
            stored[1]?.id ?? null,
            actualSeconds.toFixed(3),
            hasAudio,
          ],
        ),
      );
      return rows.length > 0;
    });
  }

  private async compensate(scope: MediaAssetScope, stored: MediaAssetEntity[]) {
    for (const asset of stored.splice(0))
      await this.mediaUpload.removeAfterFailedConsumerOperation(
        scope,
        asset.id,
      );
  }

  // ── inputs ──────────────────────────────────────────────────────────────

  /**
   * The provider input of `operation`, rebuilt from the FROZEN rows only
   * (never the current Planner/Brand Kit). `withBytes=false` builds the same
   * shape without reading binaries (cost computation).
   */
  private async submitInput(
    generation: CreativeVideoGenerationEntity,
    operations: CreativeVideoOperationEntity[],
    operation: CreativeVideoOperationEntity,
    withBytes: boolean,
  ): Promise<VideoGenerationSubmitInput> {
    const references = await this.dataSource
      .getRepository(CreativeVideoReferenceEntity)
      .find({
        where: { generationId: generation.id },
        order: { position: 'ASC' },
      });
    const bytes = withBytes
      ? await this.readReferences(scopeOf(generation), generation, references)
      : references.map(() => ({ mimeType: '', body: Buffer.alloc(0) }));

    if (generation.mode === 'ugc_avatar') {
      const avatar = await this.dataSource
        .getRepository(CreativeVideoAvatarEntity)
        .findOneBy({ id: generation.avatarId as string });
      if (!avatar || !avatar.providerVoiceId)
        throw new StepFailure('avatar_unavailable', false);
      const background = references.findIndex(
        (ref) => ref.purpose === 'background',
      );
      return {
        kind: 'generate',
        mode: 'ugc_avatar',
        script: generation.script as string,
        avatar: {
          providerAvatarId: avatar.providerAvatarId,
          providerVoiceId: avatar.providerVoiceId,
          avatarType: avatar.avatarType,
        },
        language: generation.language,
        aspectRatio: generation.aspectRatio,
        quality: generation.quality,
        backgroundImage: background >= 0 ? bytes[background] : null,
      };
    }
    if (operation.kind === 'extend') {
      const previous = operations.find(
        (op) => op.sequence === operation.sequence - 1,
      );
      if (!previous?.providerJobId)
        throw new StepFailure('provider_failed', false);
      return {
        kind: 'extend',
        mode: 'generative_reel',
        prompt: generation.effectivePrompt as string,
        durationSeconds: operation.durationSeconds as number,
        quality: generation.quality,
        previous: {
          jobId: previous.providerJobId,
          outputRef: previous.providerOutputRef,
        },
      };
    }
    return {
      kind: 'generate',
      mode: 'generative_reel',
      inputKind: generation.inputKind as 'text' | 'image' | 'reference',
      prompt: generation.effectivePrompt as string,
      durationSeconds: operation.durationSeconds as number,
      aspectRatio: generation.aspectRatio,
      quality: generation.quality,
      audio: generation.audioRequested,
      images: bytes.filter(
        (_, index) => references[index].purpose !== 'background',
      ),
    };
  }

  /**
   * Frozen references → bytes, each re-hashed against its checksum. Gone,
   * moved out of scope or other bytes → `reference_unavailable`, final and
   * before any provider call. A storage outage is retryable (nothing sent).
   */
  private async readReferences(
    scope: MediaAssetScope,
    generation: CreativeVideoGenerationEntity,
    rows: CreativeVideoReferenceEntity[],
  ): Promise<VideoGenerationReference[]> {
    const references: VideoGenerationReference[] = [];
    for (const row of rows) {
      let body: Buffer | null;
      try {
        if (row.brandKitAssetId) {
          body =
            (await this.brandKit.readAssetContent(scope, row.brandKitAssetId))
              ?.body ?? null;
        } else {
          const { file } = await this.mediaUpload.getContent(
            scope,
            row.mediaAssetId as string,
          );
          body = await readAll(file.body);
        }
      } catch (error) {
        if (error instanceof NotFoundException) body = null;
        else {
          this.logger.warn(
            `video generation=${generation.id} reference=${row.position} read failed: ${(error as Error)?.name ?? typeof error}`,
          );
          throw new StepFailure('unavailable', true);
        }
      }
      if (
        !body ||
        body.length === 0 ||
        body.length > REFERENCE_MAX_BYTES ||
        createHash('sha256').update(body).digest('hex') !== row.checksum ||
        detectMediaAssetMimeType(body) !== row.mimeType
      )
        throw new StepFailure('reference_unavailable', false);
      references.push({ mimeType: row.mimeType, body });
    }
    return references;
  }

  private callbackUrl(provider: VideoGenerationProvider): string | null {
    const base = this.config.callbackBaseUrl;
    if (!base || !provider.callbacksVerifiable) return null;
    return `${base}/social/creative-studio/video-provider-callbacks/${provider.id}`;
  }

  private async activeJobs(providerId: string): Promise<number> {
    const [row] = await this.dataSource.query<{ count: number }[]>(
      `SELECT count(*)::int AS count
         FROM social_creative_video_generation_operations
        WHERE provider = $1 AND status IN ('submitting', 'submitted')`,
      [providerId],
    );
    return row?.count ?? 0;
  }

  private safeCost(
    input: VideoGenerationSubmitInput,
    usage: VideoGenerationUsage | null,
    model: string,
    generation: CreativeVideoGenerationEntity,
  ): CreativeVideoCostSnapshot | null {
    const provider = this.providers.byId(generation.provider);
    try {
      return provider?.cost(input, usage, model) ?? null;
    } catch {
      this.logger.warn(`video generation=${generation.id} cost not computable`);
      return null;
    }
  }

  // ── scheduling & failure ────────────────────────────────────────────────

  private backoff(
    generation: CreativeVideoGenerationEntity,
    retryAfterSeconds: number | null,
  ) {
    return Math.min(
      RETRY_MAX_SECONDS,
      Math.max(
        RETRY_BASE_SECONDS * 2 ** Math.max(0, generation.transientFailures),
        retryAfterSeconds !== null && Number.isFinite(retryAfterSeconds)
          ? Math.ceil(retryAfterSeconds)
          : 0,
      ),
    );
  }

  private async release(
    generation: CreativeVideoGenerationEntity,
    delaySeconds: number,
    transient: 'keep' | 'reset' | 'increment',
  ) {
    await this.dataSource.query(
      `UPDATE social_creative_video_generations
          SET locked_at = NULL, locked_by = NULL,
              available_at = now() + make_interval(secs => $3::int),
              transient_failures = CASE $4::varchar
                WHEN 'reset' THEN 0
                WHEN 'increment' THEN transient_failures + 1
                ELSE transient_failures END,
              updated_at = now()
        WHERE id = $1 AND locked_by = $2`,
      [generation.id, this.workerId, Math.round(delaySeconds), transient],
    );
  }

  /**
   * Retryable failure with budget left → back off and keep the generation.
   * Anything else → `failed`; non-terminal operations close with the same
   * code; the generation's cost is the sum of what was already accounted.
   */
  private async handleFailure(
    generation: CreativeVideoGenerationEntity,
    failure: StepFailure,
  ): Promise<string> {
    if (
      failure.retryable &&
      generation.transientFailures + 1 <= generation.maxStepRetries
    ) {
      await this.release(
        generation,
        this.backoff(generation, failure.retryAfterSeconds),
        'increment',
      );
      return 'retry_scheduled';
    }
    await this.dataSource.transaction(async (manager) => {
      const rows = returnedRows<{ id: string }>(
        await manager.query(
          `UPDATE social_creative_video_generations
              SET status = 'failed', failed_at = now(),
                  error_code = $3, error_retryable = $4,
                  ${TOTAL_COST_SET},
                  locked_at = NULL, locked_by = NULL, updated_at = now()
            WHERE id = $1 AND status = 'processing' AND locked_by = $2
            RETURNING id`,
          [generation.id, this.workerId, failure.code, failure.retryable],
        ),
      );
      if (!rows.length) return;
      // A `submitting` operation keeps its doubt on record: failing it here
      // records that Lyra stopped following it, not that no job exists.
      await manager.query(
        `UPDATE social_creative_video_generation_operations
            SET status = 'failed', failed_at = now(),
                error_code = COALESCE(error_code, $2), updated_at = now()
          WHERE generation_id = $1 AND status IN ('pending', 'submitting', 'submitted')`,
        [generation.id, failure.code],
      );
    });
    return 'failed';
  }

  private classify(error: unknown): StepFailure {
    if (error instanceof StepFailure) return error;
    if (error instanceof VideoGenerationProviderError)
      return new StepFailure(
        error.code,
        error.retryable,
        error.retryAfterSeconds,
      );
    // Database/storage/unknown: name only (messages may carry SQL or URLs).
    this.logger.warn(
      `video step failed: ${(error as Error)?.name ?? typeof error}`,
    );
    return new StepFailure('provider_failed', true);
  }
}

/**
 * Cost columns `$7..$13` of an operation write: units, unit kind, unit
 * price, pricing version, amount, currency, source. NULL amount = keep what
 * is there (a status without units never erases the submit's snapshot).
 */
const COST_SET = `
  billed_units = CASE WHEN $11::numeric IS NULL THEN billed_units ELSE $7::numeric END,
  unit_kind = CASE WHEN $11::numeric IS NULL THEN unit_kind ELSE $8 END,
  unit_price = CASE WHEN $11::numeric IS NULL THEN unit_price ELSE $9::numeric END,
  pricing_version = CASE WHEN $11::numeric IS NULL THEN pricing_version ELSE $10 END,
  cost_amount = COALESCE($11::numeric, cost_amount),
  cost_currency = CASE WHEN $11::numeric IS NULL THEN cost_currency ELSE $12::char(3) END,
  cost_source = CASE WHEN $11::numeric IS NULL THEN cost_source ELSE $13 END`;

function costParams(cost: CreativeVideoCostSnapshot | null) {
  return [
    cost?.units ?? null,
    cost?.unitKind ?? null,
    cost?.unitPrice ?? null,
    cost?.pricingVersion ?? null,
    cost?.costAmount ?? null,
    cost?.costCurrency ?? null,
    cost?.costSource ?? null,
  ];
}

/**
 * Generation total = exact SQL sum of its operations' snapshots. Mixed
 * currencies are never summed (the total stays NULL; the ledger keeps both).
 */
const TOTAL_COST_SET = `
  cost_amount = (SELECT CASE WHEN count(DISTINCT op.cost_currency) = 1 THEN sum(op.cost_amount) END
                   FROM social_creative_video_generation_operations op
                  WHERE op.generation_id = $1 AND op.cost_amount IS NOT NULL),
  cost_currency = (SELECT CASE WHEN count(DISTINCT op.cost_currency) = 1 THEN min(op.cost_currency) END
                     FROM social_creative_video_generation_operations op
                    WHERE op.generation_id = $1 AND op.cost_amount IS NOT NULL)`;

function metricsJson(usage: VideoGenerationUsage | null): string | null {
  if (!usage) return null;
  const metrics: Record<string, number> = {};
  for (const [key, value] of Object.entries(usage.metrics))
    if (/^[a-z0-9_.]{1,64}$/i.test(key) && Number.isFinite(value) && value >= 0)
      metrics[key] = value;
  return Object.keys(metrics).length ? JSON.stringify(metrics) : null;
}

function storedUsage(
  operation: CreativeVideoOperationEntity,
): VideoGenerationUsage | null {
  return operation.usageMetrics
    ? { metrics: operation.usageMetrics, reportedCost: null }
    : null;
}

function scopeOf(generation: CreativeVideoGenerationEntity): MediaAssetScope {
  return {
    tenantId: generation.tenantId,
    workspaceId: generation.workspaceId,
    agencyClientId: generation.agencyClientId,
    companyContextId: generation.companyContextId,
  };
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  return Buffer.concat(chunks);
}
