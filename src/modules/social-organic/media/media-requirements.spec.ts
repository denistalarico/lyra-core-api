import type { PublisherCapabilities } from '../providers/provider-capabilities';
import { resolveMediaRequirements } from './media-requirements';

function capabilities(placements: readonly string[]): PublisherCapabilities {
  return {
    provider: 'meta',
    assetType: 'facebook_page',
    placements,
    media: { acceptedMimeTypes: ['image/jpeg'], maxBytes: 1_000 },
    supportsScheduling: true,
    supportsCaption: true,
    supportsFirstComment: false,
    supportsHashtags: false,
    requiresReconciliation: false,
    supportsRemoval: false,
  };
}

describe('resolveMediaRequirements', () => {
  it('resolves the capabilities when the placement is declared', () => {
    const caps = capabilities(['feed', 'story']);

    const result = resolveMediaRequirements(caps, 'story');

    expect(result).toEqual({ valid: true, capabilities: caps });
  });

  it('rejects a placement the asset type does not declare', () => {
    const result = resolveMediaRequirements(capabilities(['feed']), 'reel');

    expect(result).toEqual({
      valid: false,
      error: { field: 'placement', reason: 'unsupported_placement' },
    });
  });

  it('rejects every placement when none are declared', () => {
    const result = resolveMediaRequirements(capabilities([]), 'feed');

    expect(result.valid).toBe(false);
  });
});
