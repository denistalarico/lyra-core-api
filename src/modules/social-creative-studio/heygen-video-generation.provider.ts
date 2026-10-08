import { Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { detectMediaAssetMimeType } from '../../common/media-assets';
import type { CreativeVideoGenerationConfigService } from './creative-video-generation-config';
import {
  type ProviderVideoJob,
  type ProviderVideoRecovery,
  type ProviderVideoResult,
  type ProviderVideoStatus,
  type ProviderVideoSubmitted,
  type VideoAvatarCatalogEntry,
  type VideoGenerationCallbackRequest,
  type VideoGenerationFailureCode,
  VideoGenerationProvider,
  VideoGenerationProviderError,
  type VideoGenerationSubmitContext,
  type VideoGenerationSubmitInput,
  type VideoGenerationUsage,
  type VideoProviderDiagnostics,
} from './creative-video-generation.provider';
import {
  type CreativeVideoCostSnapshot,
  HEYGEN_PRICING,
  heygenCostSnapshot,
  heygenSecondPrice,
} from './creative-video-pricing';
import {
  downloadProviderFile,
  isSafeHttpsUrl,
  jsonOrNull,
  networkFailure,
  nonNegative,
  providerError,
  record,
  token,
} from './video-provider-http';

/**
 * CS4-B — HeyGen adapter for `ugc_avatar`, on the **v3** API
 * (developers.heygen.com, audited 2026-10; v1/v2 are supported only until
 * 2026-10-31, so nothing here touches them).
 *
 *   submit   → POST /v3/videos  { type: 'avatar', avatar_id, script, voice_id,
 *                                 engine: { type }, aspect_ratio: '9:16',
 *                                 resolution, output_format: 'mp4' }
 *              with `Idempotency-Key` (HeyGen replays the original answer for
 *              24 h — a lost submit is recovered by sending it again, which
 *              can never create a second video)
 *   status   → GET  /v3/videos/{id}  pending|processing|completed|failed,
 *              `duration` (s), presigned `video_url`/`thumbnail_url`
 *              (re-read the status for fresh URLs)
 *   assets   → POST /v3/assets (multipart, ≤ 32 MB, png/jpeg) for the optional
 *              product background
 *   avatars  → GET  /v3/avatars/looks?ownership=public (cursor pagination)
 *   balance  → GET  /v3/users/me → wallet.remaining_balance
 *   webhook  → `signature` = HMAC-SHA256(raw body, endpoint secret)
 *
 * HeyGen returns no money: the cost is output seconds × the versioned PAYG
 * price of (engine, avatar type) — `creative-video-pricing.ts`.
 *
 * Duration is the script's: the request carries no duration, nothing is
 * truncated, and the real length comes back as `duration`.
 */
const HEYGEN_BASE_URL = 'https://api.heygen.com';
const RESOLUTION = { standard: '720p', high: '1080p' } as const;
const VIDEO_MAX_BYTES = 300 * 1024 * 1024;
const POSTER_MAX_BYTES = 10 * 1024 * 1024;
const PREVIEW_MAX_BYTES = 5 * 1024 * 1024;
/** HeyGen replays an Idempotency-Key for 24 h; recovery stays well inside. */
const IDEMPOTENCY_REPLAY_MS = 23 * 60 * 60_000;
const CATALOG_MAX_PAGES = 40;
const BACKGROUND_MIME_TYPES = new Set(['image/png', 'image/jpeg']);

const AVATAR_CODES = new Set([
  'avatar_not_found',
  'avatar_not_usable',
  'voice_not_found',
  'voice_not_usable',
  'resource_not_ready',
]);

export class HeyGenVideoGenerationProvider extends VideoGenerationProvider {
  readonly id = 'heygen';
  readonly mode = 'ugc_avatar' as const;
  readonly pricingVersion = HEYGEN_PRICING.version;
  private readonly logger = new Logger(HeyGenVideoGenerationProvider.name);

  constructor(private readonly config: CreativeVideoGenerationConfigService) {
    super();
  }

  get engine() {
    return this.config.ugcEngine;
  }

  override get callbacksVerifiable() {
    return Boolean(this.config.heygenWebhookSecret);
  }

  /**
   * Offered only when the look runs on the configured engine, has a default
   * voice, and (engine, avatar type) has a price — never bill an unknown rate.
   */
  override isAvatarUsable(entry: VideoAvatarCatalogEntry): boolean {
    return (
      entry.defaultVoiceId !== null &&
      entry.supportedEngines.includes(this.engine) &&
      heygenSecondPrice(this.engine, entry.avatarType) !== null
    );
  }

  async submit(
    input: VideoGenerationSubmitInput,
    context: VideoGenerationSubmitContext,
  ): Promise<ProviderVideoSubmitted> {
    if (input.mode !== 'ugc_avatar')
      throw new VideoGenerationProviderError('unavailable', false, 'not_sent');
    const started = Date.now();
    const background = input.backgroundImage
      ? await this.uploadBackground(input.backgroundImage, context.dispatchKey)
      : null;
    const body: Record<string, unknown> = {
      type: 'avatar',
      avatar_id: input.avatar.providerAvatarId,
      script: input.script,
      voice_id: input.avatar.providerVoiceId,
      engine: { type: this.engine },
      aspect_ratio: input.aspectRatio,
      resolution: RESOLUTION[input.quality],
      output_format: 'mp4',
      title: 'Lyra Reel',
      callback_id: context.dispatchKey,
      ...(context.callbackUrl ? { callback_url: context.callbackUrl } : {}),
      ...(input.language ? { voice_settings: { locale: input.language } } : {}),
      ...(background
        ? { background: { type: 'image', asset_id: background } }
        : {}),
    };
    let response: Response;
    try {
      response = await this.call('/v3/videos', {
        method: 'POST',
        json: body,
        idempotencyKey: context.dispatchKey,
      });
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
    const jobId = token(record(json?.data)?.video_id);
    if (!jobId)
      throw this.logged(
        new VideoGenerationProviderError('provider_failed', true, 'unknown'),
        'missing_video_id',
        started,
      );
    this.logger.log(
      `provider=heygen op=avatar_video engine=${this.engine} http=${response.status} durationMs=${Date.now() - started}`,
    );
    return {
      jobId,
      model: this.engine,
      operation: 'avatar_video',
      resolution: RESOLUTION[input.quality],
      usage: null,
    };
  }

  /**
   * The documented way to recover a lost submit: send it again with the same
   * `Idempotency-Key`. Within HeyGen's 24 h window that replays the original
   * response (or 409 while it is still in flight) and never creates a second
   * video. Outside the window it is `unknown` — never a blind resubmit.
   */
  async recover(
    input: VideoGenerationSubmitInput,
    context: VideoGenerationSubmitContext,
    since: Date,
  ): Promise<ProviderVideoRecovery> {
    if (Date.now() - since.getTime() > IDEMPOTENCY_REPLAY_MS)
      return { state: 'unknown' };
    try {
      return { state: 'found', submitted: await this.submit(input, context) };
    } catch (error) {
      if (
        error instanceof VideoGenerationProviderError &&
        error.dispatch === 'refused' &&
        !error.retryable
      )
        // HeyGen refused the original request: nothing was created.
        return { state: 'absent' };
      return { state: 'unknown' };
    }
  }

  async getStatus(job: ProviderVideoJob): Promise<ProviderVideoStatus> {
    const video = await this.video(job.jobId);
    const status = video?.status;
    if (status === 'completed') {
      const seconds = nonNegative(video?.duration);
      return {
        state: 'succeeded',
        outputRef: null,
        durationSeconds: seconds,
        usage:
          seconds === null
            ? null
            : { metrics: { seconds }, reportedCost: null },
      };
    }
    if (status === 'failed')
      return {
        state: 'failed',
        code: failureOf(
          typeof video?.failure_code === 'string' ? video.failure_code : '',
        ),
        usage: null,
      };
    return { state: 'pending' };
  }

  async getResult(job: ProviderVideoJob): Promise<ProviderVideoResult> {
    const video = await this.video(job.jobId);
    if (video?.status !== 'completed' || typeof video.video_url !== 'string')
      throw new VideoGenerationProviderError('invalid_output', false);
    const body = await downloadProviderFile(
      video.video_url,
      VIDEO_MAX_BYTES,
      this.config.downloadTimeoutMs,
    );
    const poster =
      typeof video.thumbnail_url === 'string'
        ? await downloadProviderFile(
            video.thumbnail_url,
            POSTER_MAX_BYTES,
            60_000,
          ).catch(() => null)
        : null;
    return { video: body, poster };
  }

  cost(
    input: VideoGenerationSubmitInput,
    usage: VideoGenerationUsage | null,
    model: string,
  ): CreativeVideoCostSnapshot | null {
    const seconds = usage?.metrics.seconds;
    if (input.mode !== 'ugc_avatar' || seconds === undefined) return null;
    return heygenCostSnapshot(seconds, model, input.avatar.avatarType);
  }

  /**
   * Only with the registered endpoint's secret (`HEYGEN_WEBHOOK_SECRET`):
   * HMAC-SHA256 over the RAW body bytes, compared in constant time (hex or
   * base64, the docs do not fix the encoding). HeyGen retries for 24 h and may
   * deliver twice — harmless, the callback only wakes the worker up.
   */
  override parseCallback(
    request: VideoGenerationCallbackRequest,
  ): { jobId: string } | null {
    const secret = this.config.heygenWebhookSecret;
    const raw = request.headers.signature;
    const signature = Array.isArray(raw) ? raw[0] : raw;
    if (!secret || !signature || !request.rawBody) return null;
    const expected = createHmac('sha256', secret)
      .update(request.rawBody)
      .digest();
    const matches = [
      /^[0-9a-f]+$/i.test(signature) ? Buffer.from(signature, 'hex') : null,
      Buffer.from(signature, 'base64'),
    ].some(
      (candidate) =>
        candidate !== null &&
        candidate.length === expected.length &&
        timingSafeEqual(candidate, expected),
    );
    if (!matches) return null;
    let body: Record<string, unknown> | null = null;
    try {
      body = record(JSON.parse(request.rawBody.toString('utf8')));
    } catch {
      return null;
    }
    const event = typeof body?.event_type === 'string' ? body.event_type : '';
    if (!event.startsWith('avatar_video.')) return null;
    const jobId = token(record(body?.event_data)?.video_id);
    return jobId ? { jobId } : null;
  }

  override async diagnostics(): Promise<VideoProviderDiagnostics> {
    const response = await this.call('/v3/users/me', { method: 'GET' });
    const wallet = record(
      record(record(await jsonOrNull(response))?.data)?.wallet,
    );
    const balance = nonNegative(wallet?.remaining_balance);
    return {
      provider: this.id,
      balance:
        response.ok && balance !== null
          ? {
              amount: String(balance),
              unit:
                typeof wallet?.currency === 'string'
                  ? wallet.currency.toUpperCase()
                  : 'USD',
            }
          : null,
      concurrency: null,
    };
  }

  /**
   * Public (preset) looks only. A private look — a client's Digital Twin —
   * belongs to whoever consented to it; with one platform account it would be
   * visible to every tenant, so it never enters the catalog until an
   * ownership model exists (custom avatars are a future capability).
   */
  override async listAvatars(): Promise<VideoAvatarCatalogEntry[]> {
    const entries: VideoAvatarCatalogEntry[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < CATALOG_MAX_PAGES; page += 1) {
      const query = new URLSearchParams({ ownership: 'public', limit: '50' });
      if (cursor) query.set('token', cursor);
      let response: Response;
      try {
        response = await this.call(`/v3/avatars/looks?${query.toString()}`, {
          method: 'GET',
        });
      } catch (error) {
        throw networkFailure(error);
      }
      const json = record(await jsonOrNull(response));
      if (!response.ok) throw this.httpFailure(response, json);
      const data = json?.data;
      const items = Array.isArray(data)
        ? data
        : Array.isArray(record(data)?.looks)
          ? (record(data)?.looks as unknown[])
          : [];
      for (const raw of items) {
        const look = record(raw);
        const id = token(look?.id);
        if (!look || !id) continue;
        entries.push({
          providerAvatarId: id,
          name: typeof look.name === 'string' ? look.name.slice(0, 160) : id,
          avatarType: token(look.avatar_type, 40) ?? 'unknown',
          gender: token(look.gender, 20),
          orientation: token(look.preferred_orientation, 20),
          supportedEngines: Array.isArray(look.supported_api_engines)
            ? look.supported_api_engines
                .map((engine) => token(engine, 40))
                .filter((engine): engine is string => engine !== null)
            : [],
          defaultVoiceId: token(look.default_voice_id),
          previewImageUrl:
            typeof look.preview_image_url === 'string' &&
            isSafeHttpsUrl(look.preview_image_url)
              ? look.preview_image_url
              : null,
        });
      }
      const next =
        json?.has_more === true || record(data)?.has_more === true
          ? token(json?.next_token ?? record(data)?.next_token, 512)
          : null;
      if (!next) break;
      cursor = next;
    }
    return entries;
  }

  override async fetchAvatarPreview(url: string) {
    const body = await downloadProviderFile(
      url,
      PREVIEW_MAX_BYTES,
      15_000,
    ).catch(() => null);
    const mimeType = body ? detectMediaAssetMimeType(body) : null;
    return body && mimeType?.startsWith('image/') ? { body, mimeType } : null;
  }

  private async uploadBackground(
    image: { mimeType: string; body: Buffer },
    dispatchKey: string,
  ): Promise<string> {
    if (!BACKGROUND_MIME_TYPES.has(image.mimeType))
      throw new VideoGenerationProviderError('rejected', false, 'not_sent');
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(image.body)], { type: image.mimeType }),
      image.mimeType === 'image/png' ? 'background.png' : 'background.jpg',
    );
    let response: Response;
    try {
      response = await this.call('/v3/assets', {
        method: 'POST',
        form,
        idempotencyKey: `${dispatchKey}.background`,
      });
    } catch {
      // Uploading an asset is free and idempotent by key; retrying loses nothing.
      throw new VideoGenerationProviderError('unavailable', true, 'not_sent');
    }
    const json = record(await jsonOrNull(response));
    if (!response.ok) {
      const failure = this.httpFailure(response, json);
      throw new VideoGenerationProviderError(
        failure.code,
        failure.retryable,
        'not_sent',
      );
    }
    const assetId = token(record(json?.data)?.asset_id ?? json?.asset_id);
    if (!assetId)
      throw new VideoGenerationProviderError(
        'provider_failed',
        true,
        'not_sent',
      );
    return assetId;
  }

  private async video(jobId: string) {
    let response: Response;
    try {
      response = await this.call(`/v3/videos/${encodeURIComponent(jobId)}`, {
        method: 'GET',
      });
    } catch (error) {
      throw networkFailure(error);
    }
    const json = record(await jsonOrNull(response));
    if (!response.ok) throw this.httpFailure(response, json);
    return record(json?.data);
  }

  private call(
    path: string,
    init: {
      method: 'GET' | 'POST';
      json?: unknown;
      form?: FormData;
      idempotencyKey?: string;
    },
  ): Promise<Response> {
    return fetch(`${HEYGEN_BASE_URL}${path}`, {
      method: init.method,
      redirect: 'error',
      headers: {
        'x-api-key': this.config.heygenApiKey,
        ...(init.json ? { 'Content-Type': 'application/json' } : {}),
        ...(init.idempotencyKey
          ? { 'Idempotency-Key': init.idempotencyKey }
          : {}),
      },
      body: init.json ? JSON.stringify(init.json) : init.form,
      signal: AbortSignal.timeout(this.config.httpTimeoutMs),
    });
  }

  /** By `error.code` first (documented vocabulary), then by status. */
  private httpFailure(
    response: Response,
    json: Record<string, unknown> | null,
  ): VideoGenerationProviderError {
    const raw = record(json?.error)?.code;
    const code = typeof raw === 'string' ? raw.toLowerCase() : '';
    const status = response.status;
    if (status === 402 || code === 'insufficient_credit')
      return providerError('insufficient_provider_balance', false, 'refused');
    if (code === 'request_in_progress')
      // Same Idempotency-Key still in flight: the job may well exist.
      return providerError('rate_limited', true, 'unknown', response);
    if (status === 429)
      return providerError('rate_limited', true, 'refused', response);
    if (code === 'content_policy_violation')
      return providerError('rejected', false, 'refused');
    if (AVATAR_CODES.has(code))
      return providerError('avatar_unavailable', false, 'refused');
    if (status === 401 || status === 403)
      return providerError('unavailable', false, 'refused');
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
      `provider=heygen code=${error.code} retryable=${error.retryable} dispatch=${error.dispatch} reason=${reason} durationMs=${Date.now() - started}`,
    );
    return error;
  }
}

/** `failure_code` of a failed video → Lyra's closed vocabulary. */
export function failureOf(code: string): VideoGenerationFailureCode {
  const value = code.toLowerCase();
  if (/moderation|policy|content/.test(value)) return 'rejected';
  if (/avatar|voice|look/.test(value)) return 'avatar_unavailable';
  if (/credit|balance|quota/.test(value))
    return 'insufficient_provider_balance';
  return 'provider_failed';
}
