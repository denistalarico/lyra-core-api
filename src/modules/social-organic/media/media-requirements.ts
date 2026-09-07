import type {
  PublisherCapabilities,
  PublisherMediaCapabilities,
} from '../providers/provider-capabilities';

/**
 * Narrows a provider's declared capabilities to the one placement an operator
 * picked. `media-validation.ts` is the only consumer — kept separate so the
 * "which placement did they mean" lookup stays out of the pure validation
 * function.
 *
 * `MA2.1`: `PublisherCapabilities.media` is keyed by placement, so this is
 * the one place that resolves `placement` to a single `media` block — every
 * other consumer of a resolved result works with one placement's rules only,
 * never the whole map. Both `placements.includes(placement)` and
 * `media[placement]` must agree; a placement declared in one but missing
 * from the other is a capability-declaration bug, not a valid request, so it
 * fails closed the same as an undeclared placement.
 */
export type MediaRequirementsError = {
  readonly field: 'placement';
  readonly reason: 'unsupported_placement';
};

export type MediaRequirementsResult =
  | {
      readonly valid: true;
      readonly capabilities: PublisherCapabilities;
      readonly media: PublisherMediaCapabilities;
    }
  | { readonly valid: false; readonly error: MediaRequirementsError };

export function resolveMediaRequirements(
  capabilities: PublisherCapabilities,
  placement: string,
): MediaRequirementsResult {
  const media = capabilities.placements.includes(placement)
    ? capabilities.media[placement]
    : undefined;

  if (media === undefined) {
    return {
      valid: false,
      error: { field: 'placement', reason: 'unsupported_placement' },
    };
  }

  return { valid: true, capabilities, media };
}
