import { Logger } from '@nestjs/common';
import type { CreativeGenerationConfigService } from './creative-generation-config';
import {
  type CreativeImageAspectRatio,
  type CreativeImageQuality,
  IMAGE_GENERATION_REFERENCE_MIME_TYPES,
  type ImageGenerationFailureCode,
  ImageGenerationProvider,
  ImageGenerationProviderError,
  type ImageGenerationProviderErrorDetails,
  type ImageGenerationProviderInput,
  type ImageGenerationProviderResult,
  type ImageGenerationReference,
  type ImageGenerationUsage,
  MAX_IMAGE_GENERATION_OUTPUTS,
  MAX_IMAGE_GENERATION_REFERENCE_BYTES,
  MAX_IMAGE_GENERATION_REFERENCES,
} from './creative-image-generation.provider';

/**
 * Fixed, not configurable: the API key may fall back to the shared
 * `OPENAI_API_KEY`, and a configurable host would be a way to ship it
 * elsewhere.
 */
export const OPENAI_IMAGES_GENERATIONS_URL =
  'https://api.openai.com/v1/images/generations';
/** CS3.4.2 — same host, chosen by the adapter when references are present. */
export const OPENAI_IMAGES_EDITS_URL = 'https://api.openai.com/v1/images/edits';

const REFERENCE_EXTENSION: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/**
 * Lyra aspect ratio → GPT Image `size`. All four are EXACT ratios inside the
 * custom-size rules of the GPT Image 2.5 models (OpenAI image generation
 * guide, 2026-10-06): edges multiple of 16, ratio between 1:3 and 3:1, total
 * pixels 655,360..8,294,400, nothing above the experimental 2560x1440. Each is
 * ~1–1.3 MP, close to the documented 1024x1024 / 1536x1024 / 1024x1536, so
 * cost per image stays comparable across ratios. Nothing is cropped or
 * resized afterwards — the provider renders the ratio natively.
 */
export const OPENAI_IMAGE_SIZE: Readonly<
  Record<CreativeImageAspectRatio, string>
> = {
  '1:1': '1024x1024',
  '4:5': '1024x1280',
  '9:16': '864x1536',
  '16:9': '1536x864',
};

/**
 * Lyra quality tier → GPT Image `quality`. `xhigh`/`max` exist on 2.5 models
 * but are not exposed: Lyra has two tiers, and these two values are accepted
 * by every GPT Image model, so changing the configured model cannot break it.
 */
export const OPENAI_IMAGE_QUALITY: Readonly<
  Record<CreativeImageQuality, 'medium' | 'high'>
> = {
  standard: 'medium',
  high: 'high',
};

/** 429 codes that are billing/quota states, not "too fast": retrying cannot help. */
const QUOTA_CODES = new Set([
  'insufficient_quota',
  'credit_balance_exhausted',
  'organization_spend_limit_exceeded',
  'project_spend_limit_exceeded',
  'organization_usage_limit_exceeded',
]);

/** Content refusals: documented `moderation_blocked`, plus the legacy name. */
const MODERATION_CODES = new Set([
  'moderation_blocked',
  'content_policy_violation',
]);

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * CS3.3 — OpenAI Images API adapter behind `ImageGenerationProvider`.
 *
 * One call per attempt, with `n = outputCount`: the API generates up to 10
 * images in a single request, so one Lyra attempt is exactly one billed call
 * and the worker's retry count is the call count. The endpoint is this
 * adapter's decision, never the domain's (CS3.4.2):
 *   - no references → `POST /v1/images/generations` (JSON);
 *   - references    → `POST /v1/images/edits` (multipart), one `image[]` part
 *     per reference in the domain's order — the order the prompt's
 *     "Image 1..N" refers to. `input_fidelity` is not sent: GPT Image 2.x
 *     models process image inputs at high fidelity and reject the parameter.
 *     No `mask`: a reference workflow, not an in-place edit.
 * Response, usage and every error rule are the same for both.
 *
 * Plain `fetch`, like every other OpenAI integration in this API (Planner,
 * briefing, Inbox, campaigns, analytics) — no SDK in the monorepo, and the
 * SDK's built-in retries would be a second retry policy under the worker's.
 *
 * Billing safety: once OpenAI answered 2xx the call is treated as paid, so
 * nothing after that point is retryable — a malformed or unreadable success
 * fails the generation instead of silently buying it again. Its usage, when
 * readable, rides on the error so the attempt is still accounted for.
 *
 * Never logged or thrown: the prompt, the key, response bodies, provider
 * messages, request ids. Logs carry status, duration, model and a sanitized
 * OpenAI error code.
 */
export class OpenAIImageGenerationProvider extends ImageGenerationProvider {
  readonly id = 'openai';
  private readonly logger = new Logger(OpenAIImageGenerationProvider.name);

  constructor(private readonly config: CreativeGenerationConfigService) {
    super();
  }

  async generate(
    input: ImageGenerationProviderInput,
  ): Promise<ImageGenerationProviderResult> {
    if (
      !Number.isInteger(input.outputCount) ||
      input.outputCount < 1 ||
      input.outputCount > MAX_IMAGE_GENERATION_OUTPUTS ||
      !(input.aspectRatio in OPENAI_IMAGE_SIZE) ||
      !(input.quality in OPENAI_IMAGE_QUALITY) ||
      !Array.isArray(input.references) ||
      input.references.length > MAX_IMAGE_GENERATION_REFERENCES ||
      // `Array.isArray` widened the array to `any[]`; re-assert the port type.
      !input.references.every(
        (ref: ImageGenerationReference | undefined) =>
          ref !== undefined &&
          (IMAGE_GENERATION_REFERENCE_MIME_TYPES as readonly string[]).includes(
            ref.mimeType,
          ) &&
          Buffer.isBuffer(ref.body) &&
          ref.body.length > 0 &&
          ref.body.length <= MAX_IMAGE_GENERATION_REFERENCE_BYTES,
      )
    )
      // Refusing beats trimming: a product photo silently dropped is a wrong
      // image, still billed.
      throw this.fail('failed', false, 'request_out_of_contract');
    const editing = input.references.length > 0;

    const model = this.config.imageModel;
    const started = Date.now();
    let response: Response;
    try {
      response = await fetch(
        editing ? OPENAI_IMAGES_EDITS_URL : OPENAI_IMAGES_GENERATIONS_URL,
        {
          method: 'POST',
          // A redirect would carry the Authorization header to another host.
          redirect: 'error',
          // Multipart sets its own Content-Type (with the boundary).
          headers: editing
            ? { Authorization: `Bearer ${this.config.openAiApiKey}` }
            : {
                Authorization: `Bearer ${this.config.openAiApiKey}`,
                'Content-Type': 'application/json',
              },
          body: editing
            ? editForm(model, input)
            : JSON.stringify({ model, ...requestFields(input) }),
          signal: AbortSignal.timeout(this.config.imageTimeoutMs),
        },
      );
    } catch (error) {
      // Nothing came back: OpenAI may or may not have billed, and this is
      // the documented transient class — the worker retries with backoff.
      throw isTimeout(error)
        ? this.fail('timeout', true, 'timeout', started)
        : this.fail('unavailable', true, 'network', started);
    }

    if (!response.ok) throw await this.httpFailure(response, started);

    // From here on the call is paid: no failure is retryable.
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw isTimeout(error)
        ? this.fail('timeout', false, 'body_timeout', started)
        : this.fail('invalid_output', false, 'malformed_body', started);
    }

    const body = record(payload);
    const data = Array.isArray(body?.data) ? (body.data as unknown[]) : null;
    const usage = this.usage(model, body?.usage, data?.length ?? null);
    const outputs = decodeOutputs(data, input.outputCount);
    if (!outputs)
      throw this.fail('invalid_output', false, 'malformed_images', started, {
        usage,
      });

    this.logger.log(
      `provider=openai model=${model} endpoint=${editing ? 'edits' : 'generations'} references=${input.references.length} http=${response.status} outputs=${outputs.length} durationMs=${Date.now() - started}`,
    );
    return { outputs, usage };
  }

  private async httpFailure(
    response: Response,
    started: number,
  ): Promise<ImageGenerationProviderError> {
    const code = await errorCode(response);
    const status = response.status;
    const detail = `http_${status}${code ? `:${code}` : ''}`;

    // By code only: other 4xx share the error `type`, and calling an
    // invalid size "refused by content rules" would mislead the user.
    if (MODERATION_CODES.has(code))
      return this.fail('rejected', false, detail, started);
    if (status === 401 || status === 403)
      // Platform credential or account problem: the client sees
      // "unavailable"; the log says why. Retrying cannot fix a key.
      return this.fail('unavailable', false, detail, started);
    if (status === 429)
      return QUOTA_CODES.has(code)
        ? this.fail('unavailable', false, detail, started)
        : this.fail('rate_limited', true, detail, started, {
            retryAfterSeconds: retryAfterSeconds(response),
          });
    if (status === 408) return this.fail('timeout', true, detail, started);
    if (status >= 500)
      return this.fail('unavailable', true, detail, started, {
        retryAfterSeconds: retryAfterSeconds(response),
      });
    // Any other 4xx is a request OpenAI will refuse every time.
    return this.fail('failed', false, detail, started);
  }

  /**
   * Images API usage → port metrics. Token counts are what OpenAI bills
   * image models on; `images` is how many came back. Cost stays `null`: the
   * API returns no money, and a price table belongs to CS6, versioned.
   */
  private usage(
    model: string,
    raw: unknown,
    images: number | null,
  ): ImageGenerationUsage {
    const usage = record(raw);
    const input = record(usage?.input_tokens_details);
    const output = record(usage?.output_tokens_details);
    const metrics: Record<string, number> = {};
    const put = (key: string, value: unknown) => {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0)
        metrics[key] = value;
    };
    put('images', images);
    put('input_tokens', usage?.input_tokens);
    put('input_text_tokens', input?.text_tokens);
    put('input_image_tokens', input?.image_tokens);
    put('output_tokens', usage?.output_tokens);
    put('output_image_tokens', output?.image_tokens);
    put('output_text_tokens', output?.text_tokens);
    put('total_tokens', usage?.total_tokens);
    return { model, metrics, cost: null };
  }

  private fail(
    code: ImageGenerationFailureCode,
    retryable: boolean,
    reason: string,
    started?: number,
    details?: ImageGenerationProviderErrorDetails,
  ): ImageGenerationProviderError {
    this.logger.warn(
      `provider=openai model=${this.config.imageModel} code=${code} retryable=${retryable} reason=${reason}` +
        (started === undefined ? '' : ` durationMs=${Date.now() - started}`),
    );
    return new ImageGenerationProviderError(code, retryable, details);
  }
}

/** Fields both endpoints share, in Lyra's translation. */
function requestFields(input: ImageGenerationProviderInput) {
  return {
    prompt: input.prompt,
    n: input.outputCount,
    size: OPENAI_IMAGE_SIZE[input.aspectRatio],
    quality: OPENAI_IMAGE_QUALITY[input.quality],
    // Explicit so a default change upstream cannot change what we store.
    output_format: 'png',
  };
}

/**
 * `/v1/images/edits` body. Built per attempt from the bytes the worker
 * verified; file names are positional and carry nothing about the asset.
 */
function editForm(model: string, input: ImageGenerationProviderInput) {
  const form = new FormData();
  form.append('model', model);
  for (const [key, value] of Object.entries(requestFields(input)))
    form.append(key, String(value));
  input.references.forEach((ref, index) =>
    form.append(
      'image[]',
      new Blob([new Uint8Array(ref.body)], { type: ref.mimeType }),
      `reference-${index + 1}.${REFERENCE_EXTENSION[ref.mimeType]}`,
    ),
  );
  return form;
}

/**
 * Every item must carry strict base64 PNG data; a URL-only item (legacy
 * models) is not downloaded. More images than requested breaks the contract
 * (and the bill), so the whole answer is refused rather than trimmed.
 */
function decodeOutputs(
  data: unknown[] | null,
  requested: number,
): ImageGenerationProviderResult['outputs'] | null {
  if (!data || data.length === 0 || data.length > requested) return null;
  const outputs: { body: Buffer }[] = [];
  for (const item of data) {
    const b64 = record(item)?.b64_json;
    if (typeof b64 !== 'string' || b64.length % 4 !== 0 || !BASE64.test(b64))
      return null;
    const body = Buffer.from(b64, 'base64');
    if (body.length === 0) return null;
    outputs.push({ body });
  }
  return outputs;
}

/**
 * Only `error.code` of an error body, shape-checked so neither the message
 * nor anything echoed from the request can reach a log.
 */
async function errorCode(response: Response): Promise<string> {
  try {
    const code = record(record(await response.json())?.error)?.code;
    return typeof code === 'string' && /^[a-z0-9_.-]{1,64}$/i.test(code)
      ? code.toLowerCase()
      : '';
  } catch {
    return '';
  }
}

/** `Retry-After` as delta-seconds or HTTP date; anything else is ignored. */
function retryAfterSeconds(response: Response): number | undefined {
  const raw = response.headers.get('retry-after')?.trim();
  if (!raw) return undefined;
  const seconds = /^\d{1,6}$/.test(raw)
    ? Number(raw)
    : Math.ceil((Date.parse(raw) - Date.now()) / 1000);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

function isTimeout(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
