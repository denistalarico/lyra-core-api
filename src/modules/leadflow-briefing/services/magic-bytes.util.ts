import { BadRequestException } from '@nestjs/common';

export type BriefingFileKind = 'pdf' | 'jpeg' | 'png' | 'webp' | 'unknown';

export const BRIEFING_FILE_KIND_MIME: Record<Exclude<BriefingFileKind, 'unknown'>, string> = {
  pdf: 'application/pdf',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/**
 * Sniffs a buffer's real type from its magic bytes — never trusts a
 * client-supplied MIME type/extension. Shared generalization of the
 * one-off check in meta-media-ingestion.worker.ts's assertMagicBytes.
 */
export function detectFileKind(buffer: Buffer): BriefingFileKind {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-') {
    return 'pdf';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer.subarray(1, 4).toString('latin1') === 'PNG'
  ) {
    return 'png';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buffer.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'webp';
  }
  return 'unknown';
}

export function assertExpectedKind(
  buffer: Buffer,
  allowed: ReadonlySet<Exclude<BriefingFileKind, 'unknown'>>,
): Exclude<BriefingFileKind, 'unknown'> {
  const kind = detectFileKind(buffer);
  if (kind === 'unknown' || !allowed.has(kind)) {
    throw new BadRequestException('Unsupported or unrecognized file type.');
  }
  return kind;
}
