import { Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { CreativeVideoGenerationConfigService } from './creative-video-generation-config';
import {
  type ProviderVideoJob,
  type ProviderVideoRecovery,
  type ProviderVideoResult,
  type ProviderVideoStatus,
  type ProviderVideoSubmitted,
  type VideoGenerationCallbackRequest,
  type VideoGenerationFailureCode,
  VideoGenerationProvider,
  VideoGenerationProviderError,
  type VideoGenerationSubmitContext,
  type VideoGenerationSubmitInput,
  type VideoGenerationUsage,
  type VideoProviderCapabilities,
  type VideoProviderDiagnostics,
} from './creative-video-generation.provider';
import {
  type CreativeVideoCostSnapshot,
  viduCostSnapshot,
  viduPricing,
} from './creative-video-pricing';
import {
  dataUri,
  downloadProviderFile,
  jsonOrNull,
  networkFailure,
  nonNegative,
  providerError,
  record,
  token,
} from './video-provider-http';

/**
 * CS4-B — Vidu adapter for `generative_reel` (platform.vidu.com, audited
 * 2026-10). Everything Vidu-specific lives here: endpoints, `Token` auth,
 * model names, credits, callback signature.
 *
 *   text      → POST /ent/v2/text2video       viduq3-turbo, 1–16 s, aspect_ratio 9:16
 *   image     → POST /ent/v2/img2video        viduq3-turbo, 1–16 s; NO aspect_ratio
 *                                             (the start frame decides; the domain
 *                                             only accepts a 9:16 frame)
 *   reference → POST /ent/v2/reference2video  viduq3-turbo, 3–16 s, 1–7 images, 9:16
 *   extend    → POST /ent/v2/extend           viduq2-turbo (only Q2 models extend),
 *                                             +1–7 s, source video 4–60 s
 *   status    → GET  /ent/v2/tasks/{id}/creations
 *                    state created|queueing|processing|success|failed, `credits`,
 *                    creations[].url / cover_url valid 24 h
 *   recover   → GET  /ent/v2/tasks (created_at window), matched by `payload`
 *   balance   → GET  /ent/v2/credits
 *
 * Images travel as Base64 data URIs (accepted by every endpoint, ≤ 50 MB):
 * no Lyra URL is ever exposed to the provider.
 *
 * Audio: Q3 generates synchronized audio natively (`audio: true`); the
 * extension endpoint has no audio parameter, so the domain only asks for
 * audio on single-operation Reels (`capabilities().audio` + duration plan).
 */
const VIDU_BASE_URL = 'https://api.vidu.com';
const GENERATE_MODEL = 'viduq3-turbo';
const EXTEND_MODEL = 'viduq2-turbo';
const RESOLUTION = { standard: '720p', high: '1080p' } as const;
/** extend's prompt limit is 2,000 characters. */
const EXTEND_PROMPT_MAX = 2000;
const VIDEO_MAX_BYTES = 300 * 1024 * 1024;
const POSTER_MAX_BYTES = 10 * 1024 * 1024;
/** Callback `Date` older/newer than this is refused (replay window). */
const CALLBACK_CLOCK_SKEW_MS = 5 * 60_000;

const ENDPOINT: Record<'text' | 'image' | 'reference', string> = {
  text: '/ent/v2/text2video',
  image: '/ent/v2/img2video',
  reference: '/ent/v2/reference2video',
};
const OPERATION: Record<'text' | 'image' | 'reference', string> = {
  text: 'text2video',
  image: 'img2video',
  reference: 'reference2video',
};

const POLICY = new Set([
  'TaskPromptPolicyViolation',
  'CreationPolicyViolation',
  'AuditSubmitIllegal',
  'PhotoAuditNotPass',
  'AuditFailed',
]);
const INPUT_REFUSED = new Set([
  'ImageFormatInvalid',
  'ImageSizeInvalid',
  'PageSizeOutOfRange',
  'ImageCheckBodyJointsFailed',
  'ImageCheckFaceFailed',
  'ImageObjectsUndetected',
  'FaceDetectFailure',
  'FaceDetectNotPass',
  'NoFaceDetected',
  'MultiFaceDetected',
]);
const THROTTLED = new Set([
  'TooManyRequests',
  'OperationInProcess',
  'QuotaExceeded',
  'SystemThrottling',
]);

export class ViduVideoGenerationProvider extends VideoGenerationProvider {
  readonly id = 'vidu';
  readonly mode = 'generative_reel' as const;
  private readonly logger = new Logger(ViduVideoGenerationProvider.name);
  private readonly pricing: ReturnType<typeof viduPricing>;

  constructor(private readonly config: CreativeVideoGenerationConfigService) {
    super();
    this.pricing = viduPricing(config.viduCreditPriceOverride);
  }

  get pricingVersion() {
    return this.pricing.version;
  }

  /** Vidu signs every callback with the API token (HMAC-SHA256). */
  override get callbacksVerifiable() {
    return true;
  }

  override capabilities(): VideoProviderCapabilities {
    return {
      nativeMaxSeconds: 16,
      nativeMinSeconds: 3,
      extension: { minSeconds: 1, maxSeconds: 7 },
      extensionSourceMaxSeconds: 60,
      // Vidu accepts 7; Lyra's reference selector freezes at most 6.
      maxReferenceImages: 6,
      audio: true,
    };
  }

  async submit(
    input: VideoGenerationSubmitInput,
    context: VideoGenerationSubmitContext,
  ): Promise<ProviderVideoSubmitted> {
    if (input.mode !== 'generative_reel')
      throw new VideoGenerationProviderError('unavailable', false, 'not_sent');
    const { path, body, model, operation } =
      input.kind === 'extend'
        ? await this.extendRequest(input)
        : this.generateRequest(input);
    const payload = {
      ...body,
      // Echoed by Vidu on every task: how a lost submit is found again.
      payload: context.dispatchKey,
      ...(context.callbackUrl ? { callback_url: context.callbackUrl } : {}),
    };
    const started = Date.now();
    let response: Response;
    try {
      response = await this.call(path, { method: 'POST', body: payload });
    } catch (error) {
      throw this.logged(networkFailure(error), 'network', started);
    }
    const json = record(await jsonOrNull(response));
    if (!response.ok)
      throw this.logged(
        this.httpFailure(response, json),
        `http_${response.status}`,
        started,
      );
    const jobId = token(json?.task_id ?? json?.id);
    if (!jobId)
      // 2xx without an id: a task may exist; the worker must reconcile.
      throw this.logged(
        new VideoGenerationProviderError('provider_failed', true, 'unknown'),
        'missing_task_id',
        started,
      );
    this.logger.log(
      `provider=vidu op=${operation} model=${model} http=${response.status} state=${token(json?.state) ?? '-'} durationMs=${Date.now() - started}`,
    );
    return {
      jobId,
      model: token(json?.model) ?? model,
      operation,
      resolution: RESOLUTION[input.quality],
      usage: usageOf(json),
    };
  }

  private generateRequest(
    input: Extract<
      VideoGenerationSubmitInput,
      { kind: 'generate'; mode: 'generative_reel' }
    >,
  ) {
    const body: Record<string, unknown> = {
      model: GENERATE_MODEL,
      prompt: input.prompt,
      duration: input.durationSeconds,
      resolution: RESOLUTION[input.quality],
      audio: input.audio,
      off_peak: false,
    };
    if (input.inputKind !== 'image') body.aspect_ratio = input.aspectRatio;
    if (input.inputKind !== 'text')
      body.images = input.images.map((image) =>
        dataUri(image.mimeType, image.body),
      );
    return {
      path: ENDPOINT[input.inputKind],
      body,
      model: GENERATE_MODEL,
      operation: OPERATION[input.inputKind],
    };
  }

  /**
   * The source is the previous operation's own output, passed by Vidu's ids
   * plus a fresh URL read from that task (outputs live 24 h). The URL stays
   * inside this adapter.
   */
  private async extendRequest(
    input: Extract<VideoGenerationSubmitInput, { kind: 'extend' }>,
  ) {
    const previous = await this.task(input.previous.jobId);
    const creation = firstCreation(previous);
    const url = typeof creation?.url === 'string' ? creation.url : null;
    const creationId = input.previous.outputRef ?? token(creation?.id);
    if (!url || !creationId)
      throw new VideoGenerationProviderError(
        'provider_failed',
        false,
        'not_sent',
      );
    return {
      path: '/ent/v2/extend',
      body: {
        model: EXTEND_MODEL,
        video_creation_id: creationId,
        video_url: url,
        prompt: input.prompt.slice(0, EXTEND_PROMPT_MAX),
        duration: input.durationSeconds,
        resolution: RESOLUTION[input.quality],
      },
      model: EXTEND_MODEL,
      operation: 'extend',
    };
  }

  /**
   * Lists tasks created since the lost submit and looks for our `payload`.
   * `absent` only when the listing is complete and well-formed; any doubt is
   * `unknown`, and the worker then never resubmits.
   */
  async recover(
    input: VideoGenerationSubmitInput,
    context: VideoGenerationSubmitContext,
    since: Date,
  ): Promise<ProviderVideoRecovery> {
    const from = new Date(since.getTime() - 60_000).toISOString();
    const query = new URLSearchParams({
      'created_at.from': from,
      'pager.page': '0',
      'pager.pagesz': '100',
    });
    let response: Response;
    try {
      response = await this.call(`/ent/v2/tasks?${query.toString()}`, {
        method: 'GET',
      });
    } catch {
      return { state: 'unknown' };
    }
    if (!response.ok) return { state: 'unknown' };
    const json = record(await jsonOrNull(response));
    const tasks = Array.isArray(json?.tasks)
      ? json.tasks
      : Array.isArray(json?.data)
        ? json.data
        : null;
    if (!tasks) return { state: 'unknown' };
    const match = tasks
      .map(record)
      .find((task) => task?.payload === context.dispatchKey);
    if (match) {
      const jobId = token(match.id ?? match.task_id);
      if (!jobId) return { state: 'unknown' };
      const generate =
        input.kind === 'generate' && input.mode === 'generative_reel';
      return {
        state: 'found',
        submitted: {
          jobId,
          model:
            token(match.model) ?? (generate ? GENERATE_MODEL : EXTEND_MODEL),
          operation:
            input.kind === 'extend'
              ? 'extend'
              : generate
                ? OPERATION[input.inputKind]
                : 'unknown',
          resolution: RESOLUTION[input.quality],
          usage: usageOf(match),
        },
      };
    }
    const more = json?.next_page_token ?? json?.page_token;
    return tasks.length < 100 && !more
      ? { state: 'absent' }
      : { state: 'unknown' };
  }

  async getStatus(job: ProviderVideoJob): Promise<ProviderVideoStatus> {
    const json = await this.task(job.jobId);
    const state = json?.state;
    if (state === 'success') {
      const creation = firstCreation(json);
      return {
        state: 'succeeded',
        outputRef: token(creation?.id),
        durationSeconds: nonNegative(creation?.duration),
        usage: usageOf(json),
      };
    }
    if (state === 'failed')
      return {
        state: 'failed',
        code: failureOf(
          typeof json?.err_code === 'string' ? json.err_code : '',
        ),
        usage: usageOf(json),
      };
    return { state: 'pending' };
  }

  async getResult(job: ProviderVideoJob): Promise<ProviderVideoResult> {
    const json = await this.task(job.jobId);
    const creation = firstCreation(json);
    if (json?.state !== 'success' || typeof creation?.url !== 'string')
      throw new VideoGenerationProviderError('invalid_output', false);
    const video = await downloadProviderFile(
      creation.url,
      VIDEO_MAX_BYTES,
      this.config.downloadTimeoutMs,
    );
    let poster: Buffer | null = null;
    if (typeof creation.cover_url === 'string')
      // The poster is a convenience: its loss never fails a paid video.
      poster = await downloadProviderFile(
        creation.cover_url,
        POSTER_MAX_BYTES,
        60_000,
      ).catch(() => null);
    return { video, poster };
  }

  cost(
    _input: VideoGenerationSubmitInput,
    usage: VideoGenerationUsage | null,
  ): CreativeVideoCostSnapshot | null {
    const credits = usage?.metrics.credits;
    if (credits === undefined || !Number.isSafeInteger(credits) || credits < 0)
      return null;
    return viduCostSnapshot(credits, this.pricing);
  }

  /**
   * Vidu signs callbacks with HMAC-SHA256 keyed by the API token used to
   * create the task (callback-signature doc):
   *   method \n uri \n canonical_query \n access_key \n Date \n signed_headers
   * where signed_headers is `Key:value\n` per name in X-HMAC-SIGNED-HEADERS,
   * base64-encoded. `Date` must be within ±5 min. Only the task id is taken;
   * the worker re-reads the task through the authenticated API.
   */
  override parseCallback(
    request: VideoGenerationCallbackRequest,
  ): { jobId: string } | null {
    const header = (name: string) => {
      const value = request.headers[name.toLowerCase()];
      return Array.isArray(value) ? value[0] : value;
    };
    const signature = header('x-hmac-signature');
    const accessKey = header('x-hmac-access-key');
    const date = header('date');
    const signedNames = header('x-hmac-signed-headers');
    if (
      !signature ||
      !accessKey ||
      !date ||
      header('x-hmac-algorithm')?.toLowerCase() !== 'hmac-sha256' ||
      !request.rawBody
    )
      return null;
    const sentAt = Date.parse(date);
    if (
      !Number.isFinite(sentAt) ||
      Math.abs(Date.now() - sentAt) > CALLBACK_CLOCK_SKEW_MS
    )
      return null;
    const signedHeaders = (signedNames ?? '')
      .split(';')
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name) => `${name}:${header(name) ?? ''}\n`)
      .join('');
    const canonicalQuery = [...new URLSearchParams(request.query).entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([key, value]) =>
          `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
      )
      .join('&');
    const signing = [
      request.method.toUpperCase(),
      request.path,
      canonicalQuery,
      accessKey,
      date,
      signedHeaders,
    ].join('\n');
    const expected = createHmac('sha256', this.config.viduApiKey)
      .update(signing)
      .digest();
    const received = Buffer.from(signature, 'base64');
    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    )
      return null;
    let body: Record<string, unknown> | null = null;
    try {
      body = record(JSON.parse(request.rawBody.toString('utf8')));
    } catch {
      return null;
    }
    const jobId = token(body?.id ?? body?.task_id);
    return jobId ? { jobId } : null;
  }

  override async diagnostics(): Promise<VideoProviderDiagnostics> {
    const response = await this.call('/ent/v2/credits', { method: 'GET' });
    const json = record(await jsonOrNull(response));
    const remains = Array.isArray(json?.remains)
      ? json.remains.map(record)
      : [];
    let credits = 0;
    let limit: number | null = null;
    let current: number | null = null;
    for (const remain of remains) {
      credits += nonNegative(remain?.credit_remain) ?? 0;
      limit = Math.max(limit ?? 0, nonNegative(remain?.concurrency_limit) ?? 0);
      current = Math.max(
        current ?? 0,
        nonNegative(remain?.current_concurrency) ?? 0,
      );
    }
    return {
      provider: this.id,
      balance: response.ok
        ? { amount: String(credits), unit: 'vidu_credit' }
        : null,
      concurrency: response.ok ? { limit, current } : null,
    };
  }

  private async task(jobId: string) {
    let response: Response;
    try {
      response = await this.call(
        `/ent/v2/tasks/${encodeURIComponent(jobId)}/creations`,
        { method: 'GET' },
      );
    } catch (error) {
      throw networkFailure(error);
    }
    const json = record(await jsonOrNull(response));
    if (!response.ok) throw this.httpFailure(response, json);
    return json;
  }

  private call(
    path: string,
    init: { method: 'GET' | 'POST'; body?: unknown },
  ): Promise<Response> {
    return fetch(`${VIDU_BASE_URL}${path}`, {
      method: init.method,
      // A redirect would carry the Authorization header to another host.
      redirect: 'error',
      headers: {
        Authorization: `Token ${this.config.viduApiKey}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(this.config.httpTimeoutMs),
    });
  }

  /**
   * By Vidu's documented error code first, status second. A 5xx on a submit
   * may have created the task, so it is `unknown` (reconcile, never
   * resubmit blind); every 4xx created nothing.
   */
  private httpFailure(
    response: Response,
    json: Record<string, unknown> | null,
  ): VideoGenerationProviderError {
    const code = errorCodeOf(json);
    const status = response.status;
    if (status === 402 || code === 'CreditInsufficient')
      return providerError('insufficient_provider_balance', false, 'refused');
    if (status === 429 || THROTTLED.has(code))
      return providerError('rate_limited', true, 'refused', response);
    if (POLICY.has(code)) return providerError('rejected', false, 'refused');
    if (INPUT_REFUSED.has(code))
      return providerError('rejected', false, 'refused');
    if (status === 401 || status === 403)
      return providerError('unavailable', false, 'refused');
    if (status === 404)
      return providerError('provider_failed', false, 'refused');
    if (status >= 500)
      return providerError('unavailable', true, 'unknown', response);
    return providerError('provider_failed', false, 'refused');
  }

  private logged(
    error: VideoGenerationProviderError,
    reason: string,
    started: number,
  ) {
    this.logger.warn(
      `provider=vidu code=${error.code} retryable=${error.retryable} dispatch=${error.dispatch} reason=${reason} durationMs=${Date.now() - started}`,
    );
    return error;
  }
}

/** Vidu task `err_code` → Lyra's closed vocabulary. */
export function failureOf(code: string): VideoGenerationFailureCode {
  if (POLICY.has(code)) return 'rejected';
  if (INPUT_REFUSED.has(code)) return 'rejected';
  if (code === 'CreditInsufficient') return 'insufficient_provider_balance';
  if (THROTTLED.has(code)) return 'rate_limited';
  if (code === 'ModelUnavailable') return 'unavailable';
  return 'provider_failed';
}

function errorCodeOf(json: Record<string, unknown> | null): string {
  const candidate = json?.code ?? json?.err_code ?? json?.reason;
  return typeof candidate === 'string' && /^[A-Za-z]{1,64}$/.test(candidate)
    ? candidate
    : '';
}

function usageOf(
  json: Record<string, unknown> | null,
): VideoGenerationUsage | null {
  const credits = nonNegative(json?.credits);
  if (credits === null || !Number.isSafeInteger(credits)) return null;
  return { metrics: { credits }, reportedCost: null };
}

function firstCreation(json: Record<string, unknown> | null) {
  return Array.isArray(json?.creations) ? record(json.creations[0]) : null;
}
