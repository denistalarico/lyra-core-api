/**
 * The failure codes "Analisar com Orion" can produce.
 *
 * A code rather than a sentence, for the same reason the Planner's generation
 * errors are codes: the controller maps them onto HTTP statuses and the
 * frontend maps them onto copy, and a message assembled in the service would
 * have to be translated in two places at once.
 */
export type SocialAnalyticsInsightErrorCode =
  | 'insight_provider_disabled'
  | 'insight_provider_timeout'
  | 'insight_provider_rate_limited'
  | 'insight_provider_unavailable'
  | 'insight_provider_request_rejected'
  | 'insight_response_missing'
  | 'insight_schema_invalid'
  | 'insight_context_empty';

export class SocialAnalyticsInsightError extends Error {
  constructor(
    readonly code: SocialAnalyticsInsightErrorCode,
    readonly attempts = 1,
  ) {
    super(code);
    this.name = 'SocialAnalyticsInsightError';
  }
}
