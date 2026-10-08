import type {
  CreativeGenerationBrandFacts,
  CreativeGenerationContentFacts,
} from './creative-generation-context';
import type { CreativeVideoInputKind } from './creative-video-generation.provider';

/**
 * CS4-B — composer of the text a generative Reel provider receives.
 *
 * Same separation as images (CS3.4.1): `prompt` is the operator's intent and
 * is never rewritten; the effective prompt adds the resolved Brand Kit and
 * Planner facts as plain text. No LLM, deterministic, provider-neutral (no
 * vendor syntax such as subject tags). Bumping the version never changes a
 * queued generation: the effective prompt is frozen at enqueue.
 *
 * Much shorter than the image brief on purpose: video models weigh the first
 * sentences most and extensions accept 2,000 characters, so the intent goes
 * first and context is condensed.
 */
export const CREATIVE_VIDEO_PROMPT_COMPOSER_VERSION = 'video-prompt.v1';

const MAX_EFFECTIVE_PROMPT = 8000;

export function composeCreativeVideoPrompt(input: {
  prompt: string;
  inputKind: Exclude<CreativeVideoInputKind, 'avatar'>;
  referenceCount: number;
  brand: CreativeGenerationBrandFacts | null;
  content: CreativeGenerationContentFacts | null;
}): string {
  const lines: string[] = [input.prompt.trim()];
  lines.push(
    'Format: vertical 9:16 short-form social video (Reel), single continuous shot, smooth natural motion, no on-screen text or watermarks unless requested.',
  );
  if (input.inputKind === 'image')
    lines.push(
      'Animate the provided image as the opening frame; keep its subject, composition and colors faithful.',
    );
  if (input.inputKind === 'reference')
    lines.push(
      `Keep the subjects of the ${input.referenceCount} reference image(s) consistent and recognizable.`,
    );

  const content = input.content;
  if (content) {
    const facts = [
      content.theme && `Theme: ${content.theme}`,
      content.keyMessage && `Key message: ${content.keyMessage}`,
      content.objective && `Objective: ${content.objective}`,
      content.brief && `Brief: ${content.brief}`,
    ].filter(Boolean);
    if (facts.length) lines.push(`Content context — ${facts.join('. ')}.`);
  }

  const brand = input.brand;
  if (brand) {
    const palette = brand.palette
      .map((entry) =>
        entry.label ? `${entry.hex} (${entry.label})` : entry.hex,
      )
      .join(', ');
    const facts = [
      palette && `palette ${palette}`,
      brand.guidelines && `guidelines: ${brand.guidelines}`,
    ].filter(Boolean);
    if (facts.length) lines.push(`Brand — ${facts.join('; ')}.`);
  }

  return lines.join('\n').slice(0, MAX_EFFECTIVE_PROMPT);
}
