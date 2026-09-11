/**
 * The only shape ever logged or stored in a run's `lastError`.
 *
 * Same rule as `LeadFlowBriefingExtractionError`: a short safe code, never the
 * provider's response body, never the editorial text that was sent. §3 of the
 * E8 handoff forbids rendering backend or provider errors literally, and the
 * reliable way to keep that promise is for the raw text never to be persisted
 * where a future UI could find it and print it.
 */
export class SocialCopyGenerationError extends Error {
  constructor(
    readonly code: string,
    readonly attempts?: number,
  ) {
    super(code);
    this.name = 'SocialCopyGenerationError';
  }
}

const SAFE_CODE_PATTERN = /^[a-z0-9_]{1,80}$/;

/** Normalizes any thrown value into a short, log-safe code. */
export function copyGenerationErrorCode(error: unknown): string {
  if (error instanceof SocialCopyGenerationError) return error.code;
  const value = error instanceof Error ? error.message : 'generation_failed';
  return SAFE_CODE_PATTERN.test(value) ? value : 'generation_failed';
}
