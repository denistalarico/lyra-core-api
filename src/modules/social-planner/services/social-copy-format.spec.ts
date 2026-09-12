import type {
  SocialContentDestinationEntity,
  SocialContentItemEntity,
} from '../entities';
import { resolveCopyFormat, wantsLongFormCaption } from './social-copy-format';

function item(
  creativeFormat: string | null,
  contentType: string | null = null,
): Pick<SocialContentItemEntity, 'creativeFormat' | 'contentType'> {
  return { creativeFormat, contentType };
}

function destinations(
  ...placements: string[]
): Array<Pick<SocialContentDestinationEntity, 'placement'>> {
  return placements.map((placement) => ({ placement }));
}

describe('resolveCopyFormat', () => {
  it('reads a Story from its destinations even when the format says otherwise', () => {
    expect(resolveCopyFormat(item('image'), destinations('story'))).toBe(
      'story',
    );
  });

  it('only calls it a Story when every destination is one', () => {
    expect(
      resolveCopyFormat(item(null), destinations('story', 'feed')),
    ).not.toBe('story');
  });

  it('reads a Story from the creative format with no destinations', () => {
    expect(resolveCopyFormat(item('story'), [])).toBe('story');
  });

  it('recognizes reels across legacy and canonical spellings', () => {
    for (const format of ['reel', 'reels', 'short_video', 'video', 'tiktok'])
      expect(resolveCopyFormat(item(format), [])).toBe('reel');
  });

  it('recognizes a carousel in both languages', () => {
    expect(resolveCopyFormat(item('carousel'), [])).toBe('carousel');
    expect(resolveCopyFormat(item('carrossel'), [])).toBe('carousel');
  });

  it('falls back to unknown rather than guessing', () => {
    expect(resolveCopyFormat(item('something_new'), [])).toBe('unknown');
    expect(resolveCopyFormat(item(null), [])).toBe('unknown');
  });

  it('ignores case and surrounding whitespace', () => {
    expect(resolveCopyFormat(item('  REEL '), [])).toBe('reel');
    expect(resolveCopyFormat(item(null), destinations(' Story '))).toBe(
      'story',
    );
  });
});

describe('wantsLongFormCaption', () => {
  it('is true for explanatory content types', () => {
    for (const contentType of ['informative', 'tips', 'curiosities'])
      expect(wantsLongFormCaption(item(null, contentType), 'image')).toBe(true);
  });

  it('is false for promotional content', () => {
    expect(wantsLongFormCaption(item(null, 'promotion'), 'image')).toBe(false);
    expect(wantsLongFormCaption(item(null, 'meme'), 'image')).toBe(false);
  });

  it('is never true for a Story, which has no caption at all', () => {
    expect(wantsLongFormCaption(item(null, 'informative'), 'story')).toBe(false);
  });

  it('applies to carousels and reels, not just single images', () => {
    expect(wantsLongFormCaption(item(null, 'informative'), 'carousel')).toBe(
      true,
    );
    expect(wantsLongFormCaption(item(null, 'tips'), 'reel')).toBe(true);
  });

  it('is false when the content type is unset', () => {
    expect(wantsLongFormCaption(item(null, null), 'image')).toBe(false);
  });
});
