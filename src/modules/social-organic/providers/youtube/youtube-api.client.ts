import { Injectable } from '@nestjs/common';
import type { SocialPublicationFailureReason } from '../../publication/entities/social-publication.entity';

const UPLOAD_HOST = 'https://www.googleapis.com/upload/youtube/v3/videos';
const API_HOST = 'https://www.googleapis.com/youtube/v3';
const THUMBNAIL_HOST =
  'https://www.googleapis.com/upload/youtube/v3/thumbnails/set';
/** Multiple of 256 KiB, as the resumable protocol requires. */
export const YOUTUBE_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 120_000;
const SOURCE_TIMEOUT_MS = 30 * 60_000;
const MAX_CHUNK_ATTEMPTS = 2;

/** Only the HTTP status and the first error `reason` are kept; never a body. */
export class YoutubeApiError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string | null,
  ) {
    super(`youtube_${status}_${reason ?? 'unknown'}`);
    this.name = 'YoutubeApiError';
  }
}

/** Raised for local faults (source mismatch, bad session URL). */
export class YoutubeUploadFault extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'YoutubeUploadFault';
  }
}

export type YoutubeUploadMetadata = {
  snippet: {
    title: string;
    description: string;
    tags: string[];
    categoryId: string;
  };
  status: {
    privacyStatus: 'public' | 'unlisted' | 'private';
    selfDeclaredMadeForKids: boolean;
  };
};

export type YoutubeVideoState = {
  uploadStatus: string | null;
  failureReason: string | null;
  rejectionReason: string | null;
  processingStatus: string | null;
};

/** Maps a YouTube error to the closed `failure_reason` vocabulary (D-I6). */
export function youtubeFailure(error: unknown): {
  reason: SocialPublicationFailureReason;
  code: string;
} {
  if (error instanceof YoutubeUploadFault) {
    return { reason: 'media_rejected', code: error.code };
  }
  if (!(error instanceof YoutubeApiError)) {
    return { reason: 'provider_unavailable', code: 'youtube_network_error' };
  }
  const { status, reason } = error;
  const code = `youtube_${reason ?? status}`;
  if (status === 401) return { reason: 'credential_expired', code };
  if (
    reason === 'quotaExceeded' ||
    reason === 'rateLimitExceeded' ||
    reason === 'dailyLimitExceeded' ||
    reason === 'uploadLimitExceeded' ||
    status === 429
  ) {
    return { reason: 'rate_limited', code };
  }
  if (reason === 'duplicate') return { reason: 'duplicate_content', code };
  if (status === 403) return { reason: 'permission_lost', code };
  if (status >= 500) return { reason: 'provider_unavailable', code };
  if (
    reason === 'mediaBodyRequired' ||
    reason === 'invalidFilename' ||
    reason === 'invalidVideoMetadata'
  ) {
    return { reason: 'media_rejected', code };
  }
  return { reason: 'payload_invalid', code };
}

@Injectable()
export class YoutubeApiClient {
  /** Starts a resumable session and returns its upload URI. */
  async startUpload(input: {
    accessToken: string;
    metadata: YoutubeUploadMetadata;
    totalBytes: number;
    mimeType: string;
  }): Promise<string> {
    const response = await this.fetchJson(
      `${UPLOAD_HOST}?uploadType=resumable&part=snippet,status`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Length': String(input.totalBytes),
          'X-Upload-Content-Type': input.mimeType,
        },
        body: JSON.stringify(input.metadata),
      },
    );
    const location = response.headers.get('location');
    if (!location || !isGoogleUploadUrl(location)) {
      throw new YoutubeUploadFault('youtube_session_invalid');
    }
    return location;
  }

  /**
   * Streams the source into the session in chunks (multiples of 256 KiB, last
   * one free). Returns the new video id. A chunk that fails transiently is
   * re-sent once after asking the session how much it already holds.
   */
  async uploadFromSource(input: {
    sessionUrl: string;
    sourceUrl: string;
    totalBytes: number;
    mimeType: string;
  }): Promise<string> {
    let source: Response;
    try {
      source = await fetch(input.sourceUrl, {
        signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
      });
    } catch {
      throw new YoutubeUploadFault('media_source_unreachable');
    }
    if (!source.ok || !source.body) {
      throw new YoutubeUploadFault('media_source_unreachable');
    }
    const declared = Number(source.headers.get('content-length'));
    if (
      Number.isFinite(declared) &&
      declared > 0 &&
      declared !== input.totalBytes
    ) {
      throw new YoutubeUploadFault('media_source_size_mismatch');
    }

    const reader = source.body.getReader();
    let pending: Uint8Array[] = [];
    let pendingBytes = 0;
    let sent = 0;
    let videoId: string | null = null;

    const flush = async (final: boolean) => {
      while (
        pendingBytes >= YOUTUBE_UPLOAD_CHUNK_BYTES ||
        (final && pendingBytes > 0)
      ) {
        const size = Math.min(pendingBytes, YOUTUBE_UPLOAD_CHUNK_BYTES);
        const chunk = take(pending, size);
        pending = chunk.rest;
        pendingBytes -= size;
        videoId = await this.putChunk({
          ...input,
          chunk: chunk.data,
          start: sent,
        });
        sent += size;
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      pending.push(value);
      pendingBytes += value.byteLength;
      if (sent + pendingBytes > input.totalBytes) {
        throw new YoutubeUploadFault('media_source_size_mismatch');
      }
      await flush(false);
    }
    await flush(true);

    if (sent !== input.totalBytes || !videoId) {
      throw new YoutubeUploadFault('media_source_size_mismatch');
    }
    return videoId;
  }

  async getVideoState(input: {
    accessToken: string;
    videoId: string;
  }): Promise<YoutubeVideoState | null> {
    const query = new URLSearchParams({
      part: 'status,processingDetails',
      id: input.videoId,
    });
    const response = await this.fetchJson(`${API_HOST}/videos?${query}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${input.accessToken}` },
    });
    const body = (await response.json().catch(() => null)) as {
      items?: Array<{
        status?: Record<string, unknown>;
        processingDetails?: Record<string, unknown>;
      }>;
    } | null;
    const item = body?.items?.[0];
    if (!item) return null;
    const text = (value: unknown) => (typeof value === 'string' ? value : null);
    return {
      uploadStatus: text(item.status?.uploadStatus),
      failureReason: text(item.status?.failureReason),
      rejectionReason: text(item.status?.rejectionReason),
      processingStatus: text(item.processingDetails?.processingStatus),
    };
  }

  /**
   * Custom thumbnail (`thumbnails.set`, 50 quota units). JPEG/PNG up to 2 MB;
   * the channel must be verified for custom thumbnails, otherwise YouTube
   * answers 403 and the video keeps its automatic thumbnail.
   */
  async setThumbnail(input: {
    accessToken: string;
    videoId: string;
    data: Uint8Array;
    mimeType: string;
  }): Promise<void> {
    const query = new URLSearchParams({ videoId: input.videoId });
    await this.fetchJson(`${THUMBNAIL_HOST}?${query}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        'Content-Type': input.mimeType,
      },
      body: input.data as unknown as BodyInit,
    });
  }

  private async putChunk(input: {
    sessionUrl: string;
    mimeType: string;
    totalBytes: number;
    chunk: Uint8Array;
    start: number;
  }): Promise<string | null> {
    const end = input.start + input.chunk.byteLength - 1;
    for (let attempt = 1; ; attempt += 1) {
      try {
        const response = await fetch(input.sessionUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': input.mimeType,
            'Content-Length': String(input.chunk.byteLength),
            'Content-Range': `bytes ${input.start}-${end}/${input.totalBytes}`,
          },
          body: input.chunk as unknown as BodyInit,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        return await this.readChunkResponse(response);
      } catch (error) {
        const transient =
          !(error instanceof YoutubeApiError) || error.status >= 500;
        if (!transient || attempt >= MAX_CHUNK_ATTEMPTS) throw error;
        const held = await this.heldBytes(input.sessionUrl, input.totalBytes);
        if (held === end + 1) return null; // the chunk did arrive
        if (held !== input.start) {
          throw new YoutubeUploadFault('youtube_session_offset_mismatch');
        }
      }
    }
  }

  private async readChunkResponse(response: Response): Promise<string | null> {
    if (response.status === 308) return null;
    if (response.status === 200 || response.status === 201) {
      const body = (await response.json().catch(() => null)) as {
        id?: unknown;
      } | null;
      if (typeof body?.id !== 'string' || !body.id) {
        throw new YoutubeUploadFault('youtube_invalid_response');
      }
      return body.id;
    }
    throw await toApiError(response);
  }

  // Bytes the session already holds: an empty PUT with a "bytes star/TOTAL" range.
  private async heldBytes(sessionUrl: string, total: number): Promise<number> {
    const response = await fetch(sessionUrl, {
      method: 'PUT',
      headers: {
        'Content-Length': '0',
        'Content-Range': `bytes */${total}`,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status !== 308) throw await toApiError(response);
    const range = /bytes=0-(\d+)/.exec(response.headers.get('range') ?? '');
    return range ? Number(range[1]) + 1 : 0;
  }

  private async fetchJson(url: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new YoutubeApiError(503, 'network');
    }
    if (!response.ok) throw await toApiError(response);
    return response;
  }
}

async function toApiError(response: Response): Promise<YoutubeApiError> {
  let reason: string | null = null;
  try {
    const body = (await response.json()) as {
      error?: { errors?: Array<{ reason?: unknown }> };
    };
    const first = body.error?.errors?.[0]?.reason;
    reason = typeof first === 'string' ? first : null;
  } catch {
    reason = null;
  }
  return new YoutubeApiError(response.status, reason);
}

/** The session URI must stay on Google; it is never followed elsewhere. */
function isGoogleUploadUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'www.googleapis.com';
  } catch {
    return false;
  }
}

function take(parts: Uint8Array[], size: number) {
  const data = new Uint8Array(size);
  let offset = 0;
  const rest: Uint8Array[] = [];
  for (const part of parts) {
    if (offset >= size) {
      rest.push(part);
      continue;
    }
    const room = size - offset;
    if (part.byteLength <= room) {
      data.set(part, offset);
      offset += part.byteLength;
    } else {
      data.set(part.subarray(0, room), offset);
      offset += room;
      rest.push(part.subarray(room));
    }
  }
  return { data, rest };
}
