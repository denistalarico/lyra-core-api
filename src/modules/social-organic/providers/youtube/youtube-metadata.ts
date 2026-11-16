import type { PublicationPayload } from '../social-publisher.adapter';
import type { YoutubeUploadMetadata } from './youtube-api.client';

export const YOUTUBE_TITLE_MAX = 100;
/** YouTube counts the description in bytes. */
export const YOUTUBE_DESCRIPTION_MAX_BYTES = 5000;
const YOUTUBE_TAGS_MAX_CHARS = 500;
/** "People & Blogs": the neutral default; the Planner has no category field. */
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

export function buildYoutubeMetadata(
  payload: PublicationPayload,
): YoutubeUploadMetadata {
  return {
    snippet: {
      title: youtubeTitle(payload.caption),
      description: youtubeDescription(payload.caption),
      tags: youtubeTags(payload.caption),
      categoryId: DEFAULT_CATEGORY_ID,
    },
    status: { privacyStatus: 'public' },
  };
}
