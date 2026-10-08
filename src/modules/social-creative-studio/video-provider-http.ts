import { isIP } from 'node:net';
import {
  type VideoGenerationDispatchOutcome,
  type VideoGenerationFailureCode,
  VideoGenerationProviderError,
} from './creative-video-generation.provider';

/**
 * CS4-B — HTTP mechanics shared by the video adapters. Adapter-internal:
 * nothing here is part of the port and nothing is vendor-specific.
 *
 * `fetch` native, no SDK (same choice as the OpenAI adapter: an SDK would add
 * its own retries, and for paid async jobs retry policy belongs to the
 * worker, which knows whether a job may already exist).
 */

/** Connection errors that prove the request never reached the provider. */
const NOT_SENT_CAUSES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ERR_INVALID_URL',
]);

/**
 * What a thrown `fetch` means for a SUBMIT. A timeout or a reset after the
 * connection opened may have created the job; only a failure to connect is
 * `not_sent`. Everything uncertain is `unknown`.
 */
export function dispatchOutcomeOf(
  error: unknown,
): VideoGenerationDispatchOutcome {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  const code = typeof cause?.code === 'string' ? cause.code : '';
  return NOT_SENT_CAUSES.has(code) ? 'not_sent' : 'unknown';
}

export function isTimeout(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

export function networkFailure(error: unknown): VideoGenerationProviderError {
  return new VideoGenerationProviderError(
    isTimeout(error) ? 'timeout' : 'unavailable',
    true,
    dispatchOutcomeOf(error),
  );
}

export async function jsonOrNull(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** `Retry-After` as delta-seconds or HTTP date; anything else is ignored. */
export function retryAfterSeconds(response: Response): number | undefined {
  const raw = response.headers.get('retry-after')?.trim();
  if (!raw) return undefined;
  const seconds = /^\d{1,6}$/.test(raw)
    ? Number(raw)
    : Math.ceil((Date.parse(raw) - Date.now()) / 1000);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

export function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A provider string worth persisting (ids, codes): bounded, printable, no spaces. */
export function token(value: unknown, max = 160): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(value)
    ? value.slice(0, max)
    : typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
      ? String(value)
      : null;
}

export function nonNegative(value: unknown): number | null {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) && number >= 0
    ? number
    : null;
}

/**
 * Downloads a provider-issued output URL (presigned, transient). No API key
 * travels with it; redirects are refused; https only; the host must not be a
 * literal private/loopback address. The size is capped while streaming, so a
 * hostile or broken answer cannot exhaust memory.
 *
 * Errors map to retryable `unavailable`/`timeout`: the provider job is done
 * and paid, re-reading its output costs nothing (the URL is re-issued by
 * re-reading the job status).
 */
export async function downloadProviderFile(
  url: string,
  maxBytes: number,
  timeoutMs: number,
): Promise<Buffer> {
  if (!isSafeHttpsUrl(url))
    throw new VideoGenerationProviderError('invalid_output', false);
  let response: Response;
  try {
    response = await fetch(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new VideoGenerationProviderError(
      isTimeout(error) ? 'timeout' : 'unavailable',
      true,
    );
  }
  if (!response.ok || !response.body)
    throw new VideoGenerationProviderError(
      'unavailable',
      response.status >= 500 ||
        response.status === 403 ||
        response.status === 404,
    );
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes)
    throw new VideoGenerationProviderError('invalid_output', false);
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > maxBytes)
        throw new VideoGenerationProviderError('invalid_output', false);
      chunks.push(Buffer.from(chunk));
    }
  } catch (error) {
    if (error instanceof VideoGenerationProviderError) throw error;
    throw new VideoGenerationProviderError(
      isTimeout(error) ? 'timeout' : 'unavailable',
      true,
    );
  }
  return Buffer.concat(chunks);
}

export function isSafeHttpsUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  const family = isIP(host);
  if (family === 4)
    return !/^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(
      host,
    );
  if (family === 6) return !/^(::1|fc|fd|fe80)/i.test(host);
  return true;
}

/** `data:` URI for providers that accept Base64 images inline. */
export function dataUri(mimeType: string, body: Buffer) {
  return `data:${mimeType};base64,${body.toString('base64')}`;
}

/** Failure with the dispatch fact the worker's retry policy depends on. */
export function providerError(
  code: VideoGenerationFailureCode,
  retryable: boolean,
  dispatch: VideoGenerationDispatchOutcome,
  response?: Response,
) {
  return new VideoGenerationProviderError(code, retryable, dispatch, {
    retryAfterSeconds: response ? retryAfterSeconds(response) : undefined,
  });
}
