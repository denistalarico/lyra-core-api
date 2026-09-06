import type { PublisherCapabilities } from '../providers/provider-capabilities';

/**
 * Narrows a provider's declared capabilities to the one placement an operator
 * picked. `media-validation.ts` is the only consumer — kept separate so the
 * "which placement did they mean" lookup stays out of the pure validation
 * function.
 */
export type MediaRequirementsError = {
  readonly field: 'placement';
  readonly reason: 'unsupported_placement';
};

export type MediaRequirementsResult =
  | { readonly valid: true; readonly capabilities: PublisherCapabilities }
  | { readonly valid: false; readonly error: MediaRequirementsError };

export function resolveMediaRequirements(
  capabilities: PublisherCapabilities,
  placement: string,
): MediaRequirementsResult {
  if (!capabilities.placements.includes(placement)) {
    return {
      valid: false,
      error: { field: 'placement', reason: 'unsupported_placement' },
    };
  }

  return { valid: true, capabilities };
}
