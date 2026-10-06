// CS3.1 — provider boundary for image generation.
//
// The domain (`CreativeImageGenerationService`) depends on this port only.
// Nothing here names a vendor or a model: the concrete adapter (OpenAI in
// CS3.3) maps Lyra's vocabulary onto its own API and back, and is bound to
// the abstract class below in `SocialCreativeStudioModule`.
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
 * A reference image, resolved by the domain from Brand Kit assets or Creative
 * Versions. `subject` is a real element to preserve (product, logo), `style`
 * an aesthetic direction, `base` the image being edited or adapted — the Brand
 * Kit's asset/reference split (blueprint §10.2) carried to the provider.
 */
export type ImageGenerationReference = {
  readonly role: 'subject' | 'style' | 'base';
  readonly mimeType: string;
  readonly body: Buffer;
};

export type ImageGenerationProviderInput = {
  readonly prompt: string;
  readonly outputCount: number;
  readonly aspectRatio: CreativeImageAspectRatio;
  readonly quality: CreativeImageQuality;
  /** Empty until reference resolution lands (CS3.4). */
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
 * The only error an adapter should throw. Its message is the code itself: an
 * adapter translates vendor errors into a code and drops the vendor text,
 * which may carry request ids, keys or prompt fragments. Anything else an
 * adapter throws is treated by the domain as `failed` and never echoed.
 */
export class ImageGenerationProviderError extends Error {
  constructor(
    readonly code: ImageGenerationFailureCode,
    readonly retryable: boolean,
  ) {
    super(`image_generation_${code}`);
    this.name = 'ImageGenerationProviderError';
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
