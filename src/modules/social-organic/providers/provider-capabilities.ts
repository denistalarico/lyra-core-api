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

export type PublisherCapabilities = {
  readonly provider: string;
  readonly assetType: string;
  /** Editorial placements this asset type can publish to, e.g. feed, story, reel. */
  readonly placements: readonly string[];
  readonly media: PublisherMediaCapabilities;
  readonly supportsScheduling: boolean;
  readonly supportsCaption: boolean;
  readonly supportsFirstComment: boolean;
  readonly supportsHashtags: boolean;
  /** True only when the adapter implements `reconcile()` (async publish flow). */
  readonly requiresReconciliation: boolean;
  /** True only when the adapter implements `remove()`. */
  readonly supportsRemoval: boolean;
};
