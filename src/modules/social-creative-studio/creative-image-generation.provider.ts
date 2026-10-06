// CS3.1 — provider boundary for image generation.
//
// The domain (`CreativeImageGenerationService`) depends on this port only.
// Nothing here names a vendor or a model: the concrete adapter
// (`OpenAIImageGenerationProvider`, CS3.3) maps Lyra's vocabulary onto its own
// API and back, and is bound to the abstract class below by
// `bindImageGenerationProvider` only when explicitly configured.
//
// What an adapter receives and returns is deliberately narrow:
//   - in:  a prompt the domain already composed (Brand Kit and Planner
//          context are synthesized by Lyra, never handed to a provider as
//          structures), and reference images as BYTES — never a storage key,
//          bucket or URL;
//   - out: output BYTES. An adapter whose API answers with URLs downloads
//          them itself; the URL never leaves the adapter. Declared mime types
//          and dimensions are not part of the result because the domain never
//          trusts them — it sniffs the bytes and reads the metadata itself.

export const CREATIVE_IMAGE_ASPECT_RATIOS = [
  '1:1',
  '4:5',
  '9:16',
  '16:9',
] as const;
export type CreativeImageAspectRatio =
  (typeof CREATIVE_IMAGE_ASPECT_RATIOS)[number];

/** Lyra-level quality tiers (blueprint §14.3); each adapter maps them to its models. */
export const CREATIVE_IMAGE_QUALITIES = ['standard', 'high'] as const;
export type CreativeImageQuality = (typeof CREATIVE_IMAGE_QUALITIES)[number];

/**
 * Technical bound per request, not a commercial quota. The default is one
 * proposal (blueprint §11.3); quotas and credits are a later, per-plan policy.
 */
export const MAX_IMAGE_GENERATION_OUTPUTS = 4;

/**
 * CS3.4.2 — what a reference image is FOR, in provider-neutral terms. The
 * domain derives it from the reference's `kind` (`referenceRole`):
 *   - `subject`: a real element whose essential appearance should be kept
 *     (product, packaging, person, property, vehicle, apparel);
 *   - `logo`:    the brand mark — reproduced as is when shown, never redrawn;
 *   - `context`: setting or visual context, adapted freely;
 *   - `style`:   aesthetic direction only, its subject is not copied;
 *   - `general`: a client-provided reference with no declared role.
 * The composed prompt already explains each image by its position; the role
 * travels with the bytes so an adapter whose API has per-image roles can use
 * them without parsing text.
 */
export const IMAGE_GENERATION_REFERENCE_ROLES = [
  'subject',
  'logo',
  'context',
  'style',
  'general',
] as const;
export type ImageGenerationReferenceRole =
  (typeof IMAGE_GENERATION_REFERENCE_ROLES)[number];

/**
 * Technical bound per generation (CS3.4.2). OpenAI accepts up to 16 inputs,
 * but each image is billed as high-fidelity input tokens, the prompt names
 * every image by position, and the Planner alone allows 10 per item: six
 * keeps cost, payload and "Image 1..N" instructions bounded. Never truncated
 * silently — more than this must be an explicit selection.
 */
export const MAX_IMAGE_GENERATION_REFERENCES = 6;

/** Formats every adapter must accept (OpenAI edits: png, webp, jpg). */
export const IMAGE_GENERATION_REFERENCE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

/**
 * Per image and per request, in bytes. Far below OpenAI's 50 MB per file:
 * the worker holds every reference in memory for the call, once per slot.
 */
export const MAX_IMAGE_GENERATION_REFERENCE_BYTES = 16 * 1024 * 1024;
export const MAX_IMAGE_GENERATION_REFERENCE_TOTAL_BYTES = 48 * 1024 * 1024;

/**
 * A reference image as BYTES, already resolved, verified and ordered by the
 * domain. Position in the array is the "Image N" the prompt refers to.
 */
export type ImageGenerationReference = {
  readonly role: ImageGenerationReferenceRole;
  readonly mimeType: string;
  readonly body: Buffer;
};

export type ImageGenerationProviderInput = {
  readonly prompt: string;
  readonly outputCount: number;
  readonly aspectRatio: CreativeImageAspectRatio;
  readonly quality: CreativeImageQuality;
  /**
   * CS3.4.2 — the generation's frozen references, in order. Empty means a
   * text-only generation; how an adapter delivers them (OpenAI: `/edits`) is
   * its own business.
   */
  readonly references: readonly ImageGenerationReference[];
};

export type ImageGenerationProviderOutput = {
  readonly body: Buffer;
};

/**
 * Room for the cost record CS6 consumes (blueprint §22). Optional: a provider
 * that reports nothing returns `null`. Never shown to the UI.
 */
export type ImageGenerationUsage = {
  readonly model: string | null;
  /** Provider-reported units (images, tokens, …), already sanitized. */
  readonly metrics: Readonly<Record<string, number>>;
  /** Decimal string so money stays exact. */
  readonly cost: { readonly amount: string; readonly currency: string } | null;
};

export type ImageGenerationProviderResult = {
  readonly outputs: readonly ImageGenerationProviderOutput[];
  readonly usage: ImageGenerationUsage | null;
};

export type ImageGenerationFailureCode =
  | 'unavailable'
  | 'rejected'
  | 'rate_limited'
  | 'timeout'
  | 'failed'
  | 'invalid_output';

/**
 * What a generation can record as its failure: the provider codes plus the
 * one failure the domain itself raises before any provider call (CS3.4.2).
 * Adapters never throw `reference_unavailable`.
 */
export type CreativeGenerationFailureCode =
  | ImageGenerationFailureCode
  | 'reference_unavailable';

/**
 * Optional facts an adapter may attach to a failure (CS3.3):
 *   - `retryAfterSeconds`: the provider's own "wait at least this long" hint.
 *     The worker owns the retry policy and only uses it as a floor for its
 *     backoff — adapters never sleep or retry themselves;
 *   - `usage`: what a call that RETURNED cost before its answer proved
 *     unusable, so a paid attempt is still accounted for.
 */
export type ImageGenerationProviderErrorDetails = {
  readonly retryAfterSeconds?: number;
  readonly usage?: ImageGenerationUsage | null;
};

/**
 * The only error an adapter should throw. Its message is the code itself: an
 * adapter translates vendor errors into a code and drops the vendor text,
 * which may carry request ids, keys or prompt fragments. Anything else an
 * adapter throws is treated by the domain as `failed` and never echoed.
 */
export class ImageGenerationProviderError extends Error {
  readonly retryAfterSeconds: number | null;
  readonly usage: ImageGenerationUsage | null;

  constructor(
    readonly code: ImageGenerationFailureCode,
    readonly retryable: boolean,
    details: ImageGenerationProviderErrorDetails = {},
  ) {
    super(`image_generation_${code}`);
    this.name = 'ImageGenerationProviderError';
    this.retryAfterSeconds = details.retryAfterSeconds ?? null;
    this.usage = details.usage ?? null;
  }
}

/** DI token and port. */
export abstract class ImageGenerationProvider {
  /** Stable internal id for usage/cost records and logs. Never shown in the UI. */
  abstract readonly id: string;
  /**
   * CS3.2: whether generations should be accepted at all. Enqueueing work
   * that can only fail would make a queue indistinguishable from a stuck one,
   * so the API refuses up front (503) while this is false.
   */
  get enabled(): boolean {
    return true;
  }
  abstract generate(
    input: ImageGenerationProviderInput,
  ): Promise<ImageGenerationProviderResult>;
}

/**
 * Default binding while no real provider exists: fail closed with a clean
 * `unavailable` instead of leaving the port unbound (which would break boot)
 * or pretending to generate.
 */
export class DisabledImageGenerationProvider extends ImageGenerationProvider {
  readonly id = 'disabled';

  override get enabled(): boolean {
    return false;
  }

  generate(): Promise<ImageGenerationProviderResult> {
    return Promise.reject(
      new ImageGenerationProviderError('unavailable', false),
    );
  }
}
