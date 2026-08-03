/**
 * The only shape ever passed to a logger or stored in a job's lastError.
 * Mirrors InboxProviderError (inbox/runtime/inbox-runtime.contracts.ts):
 * a short safe code, never the raw underlying message, document text, or
 * provider response body.
 */
export class LeadFlowBriefingExtractionError extends Error {
  constructor(
    readonly code: string,
    readonly attempts?: number,
  ) {
    super(code);
    this.name = 'LeadFlowBriefingExtractionError';
  }
}

const SAFE_CODE_PATTERN = /^[a-z0-9_]{1,80}$/;

/** Normalizes any thrown value into a short, log-safe code — never echoes raw error text. */
export function errorCode(error: unknown): string {
  if (error instanceof LeadFlowBriefingExtractionError) return error.code;
  const value =
    error instanceof Error ? error.message : 'extraction_job_failed';
  return SAFE_CODE_PATTERN.test(value) ? value : 'extraction_job_failed';
}
