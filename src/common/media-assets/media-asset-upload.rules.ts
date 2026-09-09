// src/common/media-assets/media-asset-upload.rules.ts
//
// Server-side rules for uploading a publishable media binary (Social Planner
// E3). Pure functions, so every rule is testable without a controller or a
// bucket — the same discipline `brand-kit-upload.rules.ts` established.
//
// WHY THIS FILE DOES NOT REUSE `magic-bytes.util.ts`
// --------------------------------------------------
// The Briefing sniffer knows pdf/jpeg/png/webp. The publishable set is a
// different set: it must recognize MP4 (every Reel and Story video) and the
// raster formats Meta's capability declaration accepts (bmp/gif/tiff), and it
// must NOT accept PDF, which can never be published to a social placement.
// Widening the Briefing sniffer would change what a briefing upload accepts,
// so the vocabularies stay separate.

import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

/**
 * Formats a publishable asset may be uploaded in.
 *
 * This list is the OUTER bound of the pipeline, not the publishing rule. What
 * a given placement actually accepts comes from the provider's declared
 * `PublisherCapabilities` and is enforced at schedule time by
 * `checkMediaAssetCapability`. A format here is merely one the platform can
 * store, sniff and read metadata from; it may still be refused for a specific
 * placement, and that refusal is the capability's call, never this file's.
 *
 * SVG IS DELIBERATELY ABSENT, for the reason `brand-kit-upload.rules.ts`
 * spells out: it is an executable XML document and this repository has no SVG
 * sanitizer. No social placement accepts it either, so refusing costs nothing.
 */
export const MEDIA_ASSET_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/tiff',
  'video/mp4',
  'video/quicktime',
] as const;

export type MediaAssetAllowedMimeType =
  (typeof MEDIA_ASSET_ALLOWED_MIME_TYPES)[number];

/**
 * Hard ceiling at the transport layer.
 *
 * 300 MB is the largest `maxBytes` any declared Meta placement carries
 * (Facebook Page Reels and Instagram Reels). It is a memory guard, not the
 * publishing limit: a 300 MB file uploads fine and is then refused at
 * schedule time for a placement that caps at 8 MB. Keeping the transport
 * ceiling at the maximum of the declared set means the capability declaration
 * stays the single source of the real limit — if Meta raises a placement cap
 * tomorrow, only `meta-capabilities.ts` changes.
 */
export const MEDIA_ASSET_MAX_UPLOAD_BYTES = 300 * 1024 * 1024;

/**
 * Sniffs the real content type from the BYTES.
 *
 * The declared MIME type and the filename extension are both
 * attacker-controlled and are never what gets stored. The declared value is
 * consulted only to answer an obvious mistake with a clear message before the
 * sniffer speaks.
 */
export function detectMediaAssetMimeType(
  buffer: Buffer,
): MediaAssetAllowedMimeType | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer.subarray(1, 4).toString('latin1') === 'PNG'
  ) {
    return 'image/png';
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buffer.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }

  if (buffer.length >= 6 && buffer.subarray(0, 3).toString('latin1') === 'GIF') {
    return 'image/gif';
  }

  if (buffer.length >= 2 && buffer.subarray(0, 2).toString('latin1') === 'BM') {
    return 'image/bmp';
  }

  // TIFF carries a byte-order mark followed by the magic number 42 in that
  // same order — both variants are checked so an endianness difference is not
  // read as a different format.
  if (
    buffer.length >= 4 &&
    ((buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00) ||
      (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a))
  ) {
    return 'image/tiff';
  }

  // ISO Base Media (MP4 / QuickTime): `....ftyp<brand>` at offset 4. The brand
  // separates the two containers; `qt  ` is QuickTime, everything else in the
  // ISO family is treated as MP4. Anything without an `ftyp` box is not a
  // container this platform can read metadata from, so it stays unrecognized
  // rather than being optimistically labelled a video.
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('latin1') === 'ftyp') {
    return buffer.subarray(8, 12).toString('latin1') === 'qt  '
      ? 'video/quicktime'
      : 'video/mp4';
  }

  return null;
}

/**
 * Resolves the content type to store, refusing anything the pipeline cannot
 * publish. The sniffed value wins over the declared one in every case.
 */
export function resolveMediaAssetContentType(
  buffer: Buffer,
  declaredMimeType: string | undefined,
): MediaAssetAllowedMimeType {
  const declared = (declaredMimeType ?? '').toLowerCase().split(';')[0].trim();

  if (declared === 'image/svg+xml') {
    throw new BadRequestException(
      'SVG não é aceito. Envie a mídia em PNG, JPEG, WebP ou MP4.',
    );
  }

  const detected = detectMediaAssetMimeType(buffer);

  if (detected === null) {
    throw new BadRequestException(
      'Não foi possível reconhecer o formato deste arquivo. Envie imagem (JPEG, PNG, WebP, GIF, BMP, TIFF) ou vídeo MP4.',
    );
  }

  return detected;
}

export function assertMediaAssetSize(byteLength: number): void {
  if (byteLength <= 0) {
    throw new BadRequestException('O arquivo enviado está vazio.');
  }

  if (byteLength > MEDIA_ASSET_MAX_UPLOAD_BYTES) {
    const megabytes = Math.floor(MEDIA_ASSET_MAX_UPLOAD_BYTES / (1024 * 1024));
    throw new BadRequestException(
      `O arquivo excede o limite de ${megabytes} MB.`,
    );
  }
}

/**
 * Reduces a user-supplied filename to something safe to store and display.
 *
 * Metadata only — it never reaches the storage key (see
 * `buildMediaAssetObjectKey`), so this is not the security boundary. It
 * exists so a hostile name cannot travel intact into a UI, a log line or a
 * `Content-Disposition` header.
 */
export function sanitizeMediaAssetFilename(originalName: string): string {
  const base = (originalName ?? '')
    .split(/[\\/]/)
    .pop()!
    .normalize('NFKD')
    .replace(/[^\w.\- ]+/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '')
    .trim();

  if (!base) return 'arquivo';

  return base.slice(0, 200);
}

const EXTENSION_BY_MIME: Record<MediaAssetAllowedMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

/**
 * The private-bucket key.
 *
 * Built entirely from server-controlled ids — tenant, scope and a fresh asset
 * uuid — with the extension derived from the SNIFFED content type. No part of
 * the user's filename appears in it, so traversal and collisions are
 * impossible by construction rather than by filtering.
 *
 * The client scope is part of the path so an operator auditing the bucket can
 * tell whose media an object is without joining back to the database. It is
 * NOT an authorization token: knowing a key grants nothing, because every read
 * path resolves the row and re-checks the scope triple first.
 */
export function buildMediaAssetObjectKey(input: {
  tenantId: string;
  agencyClientId: string | null;
  assetId?: string;
  contentType: MediaAssetAllowedMimeType;
}): { objectKey: string; assetId: string } {
  const assetId = input.assetId ?? randomUUID();
  const scope = input.agencyClientId
    ? `clients/${input.agencyClientId}`
    : 'agency';
  const extension = EXTENSION_BY_MIME[input.contentType];

  return {
    assetId,
    objectKey: `media-assets/${input.tenantId}/${scope}/${assetId}.${extension}`,
  };
}
