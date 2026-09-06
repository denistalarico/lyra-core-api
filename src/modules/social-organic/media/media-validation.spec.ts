import { readFileSync } from 'fs';
import { join } from 'path';
import type { PublisherCapabilities } from '../providers/provider-capabilities';
import type { ExtractedMediaMetadata } from './media-metadata.service';
import { validateMediaAgainstCapabilities } from './media-validation';

function capabilities(
  overrides: Partial<PublisherCapabilities['media']> = {},
  placements: readonly string[] = ['feed'],
): PublisherCapabilities {
  return {
    provider: 'meta',
    assetType: 'facebook_page',
    placements,
    media: {
      acceptedMimeTypes: ['image/jpeg', 'image/png', 'video/mp4'],
      maxBytes: 10_000_000,
      ...overrides,
    },
    supportsScheduling: true,
    supportsCaption: true,
    supportsFirstComment: false,
    supportsHashtags: false,
    requiresReconciliation: false,
    supportsRemoval: false,
  };
}

function image(
  overrides: Partial<ExtractedMediaMetadata> = {},
): ExtractedMediaMetadata {
  return {
    mimeType: 'image/jpeg',
    bytes: 1_000,
    kind: 'image',
    width: 1080,
    height: 1080,
    durationSeconds: null,
    codec: 'jpeg',
    aspectRatio: 1,
    ...overrides,
  };
}

function video(
  overrides: Partial<ExtractedMediaMetadata> = {},
): ExtractedMediaMetadata {
  return {
    mimeType: 'video/mp4',
    bytes: 5_000_000,
    kind: 'video',
    width: 1080,
    height: 1920,
    durationSeconds: 15,
    codec: 'avc1',
    aspectRatio: 1080 / 1920,
    ...overrides,
  };
}

describe('validateMediaAgainstCapabilities', () => {
  it('accepts media within every declared bound', () => {
    const result = validateMediaAgainstCapabilities(
      image(),
      capabilities(),
      'feed',
    );

    expect(result).toEqual({ valid: true });
  });

  describe('table-driven boundary cases', () => {
    const cases: Array<{
      readonly name: string;
      readonly metadata: ExtractedMediaMetadata;
      readonly media: Partial<PublisherCapabilities['media']>;
      readonly placement?: string;
      readonly expectValid: boolean;
      readonly expectedField?: string;
    }> = [
      {
        name: 'placement not declared for this asset type',
        metadata: image(),
        media: {},
        placement: 'story',
        expectValid: false,
        expectedField: 'placement',
      },
      {
        name: 'mime type outside the accepted list',
        metadata: image({ mimeType: 'image/gif' }),
        media: { acceptedMimeTypes: ['image/jpeg'] },
        expectValid: false,
        expectedField: 'mimeType',
      },
      {
        name: 'bytes exactly at the max is accepted',
        metadata: image({ bytes: 1_000 }),
        media: { maxBytes: 1_000 },
        expectValid: true,
      },
      {
        name: 'bytes one over the max is rejected',
        metadata: image({ bytes: 1_001 }),
        media: { maxBytes: 1_000 },
        expectValid: false,
        expectedField: 'bytes',
      },
      {
        name: 'video duration exactly at the minimum is accepted',
        metadata: video({ durationSeconds: 3 }),
        media: { minDurationSeconds: 3, maxDurationSeconds: 60 },
        expectValid: true,
      },
      {
        name: 'video duration below the minimum is rejected',
        metadata: video({ durationSeconds: 2 }),
        media: { minDurationSeconds: 3 },
        expectValid: false,
        expectedField: 'durationSeconds',
      },
      {
        name: 'video duration exactly at the maximum is accepted',
        metadata: video({ durationSeconds: 60 }),
        media: { maxDurationSeconds: 60 },
        expectValid: true,
      },
      {
        name: 'video duration above the maximum is rejected',
        metadata: video({ durationSeconds: 61 }),
        media: { maxDurationSeconds: 60 },
        expectValid: false,
        expectedField: 'durationSeconds',
      },
      {
        name: 'a video with unreadable duration is rejected when a bound is declared',
        metadata: video({ durationSeconds: null }),
        media: { minDurationSeconds: 3 },
        expectValid: false,
        expectedField: 'durationSeconds',
      },
      {
        name: 'aspect ratio matching a declared ratio is accepted',
        metadata: video({
          width: 1080,
          height: 1920,
          aspectRatio: 1080 / 1920,
        }),
        media: { aspectRatios: ['9:16'] },
        expectValid: true,
      },
      {
        name: 'aspect ratio within encoder rounding tolerance is accepted',
        metadata: video({
          width: 1079,
          height: 1921,
          aspectRatio: 1079 / 1921,
        }),
        media: { aspectRatios: ['9:16'] },
        expectValid: true,
      },
      {
        name: 'aspect ratio outside every declared ratio is rejected',
        metadata: image({ width: 1080, height: 1080, aspectRatio: 1 }),
        media: { aspectRatios: ['9:16', '4:5'] },
        expectValid: false,
        expectedField: 'aspectRatio',
      },
      {
        name: 'no declared aspect ratios imposes no constraint',
        metadata: image({ aspectRatio: 3.5 }),
        media: { aspectRatios: [] },
        expectValid: true,
      },
    ];

    for (const testCase of cases) {
      it(testCase.name, () => {
        const result = validateMediaAgainstCapabilities(
          testCase.metadata,
          capabilities(testCase.media),
          testCase.placement ?? 'feed',
        );

        expect(result.valid).toBe(testCase.expectValid);
        if (!result.valid && testCase.expectedField) {
          expect(result.issues.map((issue) => issue.field)).toContain(
            testCase.expectedField,
          );
        }
      });
    }
  });

  it('reports every violated rule at once rather than stopping at the first', () => {
    const result = validateMediaAgainstCapabilities(
      image({ mimeType: 'image/gif', bytes: 999_999_999, aspectRatio: 3 }),
      capabilities({
        acceptedMimeTypes: ['image/jpeg'],
        maxBytes: 1_000,
        aspectRatios: ['1:1'],
      }),
      'feed',
    );

    expect(result.valid).toBe(false);
    if (!result.valid) {
      const fields = result.issues.map((issue) => issue.field);
      expect(fields).toEqual(
        expect.arrayContaining(['mimeType', 'bytes', 'aspectRatio']),
      );
    }
  });

  it('produces an identical result for identical metadata regardless of declared media source', () => {
    const metadata = image();
    const caps = capabilities({ aspectRatios: ['1:1'] });

    const fromCreativeStudio = validateMediaAgainstCapabilities(
      metadata,
      caps,
      'feed',
    );
    const fromDirectUpload = validateMediaAgainstCapabilities(
      { ...metadata },
      caps,
      'feed',
    );

    expect(fromCreativeStudio).toEqual(fromDirectUpload);
  });

  it('takes no source, origin or provenance field — validation cannot branch on one', () => {
    const source = readFileSync(join(__dirname, 'media-validation.ts'), 'utf8');

    expect(source).not.toMatch(/\bsource\b/i);
    expect(source).not.toMatch(/\borigin\b/i);
    expect(source).not.toMatch(/creativeStudio/i);
  });
});
