// src/modules/brand-kit/brand-kit-upload.rules.ts
//
// Server-side upload rules for Brand Kit binaries (Lyra Social S1.4.9 §15/§16).
// Pure functions, so every rule is testable without a controller or a bucket.

import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MAX_IMAGE_UPLOAD_BYTES } from '../../common/files/files.service';
import {
  assertExpectedKind,
  BRIEFING_FILE_KIND_MIME,
  type BriefingFileKind,
} from '../leadflow-briefing/services/magic-bytes.util';

/**
 * The size ceiling is `MAX_IMAGE_UPLOAD_BYTES` (5 MB), reused from
 * `FilesService` rather than redeclared — one number, one place, already the
 * limit every other image upload in the platform obeys.
 */
export const BRAND_KIT_MAX_ASSET_BYTES = MAX_IMAGE_UPLOAD_BYTES;

/**
 * Accepted formats.
 *
 * SVG IS DELIBERATELY ABSENT (§15).
 * -----------------------------------
 * An SVG is an XML document that may carry `<script>`, `onload` handlers,
 * `xlink:href` to external resources and embedded foreign objects. Served
 * back to a browser it is executable content, so it may only be accepted
 * behind a real SVG sanitizer. This repository has none: `sanitize-html` is
 * an HTML sanitizer, and pointing it at SVG would be precisely the
 * improvised parser the phase brief forbids. `detectFileKind` cannot
 * recognize SVG either — it is text, with no magic bytes — so an SVG upload
 * could not even be type-checked the way the raster formats are.
 *
 * Refusing is the documented, architecture-sanctioned v1 choice ("SVG:
 * sanitizar ou recusar — recusar é aceitável na v1"). Accepting SVG becomes
 * possible the day a vetted sanitizer is added; until then, a logo must be
 * uploaded as PNG/WebP.
 */
export const BRAND_KIT_ALLOWED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

export type BrandKitAllowedMimeType =
  (typeof BRAND_KIT_ALLOWED_MIME_TYPES)[number];

/** The magic-bytes kinds matching the MIME allowlist above. */
const ALLOWED_FILE_KINDS = new Set<Exclude<BriefingFileKind, 'unknown'>>([
  'png',
  'jpeg',
  'webp',
]);

/**
 * Resolves the real content type from the BYTES, not from the client's
 * claimed MIME type or the filename extension — both are attacker-controlled.
 *
 * Order matters: the declared type is checked first only to reject obvious
 * mistakes with a clear message; the value that is actually stored and later
 * served always comes from the sniffed kind.
 */
export function resolveBrandKitContentType(
  buffer: Buffer,
  declaredMimeType: string | undefined,
): BrandKitAllowedMimeType {
  const declared = (declaredMimeType ?? '').toLowerCase().split(';')[0].trim();

  if (declared === 'image/svg+xml') {
    throw new BadRequestException(
      'SVG não é aceito nesta versão. Envie o logo em PNG ou WebP.',
    );
  }

  if (
    declared &&
    !BRAND_KIT_ALLOWED_MIME_TYPES.includes(declared as BrandKitAllowedMimeType)
  ) {
    throw new BadRequestException(
      `Formato não suportado. Aceitos: ${BRAND_KIT_ALLOWED_MIME_TYPES.join(', ')}.`,
    );
  }

  // Throws for anything whose real bytes are not png/jpeg/webp — including a
  // file renamed to .png, and including an SVG that claimed to be a PNG.
  const kind = assertExpectedKind(buffer, ALLOWED_FILE_KINDS);

  return BRIEFING_FILE_KIND_MIME[kind] as BrandKitAllowedMimeType;
}

export function assertBrandKitSize(byteLength: number): void {
  if (byteLength <= 0) {
    throw new BadRequestException('O arquivo enviado está vazio.');
  }

  if (byteLength > BRAND_KIT_MAX_ASSET_BYTES) {
    const megabytes = Math.floor(BRAND_KIT_MAX_ASSET_BYTES / (1024 * 1024));
    throw new BadRequestException(
      `O arquivo excede o limite de ${megabytes} MB.`,
    );
  }
}

/**
 * Reduces a user-supplied filename to something safe to store and display.
 *
 * This value is metadata only — it never reaches the storage key (see
 * `buildBrandKitObjectKey`), so this is not the security boundary. It exists
 * so a hostile name cannot travel intact into a UI, a log line or a
 * `Content-Disposition` header.
 */
export function sanitizeBrandKitFilename(originalName: string): string {
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

/**
 * The private-bucket key.
 *
 * Built entirely from server-controlled ids — tenant, scope and a fresh
 * asset uuid — with the extension derived from the SNIFFED content type. No
 * part of the user's filename appears in it, so path traversal and
 * collisions are impossible by construction rather than by filtering.
 *
 * The key is NOT an authorization token: knowing it grants nothing, because
 * the content endpoint resolves the asset row and re-checks tenant, context
 * and product before reading a single byte.
 */
export function buildBrandKitObjectKey(input: {
  tenantId: string;
  agencyClientId: string | null;
  assetId?: string;
  contentType: BrandKitAllowedMimeType;
}): { objectKey: string; assetId: string } {
  const assetId = input.assetId ?? randomUUID();
  const scope = input.agencyClientId
    ? `clients/${input.agencyClientId}`
    : 'agency';
  const extension = EXTENSION_BY_MIME[input.contentType];

  return {
    assetId,
    objectKey: `brand-kit/${input.tenantId}/${scope}/${assetId}.${extension}`,
  };
}

const EXTENSION_BY_MIME: Record<BrandKitAllowedMimeType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};
