import {
  META_FACEBOOK_PAGE_CAPABILITIES,
  META_INSTAGRAM_PROFESSIONAL_CAPABILITIES,
  getMetaCapabilities,
} from './meta-capabilities';

const ALL_DECLARATIONS = [
  META_FACEBOOK_PAGE_CAPABILITIES,
  META_INSTAGRAM_PROFESSIONAL_CAPABILITIES,
];

describe('Meta capability declaration (MA2.1 — per placement)', () => {
  it('matches the committed snapshot for facebook_page — a change here must be deliberate', () => {
    expect(META_FACEBOOK_PAGE_CAPABILITIES).toMatchSnapshot();
  });

  it('matches the committed snapshot for instagram_professional — a change here must be deliberate', () => {
    expect(META_INSTAGRAM_PROFESSIONAL_CAPABILITIES).toMatchSnapshot();
  });

  it('declares provider "meta" and the discovered assetType for both asset types', () => {
    expect(META_FACEBOOK_PAGE_CAPABILITIES.provider).toBe('meta');
    expect(META_FACEBOOK_PAGE_CAPABILITIES.assetType).toBe('facebook_page');
    expect(META_INSTAGRAM_PROFESSIONAL_CAPABILITIES.provider).toBe('meta');
    expect(META_INSTAGRAM_PROFESSIONAL_CAPABILITIES.assetType).toBe(
      'instagram_professional',
    );
  });

  it('declares a media block for every listed placement, and no extra ones', () => {
    for (const capabilities of ALL_DECLARATIONS) {
      const mediaKeys = Object.keys(capabilities.media).sort();
      const placementKeys = [...capabilities.placements].sort();
      expect(mediaKeys).toEqual(placementKeys);
    }
  });

  it('declares every aspect ratio (per placement) as a parseable "W:H" string, since M1 parses them literally', () => {
    for (const capabilities of ALL_DECLARATIONS) {
      for (const placement of capabilities.placements) {
        for (const ratio of capabilities.media[placement].aspectRatios ?? []) {
          const parts = ratio.split(':');
          expect(parts).toHaveLength(2);
          expect(Number.isFinite(Number(parts[0]))).toBe(true);
          expect(Number.isFinite(Number(parts[1]))).toBe(true);
        }
      }
    }
  });

  it('declares a positive maxBytes and, when present, min <= max duration for every placement', () => {
    for (const capabilities of ALL_DECLARATIONS) {
      for (const placement of capabilities.placements) {
        const media = capabilities.media[placement];
        expect(media.maxBytes).toBeGreaterThan(0);
        const { minDurationSeconds, maxDurationSeconds } = media;
        if (
          minDurationSeconds !== undefined &&
          maxDurationSeconds !== undefined
        ) {
          expect(minDurationSeconds).toBeLessThanOrEqual(maxDurationSeconds);
        }
      }
    }
  });

  it('getMetaCapabilities resolves the two discovered asset types', () => {
    expect(getMetaCapabilities('facebook_page')).toBe(
      META_FACEBOOK_PAGE_CAPABILITIES,
    );
    expect(getMetaCapabilities('instagram_professional')).toBe(
      META_INSTAGRAM_PROFESSIONAL_CAPABILITIES,
    );
  });

  it('getMetaCapabilities fails closed for an unknown assetType rather than returning undefined', () => {
    expect(() => getMetaCapabilities('unknown_asset_type')).toThrow(
      'Unknown Meta organic asset type: unknown_asset_type',
    );
  });

  describe('Facebook Page — per-placement limits do not leak into one another', () => {
    it('feed resolves its own limits (image only, 4 MB)', () => {
      const { media } = META_FACEBOOK_PAGE_CAPABILITIES;
      expect(media.feed.acceptedMimeTypes).toEqual(
        expect.arrayContaining(['image/jpeg', 'image/png']),
      );
      expect(media.feed.acceptedMimeTypes).not.toContain('video/mp4');
      expect(media.feed.maxBytes).toBe(4 * 1024 * 1024);
      expect(media.feed.aspectRatios).toBeUndefined();
    });

    it('reel resolves different limits than feed (video, 9:16, 3-90s)', () => {
      const { media } = META_FACEBOOK_PAGE_CAPABILITIES;
      expect(media.reel.acceptedMimeTypes).toEqual(['video/mp4']);
      expect(media.reel.aspectRatios).toEqual(['9:16']);
      expect(media.reel.minDurationSeconds).toBe(3);
      expect(media.reel.maxDurationSeconds).toBe(90);
      expect(media.reel.maxBytes).not.toBe(media.feed.maxBytes);
    });

    it('story resolves its own limits, distinct from feed and reel', () => {
      const { media } = META_FACEBOOK_PAGE_CAPABILITIES;
      expect(media.story.acceptedMimeTypes).toEqual(
        expect.arrayContaining(['image/jpeg', 'video/mp4']),
      );
      expect(media.story.maxDurationSeconds).toBe(60);
      expect(media.story.aspectRatios).toBeUndefined();
    });

    it('does not declare carousel — not sufficiently documented for Page feed', () => {
      expect(META_FACEBOOK_PAGE_CAPABILITIES.placements).not.toContain(
        'carousel',
      );
      expect(META_FACEBOOK_PAGE_CAPABILITIES.media.carousel).toBeUndefined();
    });
  });

  describe('Instagram Professional — per-placement limits do not leak into one another', () => {
    it('feed resolves its own limits (JPEG only, 4:5-1.91:1, 8 MB)', () => {
      const { media } = META_INSTAGRAM_PROFESSIONAL_CAPABILITIES;
      expect(media.feed.acceptedMimeTypes).toEqual(['image/jpeg']);
      expect(media.feed.maxBytes).toBe(8 * 1024 * 1024);
      expect(media.feed.aspectRatios).toEqual(['4:5', '1:1', '1.91:1']);
    });

    it('reel resolves different limits than feed (video, wider ratios, 300 MB)', () => {
      const { media } = META_INSTAGRAM_PROFESSIONAL_CAPABILITIES;
      expect(media.reel.acceptedMimeTypes).toEqual(['video/mp4']);
      expect(media.reel.maxBytes).toBe(300 * 1024 * 1024);
      expect(media.reel.maxBytes).not.toBe(media.feed.maxBytes);
      expect(media.reel.aspectRatios).not.toEqual(media.feed.aspectRatios);
    });

    it('story resolves its own limits (image + video, 100 MB)', () => {
      const { media } = META_INSTAGRAM_PROFESSIONAL_CAPABILITIES;
      expect(media.story.acceptedMimeTypes).toEqual(
        expect.arrayContaining(['image/jpeg', 'video/mp4']),
      );
      expect(media.story.maxBytes).toBe(100 * 1024 * 1024);
    });

    it('does not advertise carousel while Publication persists only one mediaAssetId', () => {
      const { media, placements } = META_INSTAGRAM_PROFESSIONAL_CAPABILITIES;
      expect(placements).not.toContain('carousel');
      expect(media.carousel).toBeUndefined();
    });
  });

  it('an unknown placement is not present in either declaration (fails closed via resolveMediaRequirements, not here)', () => {
    for (const capabilities of ALL_DECLARATIONS) {
      expect(capabilities.placements).not.toContain('unknown_placement');
      expect(
        (capabilities.media as Record<string, unknown>).unknown_placement,
      ).toBeUndefined();
    }
  });
});
