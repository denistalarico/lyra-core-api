import type {
  SocialContentDestinationEntity,
  SocialContentItemEntity,
} from '../entities';

/**
 * The editorial shape of one piece, as far as copywriting is concerned.
 *
 * WHY THIS EXISTS SEPARATELY FROM `creativeFormat`
 * ------------------------------------------------
 * `creativeFormat` is an agency-configurable catalog key and the destination's
 * `placement` is a channel concept. Neither alone says what a copywriter needs
 * to know, and both spell the same idea differently across rows written at
 * different times (`reel`, `reels`, `short_video`). This collapses them into the
 * three distinctions that actually change how the copy is written:
 *
 *   - a Story has no caption, only creative text;
 *   - a Reel's "copy" is a script for a video of at most 30 seconds;
 *   - a Carousel's "copy" is a sequence of slides.
 *
 * Deriving it in one pure function means the prompt, the default field list and
 * any future validation all read the same answer.
 */
export type SocialCopyFormat =
  | 'story'
  | 'reel'
  | 'carousel'
  | 'image'
  | 'unknown';

const REEL_TOKENS = [
  'reel',
  'reels',
  'short',
  'shorts',
  'short_video',
  'video',
  'vídeo',
  'tiktok',
];

const CAROUSEL_TOKENS = ['carousel', 'carrossel'];

const IMAGE_TOKENS = ['image', 'imagem', 'photo', 'foto', 'feed', 'post'];

/**
 * Story wins over every other signal.
 *
 * A piece whose destinations are all Stories is a Story even when someone left
 * `creativeFormat` on the plan's default, and getting that wrong means offering
 * a caption the content page does not render.
 */
export function resolveCopyFormat(
  item: Pick<SocialContentItemEntity, 'creativeFormat'>,
  destinations: Array<Pick<SocialContentDestinationEntity, 'placement'>>,
): SocialCopyFormat {
  const placements = destinations.map((destination) =>
    destination.placement.trim().toLowerCase(),
  );

  if (placements.length > 0 && placements.every((value) => value === 'story'))
    return 'story';

  const format = item.creativeFormat?.trim().toLowerCase() ?? '';
  if (format === 'story') return 'story';

  const signals = [format, ...placements].filter(Boolean);

  if (signals.some((value) => CAROUSEL_TOKENS.includes(value)))
    return 'carousel';
  if (signals.some((value) => REEL_TOKENS.includes(value))) return 'reel';
  if (signals.some((value) => IMAGE_TOKENS.includes(value))) return 'image';

  return 'unknown';
}

/**
 * Whether the caption should be a "mini-artigo" — a long, self-contained
 * explanation rather than a short lead-in.
 *
 * Tied to content type rather than to format: an informative carousel and an
 * informative single image both earn the long caption, and a promotional
 * carousel does not. The CTA "Leia a legenda" is added for exactly these, which
 * is the pairing the operator asked for — telling people to read a caption that
 * is two lines long is worse than no CTA at all.
 */
const LONG_FORM_CONTENT_TYPES = new Set([
  'informative',
  'tips',
  'curiosities',
  'infographic',
  'news',
  'storytelling',
  'demonstration',
]);

export function wantsLongFormCaption(
  item: Pick<SocialContentItemEntity, 'contentType'>,
  format: SocialCopyFormat,
): boolean {
  // A Story has no caption at all, so it can never want a long one.
  if (format === 'story') return false;

  const contentType = item.contentType?.trim().toLowerCase() ?? '';
  return LONG_FORM_CONTENT_TYPES.has(contentType);
}

/** The CTA that pairs with a mini-article caption. */
export const READ_CAPTION_CTA = 'Leia a legenda';
