import type {
  CreativeGenerationBrandFacts,
  CreativeGenerationContentFacts,
} from './creative-generation-context';
import type {
  CreativeImageAspectRatio,
  ImageGenerationReferenceRole,
} from './creative-image-generation.provider';

/**
 * Recorded on every generation (`generation_context.composer`). Bump it when
 * the recipe changes what reaches the provider, so an old effective prompt
 * stays explainable. Deliberately NOT part of the request fingerprint: the
 * same intent over the same context is the same request across deploys.
 */
export const CREATIVE_IMAGE_PROMPT_COMPOSER_VERSION = 'image-prompt.v3';

/**
 * CS3.4.2 — a reference image as the composer sees it: its position is the
 * array index ("Image 1" = index 0, the order the provider receives the
 * bytes); no id, source, label or storage reaches the text.
 */
export type CreativeImagePromptReference = {
  kind: string;
  role: ImageGenerationReferenceRole;
};

export type CreativeImagePromptInput = {
  /** The operator's text, already trimmed. Always present, never rewritten. */
  prompt: string;
  aspectRatio: CreativeImageAspectRatio;
  brand: CreativeGenerationBrandFacts | null;
  content: CreativeGenerationContentFacts | null;
  /** Ordered, frozen selection (CS3.4.2). Absent or empty = text-only. */
  references?: readonly CreativeImagePromptReference[];
};

/**
 * What each kind asks of the model, phrased as "as faithfully as possible":
 * reference fidelity is the provider's best effort, never a promise. Shape
 * follows OpenAI's prompting guide for references (number each input, give
 * it a role, say what to preserve). A kind without its own sentence falls back
 * to its role's, and `general` assumes nothing.
 */
const KIND_INSTRUCTION: Record<string, string> = {
  product:
    'the product — keep its shape, proportions, colors, materials and label as faithful as possible',
  packaging:
    'the product packaging — keep its shape, colors, graphics and label as faithful as possible',
  person:
    'a person — keep their appearance consistent with the photo (face, hair, skin tone, build); do not add names or identifying text',
  property:
    'a real property — keep its architecture, layout and materials recognizable',
  vehicle: 'a vehicle — keep its model, shape, color and details recognizable',
  apparel: 'a garment or accessory — keep its cut, color, pattern and details',
  logo: "the brand's logo — when the request calls for the brand mark, reproduce this exact logo without redrawing, restyling or recoloring it; otherwise leave it out",
  environment:
    "a place or setting — use it as the scene's environment; angle and composition may change",
  background: 'a background — use it as the backdrop or setting of the scene',
  style:
    'a style reference — use only its lighting, color, mood and composition; do not copy its subject or any text in it',
  reference:
    'a style reference — use only its lighting, color, mood and composition; do not copy its subject or any text in it',
  texture: 'a texture — use it only as surface or material direction',
  graphic_element:
    'a brand graphic element — use its shapes or pattern as a visual motif where it fits the request, without distorting it',
};

const ROLE_INSTRUCTION: Record<ImageGenerationReferenceRole, string> = {
  subject:
    'the main subject — keep its essential appearance as faithful as possible',
  logo: KIND_INSTRUCTION.logo,
  context: 'visual context — use it as the setting of the scene',
  style:
    'a style reference — use only its look and feel; do not copy its subject',
  general:
    'a reference provided by the client — use it as the request describes, assuming no other role',
  base: 'the base image — this creative is a variation of it: keep its subject, composition, framing, colors and style, except what the request asks to change',
};

const FORMAT: Record<CreativeImageAspectRatio, string> = {
  '1:1': 'square format (1:1)',
  '4:5': 'portrait format (4:5)',
  '9:16': 'vertical full-screen format (9:16)',
  '16:9': 'landscape format (16:9)',
};

/**
 * CS3.4.1 — deterministic, provider-neutral prompt composition. No LLM: the
 * same input always yields the same text, which is what makes the effective
 * prompt auditable.
 *
 * Shape follows OpenAI's image prompting guidance (2026): state the intended
 * use first, then short labeled segments instead of one paragraph, constraints
 * last, literal text in quotes. Nothing in it is OpenAI-specific; any
 * adapter receives it as a plain prompt.
 *
 * Rules:
 *   - the operator's request comes first and wins any conflict — context
 *     informs it, never replaces it or adds an intent of its own;
 *   - only sections with data appear; an empty Brand Kit or a standalone
 *     generation simply has fewer sections, nothing is invented;
 *   - brand is visual DIRECTION (colors, type, guidelines). Logos and
 *     product fidelity only come from reference images (CS3.4.2): without a
 *     logo reference the model is told not to draw marks at all, and with one
 *     it may only use that mark, and only if the request asks for it;
 *   - reference images are named by position with a role from their kind —
 *     what to preserve, what to use as direction — never by id or label;
 *   - Planner copy is context for the scene, not text to paint;
 *   - CS3.6.2: when Image 1 has the `base` role the creative is a VARIATION:
 *     the request becomes "what to change", Image 1 is what to keep, and the
 *     text says it is a close variation — never a promise of a pixel-exact
 *     edit. Without a base the text is exactly the v2 recipe.
 *
 * Inputs are the Generation Context facts, which carry no ids, scope, storage
 * or approval data — so neither does the output.
 */
export function composeCreativeImagePrompt(
  input: CreativeImagePromptInput,
): string {
  const { brand, content } = input;
  const sections: string[] = [];
  const references = input.references ?? [];
  // CS3.6.2: a variation's base is always Image 1 (the service puts it there).
  const variation = references[0]?.role === 'base';

  const channels = content?.channels.length
    ? `, for ${content.channels.join(', ')}`
    : '';
  sections.push(
    `Social media creative image, ${FORMAT[input.aspectRatio]}${channels}${variation ? ', as a variation of Image 1' : ''}.`,
  );

  sections.push(
    block(
      variation
        ? "REQUESTED CHANGES (the operator's intent — what to change in Image 1; it takes priority over everything below)"
        : "REQUEST (the operator's intent — it takes priority over everything below)",
      [input.prompt],
    ),
  );

  if (references.length) {
    sections.push(
      block(
        'REFERENCE IMAGES (attached in this order; follow the role given to each)',
        references.map(
          (ref, index) =>
            `- Image ${index + 1}: ${ref.role !== 'base' && Object.hasOwn(KIND_INSTRUCTION, ref.kind) ? KIND_INSTRUCTION[ref.kind] : ROLE_INSTRUCTION[ref.role]}.`,
        ),
      ),
    );
  }

  if (content) {
    sections.push(
      block(
        'CONTENT CONTEXT (from the editorial plan; use it to shape the scene, do not write it into the image)',
        bullets([
          ['Title', content.title],
          ['Content type', content.contentType],
          ['Creative format', content.creativeFormat],
          ['Objective', content.objective],
          ['Funnel stage', content.funnelStage],
          ['Theme', content.theme],
          ['Key message', content.keyMessage],
          ['Brief', content.brief],
          ['Creative copy', quoted(content.copy)],
          ['Post caption', quoted(content.caption)],
          ['Script', quoted(content.script)],
          ['Call to action', quoted(content.cta)],
        ]),
      ),
    );
  }

  if (brand) {
    sections.push(
      block(
        'BRAND IDENTITY (visual direction only)',
        bullets([
          [
            'Color palette',
            brand.palette
              .map((c) =>
                [c.role, c.hex, c.label ? `(${c.label})` : null]
                  .filter(Boolean)
                  .join(' '),
              )
              .join('; ') || null,
          ],
          [
            'Typography',
            brand.typography
              .map((t) => (t.role ? `${t.role}: ${t.family}` : t.family))
              .join('; ') || null,
          ],
          ['Brand guidelines', brand.guidelines],
        ]),
      ),
    );
  }

  const constraints = [
    ...(variation
      ? [
          'Change only what the request asks for; everything else should stay as close to Image 1 as possible. This is a close variation, not a pixel-exact edit.',
        ]
      : []),
    'If the request conflicts with any context above, follow the request.',
    'Do not add text, captions or lettering unless the request asks for it; reproduce any requested text exactly as written.',
    references.some((ref) => ref.role === 'logo')
      ? 'Do not invent logos, wordmarks, trademarks or brand names; the only logo allowed is the one in the reference images.'
      : 'Do not invent logos, wordmarks, trademarks or brand names.',
  ];
  if (brand?.palette.length)
    constraints.push(
      'Keep the overall color scheme consistent with the brand palette.',
    );
  if (brand?.typography.length)
    constraints.push(
      'Use the brand typography only as a style hint for text the request asks for.',
    );
  sections.push(
    block(
      'CONSTRAINTS',
      constraints.map((c) => `- ${c}`),
    ),
  );

  return sections.join('\n\n');
}

function block(title: string, lines: string[]) {
  return [`${title}:`, ...lines].join('\n');
}

function bullets(entries: [string, string | null][]) {
  return entries
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([label, value]) => `- ${label}: ${value}`);
}

function quoted(value: string | null) {
  return value ? `"${value}"` : null;
}
