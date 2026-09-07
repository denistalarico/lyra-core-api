import type {
  ValidationIssue,
  ValidationResult,
} from '../providers/social-publisher.adapter';
import type { PublisherCapabilities } from '../providers/provider-capabilities';
import type { ExtractedMediaMetadata } from './media-metadata.service';
import { resolveMediaRequirements } from './media-requirements';

/**
 * Rejects impossible media at schedule time (blueprint §11.3 r.2), not in the
 * worker. Pure function over already-extracted metadata (`M2`) and a
 * provider's declared capabilities (`P4`) — no I/O, no provider knowledge.
 *
 * Never branches on where the media came from (ADR-014): a Creative Studio
 * asset and a direct upload reach here as the same `ExtractedMediaMetadata`
 * shape, so this function cannot tell them apart even if it wanted to.
 */
export function validateMediaAgainstCapabilities(
  metadata: ExtractedMediaMetadata,
  capabilities: PublisherCapabilities,
  placement: string,
): ValidationResult {
  const requirements = resolveMediaRequirements(capabilities, placement);
  if (!requirements.valid) {
    return {
      valid: false,
      issues: [
        { field: requirements.error.field, reason: requirements.error.reason },
      ],
    };
  }

  const issues: ValidationIssue[] = [];
  const media = requirements.media;

  if (!media.acceptedMimeTypes.includes(metadata.mimeType)) {
    issues.push({
      field: 'mimeType',
      reason: `unsupported_mime_type:${metadata.mimeType}`,
    });
  }

  if (metadata.bytes > media.maxBytes) {
    issues.push({ field: 'bytes', reason: 'exceeds_max_bytes' });
  }

  if (metadata.kind === 'video') {
    if (
      media.minDurationSeconds !== undefined &&
      (metadata.durationSeconds === null ||
        metadata.durationSeconds < media.minDurationSeconds)
    ) {
      issues.push({ field: 'durationSeconds', reason: 'below_min_duration' });
    }

    if (
      media.maxDurationSeconds !== undefined &&
      (metadata.durationSeconds === null ||
        metadata.durationSeconds > media.maxDurationSeconds)
    ) {
      issues.push({ field: 'durationSeconds', reason: 'exceeds_max_duration' });
    }
  }

  if (
    media.aspectRatios !== undefined &&
    media.aspectRatios.length > 0 &&
    !matchesAnyAspectRatio(metadata.aspectRatio, media.aspectRatios)
  ) {
    issues.push({ field: 'aspectRatio', reason: 'unsupported_aspect_ratio' });
  }

  return issues.length === 0 ? { valid: true } : { valid: false, issues };
}

const ASPECT_RATIO_TOLERANCE = 0.02;

/**
 * Capabilities declare aspect ratios as `"W:H"` strings (e.g. `"9:16"`);
 * extracted metadata carries a plain ratio (`width / height`). A small
 * tolerance absorbs encoder rounding — real-world 9:16 media rarely comes
 * back as exactly `0.5625`.
 */
function matchesAnyAspectRatio(
  actual: number,
  declared: readonly string[],
): boolean {
  return declared.some((entry) => {
    const parsed = parseAspectRatio(entry);
    return (
      parsed !== null && Math.abs(actual - parsed) <= ASPECT_RATIO_TOLERANCE
    );
  });
}

function parseAspectRatio(value: string): number | null {
  const parts = value.split(':');
  if (parts.length !== 2) {
    return null;
  }

  const width = Number(parts[0]);
  const height = Number(parts[1]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || height === 0) {
    return null;
  }

  return width / height;
}
