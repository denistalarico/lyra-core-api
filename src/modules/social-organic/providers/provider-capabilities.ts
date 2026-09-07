/**
 * Static capability declaration for one provider/asset-type pair.
 *
 * Drives UI (what an operator may even attempt) and pre-flight validation
 * (M1's media rules are sourced from here, never hardcoded per provider).
 */
export type PublisherMediaCapabilities = {
  readonly acceptedMimeTypes: readonly string[];
  readonly maxBytes: number;
  readonly minDurationSeconds?: number;
  readonly maxDurationSeconds?: number;
  readonly aspectRatios?: readonly string[];
  readonly maxItemsPerPost?: number;
};

/**
 * One `media` block per declared placement (`MA2.1`) — a provider's real
 * media constraints vary by editorial placement (Reels vs. feed vs. Stories
 * all differ sharply for Meta), so a single shared block either over- or
 * under-constrains at least one placement. Every key here MUST also appear
 * in `PublisherCapabilities.placements`; `resolveMediaRequirements` is the
 * one place that enforces this and turns a lookup miss into a fail-closed
 * `unsupported_placement` result — no caller should index this map itself.
 */
export type PublisherPlacementMedia = Readonly<
  Record<string, PublisherMediaCapabilities>
>;

export type PublisherCapabilities = {
  readonly provider: string;
  readonly assetType: string;
  /** Editorial placements this asset type can publish to, e.g. feed, story, reel. */
  readonly placements: readonly string[];
  /** Per-placement media rules. Keyed by the same strings as `placements`. */
  readonly media: PublisherPlacementMedia;
  readonly supportsScheduling: boolean;
  readonly supportsCaption: boolean;
  readonly supportsFirstComment: boolean;
  readonly supportsHashtags: boolean;
  /** True only when the adapter implements `reconcile()` (async publish flow). */
  readonly requiresReconciliation: boolean;
  /** True only when the adapter implements `remove()`. */
  readonly supportsRemoval: boolean;
};
