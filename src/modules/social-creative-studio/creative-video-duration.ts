import {
  MAX_VIDEO_DURATION_SECONDS,
  MIN_VIDEO_DURATION_SECONDS,
  type CreativeVideoOperationKind,
  type VideoProviderCapabilities,
} from './creative-video-generation.provider';

export type PlannedVideoOperation = {
  readonly sequence: number;
  readonly kind: CreativeVideoOperationKind;
  /** Seconds this operation produces (generate) or adds (extend). */
  readonly durationSeconds: number;
};

/**
 * CS4-B — how a generative Reel of `desired` seconds is produced with the
 * provider's NATIVE capabilities only:
 *
 *   desired <= native max  → one generation;
 *   desired >  native max  → a native-max generation, then native extensions
 *                            splitting the rest as evenly as possible (fewest
 *                            extensions: each one carries a fixed base charge).
 *
 * No compositor, no FFmpeg, no manual concatenation: an extension is a
 * provider job that continues the previous output. For the domain it stays
 * ONE generation; every operation is persisted for cost and provenance.
 *
 * Returns null when the provider cannot reach `desired` natively (no
 * extension, or the source would exceed what extensions accept) — the caller
 * refuses the request instead of promising a duration it cannot deliver.
 */
export function planGenerativeReelOperations(
  desired: number,
  capabilities: VideoProviderCapabilities,
): PlannedVideoOperation[] | null {
  if (
    !Number.isInteger(desired) ||
    desired <
      Math.max(MIN_VIDEO_DURATION_SECONDS, capabilities.nativeMinSeconds) ||
    desired > MAX_VIDEO_DURATION_SECONDS
  )
    return null;
  if (desired <= capabilities.nativeMaxSeconds)
    return [{ sequence: 0, kind: 'generate', durationSeconds: desired }];

  const extension = capabilities.extension;
  if (!extension) return null;
  const rest = desired - capabilities.nativeMaxSeconds;
  const count = Math.ceil(rest / extension.maxSeconds);
  const base = Math.floor(rest / count);
  const remainder = rest % count;
  const extensions = Array.from(
    { length: count },
    (_, index) => base + (index < remainder ? 1 : 0),
  );
  if (extensions.some((seconds) => seconds < extension.minSeconds)) return null;
  // The last extension's source is everything before it.
  if (
    capabilities.extensionSourceMaxSeconds !== null &&
    desired - extensions[extensions.length - 1] >
      capabilities.extensionSourceMaxSeconds
  )
    return null;
  return [
    {
      sequence: 0,
      kind: 'generate',
      durationSeconds: capabilities.nativeMaxSeconds,
    },
    ...extensions.map((seconds, index) => ({
      sequence: index + 1,
      kind: 'extend' as const,
      durationSeconds: seconds,
    })),
  ];
}
