import { normalizeDestinationOptions } from './social-planner.service';

describe('normalizeDestinationOptions — video cover', () => {
  it('keeps an image and a moment of the video', () => {
    expect(
      normalizeDestinationOptions({
        cover: {
          mediaAssetId: '7d1d3c1e-9b0a-4a55-9d8e-2b0f5c2d1a10',
          timestampMs: 1500,
        },
      }),
    ).toEqual({
      cover: {
        mediaAssetId: '7d1d3c1e-9b0a-4a55-9d8e-2b0f5c2d1a10',
        timestampMs: 1500,
      },
    });
  });

  it('keeps the first frame (0 ms)', () => {
    expect(normalizeDestinationOptions({ cover: { timestampMs: 0 } })).toEqual({
      cover: { timestampMs: 0 },
    });
  });

  it('drops an empty cover so an unchanged form never rewrites the row', () => {
    expect(normalizeDestinationOptions({ cover: {} })).toEqual({});
  });
});
