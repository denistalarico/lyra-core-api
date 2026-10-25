export type OrionProviderErrorCode =
  | 'orion_provider_disabled'
  | 'orion_provider_unavailable'
  | 'orion_provider_timeout'
  | 'orion_provider_rate_limited'
  | 'orion_provider_request_rejected'
  | 'orion_response_invalid';

/** A provider call that did not produce an answer. `attempts` = paid tries. */
export class OrionProviderError extends Error {
  constructor(
    readonly code: OrionProviderErrorCode,
    readonly attempts = 0,
  ) {
    super(code);
    this.name = 'OrionProviderError';
  }
}

export type OrionLimitCode =
  | 'orion_budget_exhausted'
  | 'orion_rate_limited'
  | 'orion_turn_in_progress'
  | 'orion_turn_replayed';

/** The turn was refused before any provider call; nothing was reserved. */
export class OrionLimitError extends Error {
  constructor(readonly code: OrionLimitCode) {
    super(code);
    this.name = 'OrionLimitError';
  }
}
