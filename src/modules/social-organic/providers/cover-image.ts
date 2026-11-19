import type { PublicationCover } from './social-publisher.adapter';

const COVER_FETCH_TIMEOUT_MS = 30_000;
const COVER_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Downloads the operator's cover image from its signed URL, for networks that
 * take the file itself (YouTube, Facebook, LinkedIn). Capped at 2 MB and the
 * declared size, so a wrong object never turns into an unbounded download.
 */
export async function readCoverImage(
  image: NonNullable<PublicationCover['image']>,
): Promise<Uint8Array> {
  if (image.bytes <= 0 || image.bytes > COVER_MAX_BYTES) {
    throw new Error('cover_image_size_invalid');
  }
  const response = await fetch(image.sourceUrl, {
    signal: AbortSignal.timeout(COVER_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`cover_image_http_${response.status}`);
  const data = new Uint8Array(await response.arrayBuffer());
  if (data.byteLength !== image.bytes) {
    throw new Error('cover_image_size_mismatch');
  }
  return data;
}

/** A short, safe label for the log line of a cover a network did not take. */
export function coverFailureCode(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 120) : 'unknown';
}
