import type { PublicationPayload } from '../social-publisher.adapter';
import type { YoutubeUploadMetadata } from './youtube-api.client';

export const YOUTUBE_TITLE_MAX = 100;
/** YouTube counts the description in bytes. */
export const YOUTUBE_DESCRIPTION_MAX_BYTES = 5000;
const YOUTUBE_TAGS_MAX_CHARS = 500;
/** "People & Blogs": the neutral default when the destination sets no category. */
const DEFAULT_CATEGORY_ID = '22';

/** YouTube rejects `<` and `>` in titles and descriptions. */
const clean = (value: string) => value.replace(/[<>]/g, '');

/** D-I6: title = first non-empty caption line, at most 100 characters. */
export function youtubeTitle(caption: string | null): string {
  const line =
    (caption ?? '')
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .find((entry) => entry.length > 0) ?? '';
  return [...clean(line)].slice(0, YOUTUBE_TITLE_MAX).join('').trim();
}

export function youtubeDescription(caption: string | null): string {
  return clean(caption ?? '').trim();
}

/** Tags are the caption hashtags (they arrive appended to the caption). */
export function youtubeTags(caption: string | null): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  let chars = 0;
  for (const match of (caption ?? '').matchAll(/#([\p{L}\p{N}_]{1,60})/gu)) {
    const tag = match[1];
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    if (chars + tag.length > YOUTUBE_TAGS_MAX_CHARS) break;
    seen.add(key);
    chars += tag.length;
    tags.push(tag);
  }
  return tags;
}

const PRIVACY = new Set(['public', 'unlisted', 'private']);

/**
 * The Planner destination options (title, privacy, audience, category), as the
 * publication snapshot froze them. A publication scheduled before those
 * options existed has none and keeps the caption-derived defaults.
 */
export function youtubeOptions(payload: PublicationPayload) {
  const raw = payload.providerOptions ?? {};
  const title = typeof raw.title === 'string' ? youtubeTitle(raw.title) : '';
  return {
    title: title || youtubeTitle(payload.caption),
    privacyStatus: (typeof raw.privacyStatus === 'string' &&
    PRIVACY.has(raw.privacyStatus)
      ? raw.privacyStatus
      : 'public') as YoutubeUploadMetadata['status']['privacyStatus'],
    madeForKids: raw.madeForKids === true,
    categoryId:
      typeof raw.categoryId === 'string' && /^\d{1,3}$/.test(raw.categoryId)
        ? raw.categoryId
        : DEFAULT_CATEGORY_ID,
  };
}

export function buildYoutubeMetadata(
  payload: PublicationPayload,
): YoutubeUploadMetadata {
  const options = youtubeOptions(payload);
  return {
    snippet: {
      title: options.title,
      description: youtubeDescription(payload.caption),
      tags: youtubeTags(payload.caption),
      categoryId: options.categoryId,
    },
    status: {
      privacyStatus: options.privacyStatus,
      selfDeclaredMadeForKids: options.madeForKids,
    },
  };
}
