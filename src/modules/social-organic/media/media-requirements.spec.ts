import type { PublisherCapabilities } from '../providers/provider-capabilities';
import { resolveMediaRequirements } from './media-requirements';

function capabilities(placements: readonly string[]): PublisherCapabilities {
  const media = Object.fromEntries(
    placements.map((placement) => [
      placement,
      { acceptedMimeTypes: ['image/jpeg'], maxBytes: 1_000 },
    ]),
  );

  return {
    provider: 'meta',
    assetType: 'facebook_page',
    placements,
    media,
    supportsScheduling: true,
    supportsCaption: true,
    supportsFirstComment: false,
    supportsHashtags: false,
    requiresReconciliation: false,
    supportsRemoval: false,
  };
}

describe('resolveMediaRequirements', () => {
  it('resolves the capabilities and the placement-scoped media when the placement is declared', () => {
    const caps = capabilities(['feed', 'story']);

    const result = resolveMediaRequirements(caps, 'story');

    expect(result).toEqual({
      valid: true,
      capabilities: caps,
      media: caps.media.story,
    });
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

  it('fails closed when placements and media disagree (declared in one, missing from the other)', () => {
    const caps = capabilities(['feed', 'story']);
    const inconsistent: PublisherCapabilities = {
      ...caps,
      media: { feed: caps.media.feed },
    };

    const result = resolveMediaRequirements(inconsistent, 'story');

    expect(result).toEqual({
      valid: false,
      error: { field: 'placement', reason: 'unsupported_placement' },
    });
  });
});
