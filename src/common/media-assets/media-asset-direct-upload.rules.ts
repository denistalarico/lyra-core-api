// src/common/media-assets/media-asset-direct-upload.rules.ts
//
// Direct upload (2026-11-18): heavy videos go from the browser straight to R2
// in parts, so their bytes never cross the VPS (no RAM buffer, no nginx temp
// file). The API only presigns the parts and, at the end, verifies the stored
// object by reading its first bytes and its ISO `moov` box through ranged GETs.
//
// The upload is STATELESS on our side: its identity travels in an HMAC-signed
// token bound to scope and actor. An abandoned multipart upload holds no row;
// R2 discards incomplete multipart uploads on its own.

import { BadRequestException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { CreativeDocumentMimeType } from './media-asset-upload.rules';

/** Owner's decision (2026-11-18): videos up to 2 GB. */
export const MEDIA_ASSET_DIRECT_UPLOAD_MAX_BYTES = 2 * 1024 * 1024 * 1024;
/** 16 MiB parts: 128 parts for 2 GB, far below S3's 10 000. */
export const MEDIA_ASSET_DIRECT_UPLOAD_PART_BYTES = 16 * 1024 * 1024;
/** How long one upload may take end to end (slow uplinks included). */
export const MEDIA_ASSET_DIRECT_UPLOAD_TOKEN_TTL_SECONDS = 12 * 60 * 60;
/** Part URLs are minted in batches, just before use. */
export const MEDIA_ASSET_DIRECT_UPLOAD_PART_URL_TTL_SECONDS = 30 * 60;
export const MEDIA_ASSET_DIRECT_UPLOAD_MAX_PARTS_PER_SIGN = 20;
export const MEDIA_ASSET_DIRECT_UPLOAD_MIME_TYPES = [
  'video/mp4',
  'video/quicktime',
] as const;
/** A `moov` this large means a broken or hostile file, not a long video. */
const ISO_HEAD_BOX_MAX_BYTES = 64 * 1024 * 1024;
const ISO_HEAD_MAX_TOP_LEVEL_BOXES = 64;

export type DirectUploadMimeType =
  (typeof MEDIA_ASSET_DIRECT_UPLOAD_MIME_TYPES)[number];

export type DirectUploadClaims = {
  readonly v: 1;
  readonly path: string;
  readonly uploadId: string;
  readonly assetId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly agencyClientId: string | null;
  readonly companyContextId: string | null;
  readonly actorUserId: string | null;
  readonly source: string;
  readonly mimeType: DirectUploadMimeType | CreativeDocumentMimeType;
  readonly byteSize: number;
  readonly filename: string;
  /** Epoch seconds. */
  readonly exp: number;
};

const INVALID_TOKEN = 'Envio expirado ou inválido. Envie o arquivo novamente.';

export function directUploadPartCount(byteSize: number): number {
  return Math.ceil(byteSize / MEDIA_ASSET_DIRECT_UPLOAD_PART_BYTES);
}

/** Validates what the browser declares before anything is created in R2. */
export function assertDirectUploadRequest(input: {
  mimeType: string;
  byteSize: number;
}): DirectUploadMimeType {
  const mimeType = input.mimeType.toLowerCase().split(';')[0].trim();
  if (
    !(MEDIA_ASSET_DIRECT_UPLOAD_MIME_TYPES as readonly string[]).includes(
      mimeType,
    )
  ) {
    throw new BadRequestException(
      'O envio direto aceita apenas vídeo MP4 ou MOV.',
    );
  }
  assertDirectUploadSize(input.byteSize);
  return mimeType as DirectUploadMimeType;
}

export function assertDirectUploadSize(byteSize: number): void {
  if (!Number.isSafeInteger(byteSize) || byteSize <= 0) {
    throw new BadRequestException('O arquivo enviado está vazio.');
  }
  if (byteSize > MEDIA_ASSET_DIRECT_UPLOAD_MAX_BYTES) {
    throw new BadRequestException('O vídeo excede o limite de 2 GB.');
  }
}

/** Part numbers the caller may sign: unique, inside the upload, bounded per call. */
export function assertDirectUploadPartNumbers(
  partNumbers: readonly number[],
  partCount: number,
): void {
  const unique = new Set(partNumbers);
  if (
    partNumbers.length === 0 ||
    partNumbers.length > MEDIA_ASSET_DIRECT_UPLOAD_MAX_PARTS_PER_SIGN ||
    unique.size !== partNumbers.length ||
    partNumbers.some(
      (part) => !Number.isInteger(part) || part < 1 || part > partCount,
    )
  ) {
    throw new BadRequestException('Partes do envio inválidas.');
  }
}

/** Every part exactly once, in order, each with the ETag R2 returned. */
export function normalizeDirectUploadParts(
  parts: ReadonlyArray<{ partNumber: number; etag: string }>,
  partCount: number,
): Array<{ partNumber: number; etag: string }> {
  const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
  const complete =
    sorted.length === partCount &&
    sorted.every(
      (part, index) =>
        part.partNumber === index + 1 &&
        typeof part.etag === 'string' &&
        part.etag.trim().length > 0,
    );
  if (!complete) {
    throw new BadRequestException(
      'O envio ficou incompleto. Envie o arquivo novamente.',
    );
  }
  return sorted.map((part) => ({
    partNumber: part.partNumber,
    etag: part.etag.trim(),
  }));
}

export function signDirectUploadToken(
  claims: DirectUploadClaims,
  secret: Buffer,
): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyDirectUploadToken(
  token: string,
  secret: Buffer,
  nowSeconds: number,
): DirectUploadClaims {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) {
    throw new BadRequestException(INVALID_TOKEN);
  }
  const expected = createHmac('sha256', secret).update(payload).digest();
  const received = Buffer.from(signature, 'base64url');
  if (
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  ) {
    throw new BadRequestException(INVALID_TOKEN);
  }
  let claims: DirectUploadClaims;
  try {
    claims = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as DirectUploadClaims;
  } catch {
    throw new BadRequestException(INVALID_TOKEN);
  }
  if (claims?.v !== 1 || !(claims.exp > nowSeconds)) {
    throw new BadRequestException(INVALID_TOKEN);
  }
  return claims;
}

/**
 * Returns `ftyp` + `moov` of an ISO BMFF object, read box by box through
 * ranged reads, so `MediaMetadataService` can parse a 2 GB video from a few
 * hundred kilobytes. `mdat` (the media itself) is skipped by its declared
 * size and never read. Wherever the encoder put `moov` — start (fast start)
 * or end — the walk finds it in a handful of requests.
 */
export async function readIsoMediaHead(
  read: (start: number, endInclusive: number) => Promise<Buffer>,
  totalBytes: number,
): Promise<Buffer> {
  const unreadable = () =>
    new BadRequestException(
      'Não foi possível ler este vídeo. Envie um MP4 ou MOV válido.',
    );
  const found: Buffer[] = [];
  let hasFtyp = false;
  let hasMoov = false;
  let offset = 0;

  for (
    let boxes = 0;
    offset < totalBytes && boxes < ISO_HEAD_MAX_TOP_LEVEL_BOXES;
    boxes += 1
  ) {
    const header = await read(offset, Math.min(offset + 15, totalBytes - 1));
    if (header.length < 8) throw unreadable();
    const declared = header.readUInt32BE(0);
    const type = header.toString('latin1', 4, 8);
    let size = declared;
    if (declared === 1) {
      if (header.length < 16) throw unreadable();
      size = Number(header.readBigUInt64BE(8));
    } else if (declared === 0) {
      size = totalBytes - offset;
    }
    if (!Number.isSafeInteger(size) || size < 8 || offset + size > totalBytes) {
      throw unreadable();
    }
    if (type === 'ftyp' || type === 'moov') {
      if (size > ISO_HEAD_BOX_MAX_BYTES) throw unreadable();
      found.push(await read(offset, offset + size - 1));
      if (type === 'ftyp') hasFtyp = true;
      else hasMoov = true;
      if (hasFtyp && hasMoov) return Buffer.concat(found);
    }
    offset += size;
  }

  throw unreadable();
}
