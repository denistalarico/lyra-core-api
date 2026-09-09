// src/modules/social-organic/publication/views/social-publisher-capability.view.ts
//
// The read projection of a provider's declared capabilities (Social Planner
// E3), so the composer never hardcodes a format.
//
// WHY THE UI NEEDS THIS AT ALL
// ----------------------------
// Every media rule that decides whether a publication can be scheduled lives
// in `PublisherCapabilities`. A frontend that repeats those numbers — "Reels
// are 3 to 90 seconds", "feed images max 8 MB" — is a second copy that drifts
// the first time Meta changes one, and it drifts in the direction that hurts:
// the UI offers something the validator then refuses, with no explanation the
// operator can act on. Serving the declaration means client-side validation is
// the same rule, just applied earlier.
//
// Note what is NOT in this view: `requiresReconciliation` and
// `supportsRemoval` are adapter implementation facts (does this adapter poll
// after publishing, can it delete). They tell an operator nothing about what
// to compose and are omitted rather than passed through by reflex.

import type { PublisherCapabilities } from '../../providers/provider-capabilities';

export type SocialPublisherPlacementMediaView = {
  placement: string;
  acceptedMimeTypes: string[];
  maxBytes: number;
  minDurationSeconds: number | null;
  maxDurationSeconds: number | null;
  aspectRatios: string[] | null;
};

export type SocialPublisherCapabilityView = {
  provider: string;
  assetType: string;
  placements: SocialPublisherPlacementMediaView[];
  supportsScheduling: boolean;
  supportsCaption: boolean;
  supportsFirstComment: boolean;
  supportsHashtags: boolean;
};

export function toSocialPublisherCapabilityView(
  capabilities: PublisherCapabilities,
): SocialPublisherCapabilityView {
  return {
    provider: capabilities.provider,
    assetType: capabilities.assetType,
    /**
     * Driven by `placements`, and a placement with no `media` block is
     * dropped rather than emitted with empty rules.
     *
     * `resolveMediaRequirements` treats that disagreement as a
     * declaration bug and fails closed with `unsupported_placement`. If this
     * view emitted the placement anyway, the UI would offer a destination
     * that the scheduler refuses every single time. Fail closed here too, so
     * the two agree.
     */
    placements: capabilities.placements.flatMap((placement) => {
      const media = capabilities.media[placement];
      if (media === undefined) return [];

      return [
        {
          placement,
          acceptedMimeTypes: [...media.acceptedMimeTypes],
          maxBytes: media.maxBytes,
          minDurationSeconds: media.minDurationSeconds ?? null,
          maxDurationSeconds: media.maxDurationSeconds ?? null,
          /**
           * `null`, not `[]`. An absent `aspectRatios` imposes no constraint
           * (M1's own semantics), while an empty array read literally by a
           * client would mean "no ratio is acceptable" — the opposite. The
           * distinction is preserved so client-side validation can mirror the
           * server rather than invert it.
           */
          aspectRatios: media.aspectRatios ? [...media.aspectRatios] : null,
        },
      ];
    }),
    supportsScheduling: capabilities.supportsScheduling,
    supportsCaption: capabilities.supportsCaption,
    supportsFirstComment: capabilities.supportsFirstComment,
    supportsHashtags: capabilities.supportsHashtags,
  };
}
