/**
 * Plain caption → LinkedIn `little` text. DOCUMENTED 2026-11-16
 * (little-text-format): every reserved character must be escaped with a
 * backslash. A `#` that starts a word is kept so it renders as a hashtag
 * (`HashtagElement ::= '#' SINGLE_WORD`).
 */
const RESERVED = /[|{}@[\]()<>#\\*_~]/g;

export function toLinkedInLittleText(caption: string | null): string {
  return (caption ?? '').replace(
    RESERVED,
    (char, offset: number, text: string) => {
      if (char === '#' && /[\p{L}\p{N}_]/u.test(text.charAt(offset + 1))) {
        return char;
      }
      return `\\${char}`;
    },
  );
}
