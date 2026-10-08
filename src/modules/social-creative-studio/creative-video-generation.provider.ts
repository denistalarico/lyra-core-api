// CS4-B — provider boundary for Reel (video) generation.
//
// The domain (`CreativeVideoGenerationService` / `CreativeVideoGenerationWorker`)
// depends on this port only. Nothing here names a vendor, an endpoint, a
// credit unit or an avatar engine: the adapters (`ViduVideoGenerationProvider`,
// `HeyGenVideoGenerationProvider`) map Lyra's vocabulary onto their APIs.
//
// Video differs from image (CS3) in one structural way: a provider call does
// NOT return the result. It creates a remote job that runs for minutes. So the
// port is three calls — submit, status, result — and the domain persists the
// provider job id between them (`social_creative_video_generation_operations`).
//
// What an adapter receives and returns is deliberately narrow:
//   - in:  text the domain already composed, reference images as BYTES (never
//          a storage key or Lyra URL), provider-neutral settings;
//   - out: a job handle, a neutral status, and finally BYTES. An adapter whose
//          API answers with URLs downloads them itself; provider URLs never
//          leave the adapter and are never persisted.

import type { CreativeVideoCostSnapshot } from './creative-video-pricing';

/** Lyra modes (product decision CS4): one initial provider each. */
export const CREATIVE_VIDEO_MODES = ['generative_reel', 'ugc_avatar'] as const;
export type CreativeVideoMode = (typeof CREATIVE_VIDEO_MODES)[number];

/**
 * How a generative Reel is driven. Derived by the domain from the request,
 * never chosen by the client directly:
 *   - `text`:      prompt only;
 *   - `image`:     one start frame (the "Animate as Reel" flow from CS3);
 *   - `reference`: 1..N images whose subjects stay consistent in the video.
 * UGC is always `avatar`.
 */
export type CreativeVideoInputKind = 'text' | 'image' | 'reference' | 'avatar';

/** Reels are vertical. Not a free choice: providers guarantee nothing else here. */
export const CREATIVE_VIDEO_ASPECT_RATIOS = ['9:16'] as const;
export type CreativeVideoAspectRatio =
  (typeof CREATIVE_VIDEO_ASPECT_RATIOS)[number];

/** Lyra-level tiers; adapters map them (preferred: standard→720p, high→1080p). */
export const CREATIVE_VIDEO_QUALITIES = ['standard', 'high'] as const;
export type CreativeVideoQuality = (typeof CREATIVE_VIDEO_QUALITIES)[number];

/** Product range of a Reel (CS4 decision). Provider capability still decides how. */
export const MIN_VIDEO_DURATION_SECONDS = 5;
export const MAX_VIDEO_DURATION_SECONDS = 30;

/**
 * One provider operation of a generation. A generative Reel longer than the
 * model's native maximum is ONE Lyra generation made of an initial operation
 * plus native extensions (no compositor, no FFmpeg). Each one is a paid
 * provider job with its own id and cost.
 */
export type CreativeVideoOperationKind = 'generate' | 'extend';

export type VideoGenerationReference = {
  readonly mimeType: string;
  readonly body: Buffer;
};

export type VideoGenerationSubmitInput =
  | {
      readonly kind: 'generate';
      readonly mode: 'generative_reel';
      readonly inputKind: 'text' | 'image' | 'reference';
      readonly prompt: string;
      readonly durationSeconds: number;
      readonly aspectRatio: CreativeVideoAspectRatio;
      readonly quality: CreativeVideoQuality;
      readonly audio: boolean;
      /** `image`: exactly one (start frame); `reference`: 1..N; `text`: none. */
      readonly images: readonly VideoGenerationReference[];
    }
  | {
      readonly kind: 'extend';
      readonly mode: 'generative_reel';
      readonly prompt: string;
      /** Seconds ADDED by this operation. */
      readonly durationSeconds: number;
      readonly quality: CreativeVideoQuality;
      /** The provider job whose output this operation continues. */
      readonly previous: ProviderVideoJob;
    }
  | {
      readonly kind: 'generate';
      readonly mode: 'ugc_avatar';
      /** Spoken text, exactly as approved. Never truncated by an adapter. */
      readonly script: string;
      /** Provider ids resolved by the domain from Lyra's own avatar catalog. */
      readonly avatar: {
        readonly providerAvatarId: string;
        readonly providerVoiceId: string;
        readonly avatarType: string;
      };
      /** BCP-47 (`pt-BR`) accent/locale hint, when given. */
      readonly language: string | null;
      readonly aspectRatio: CreativeVideoAspectRatio;
      readonly quality: CreativeVideoQuality;
      /** Optional product image shown behind the avatar. */
      readonly backgroundImage: VideoGenerationReference | null;
    };

/**
 * Stable per-operation key the adapter may hand to the provider (HeyGen
 * `Idempotency-Key`, Vidu `payload`) so a submit whose answer was lost can be
 * found again instead of bought twice.
 */
export type VideoGenerationSubmitContext = {
  readonly dispatchKey: string;
  /** Absolute callback URL for this provider, or null (polling only). */
  readonly callbackUrl: string | null;
};

/** Provider-reported units of one operation, already sanitized. */
export type VideoGenerationUsage = {
  /** e.g. `{ credits: 240 }` (Vidu) or `{ seconds: 23.4 }` (HeyGen). */
  readonly metrics: Readonly<Record<string, number>>;
  /** Official cost, only when the provider itself reports money. */
  readonly reportedCost: {
    readonly amount: string;
    readonly currency: string;
  } | null;
};

/** What the domain persists about a remote job. No URL, ever. */
export type ProviderVideoJob = {
  readonly jobId: string;
  /** Provider's own output id (e.g. a creation id) once known; extension input. */
  readonly outputRef: string | null;
};

export type ProviderVideoSubmitted = {
  readonly jobId: string;
  readonly model: string;
  /** Provider operation label for the ledger (`img2video`, `extend`, `avatar_video`…). */
  readonly operation: string;
  readonly resolution: string;
  /** Some providers report the charge at creation already. */
  readonly usage: VideoGenerationUsage | null;
};

export type ProviderVideoStatus =
  | { readonly state: 'pending' }
  | {
      readonly state: 'succeeded';
      readonly outputRef: string | null;
      /** Provider-reported output length, when it reports one. */
      readonly durationSeconds: number | null;
      readonly usage: VideoGenerationUsage | null;
    }
  | {
      readonly state: 'failed';
      readonly code: VideoGenerationFailureCode;
      readonly usage: VideoGenerationUsage | null;
    };

export type ProviderVideoResult = {
  readonly video: Buffer;
  /** Provider poster/cover, when offered. Never generated locally (no FFmpeg). */
  readonly poster: Buffer | null;
};

/**
 * Answer to "did this lost submit create a job?". `absent` must be PROOF
 * (the provider listed the window and it is not there) — anything less is
 * `unknown`, and the domain never resubmits on `unknown`.
 */
export type ProviderVideoRecovery =
  | { readonly state: 'found'; readonly submitted: ProviderVideoSubmitted }
  | { readonly state: 'absent' }
  | { readonly state: 'unknown' };

/** Provider callbacks are wake-up hints: only the job id is ever used. */
export type ProviderVideoCallback = { readonly jobId: string } | null;

export type VideoGenerationCallbackRequest = {
  readonly method: string;
  /** Path as received (no host), e.g. `/api/social/…/callbacks/vidu`. */
  readonly path: string;
  readonly query: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly rawBody: Buffer | undefined;
};

export type VideoAvatarCatalogEntry = {
  readonly providerAvatarId: string;
  readonly name: string;
  readonly avatarType: string;
  readonly gender: string | null;
  readonly orientation: string | null;
  readonly supportedEngines: readonly string[];
  readonly defaultVoiceId: string | null;
  /** Provider URL — kept internal, served only through Lyra's proxy. */
  readonly previewImageUrl: string | null;
};

export type VideoProviderDiagnostics = {
  readonly provider: string;
  readonly balance: { readonly amount: string; readonly unit: string } | null;
  readonly concurrency: {
    readonly limit: number | null;
    readonly current: number | null;
  } | null;
};

/**
 * Closed failure vocabulary (DB CHECK on `error_code`). Public code is
 * `video_generation_<code>`; messages are fixed per code.
 */
export const VIDEO_GENERATION_FAILURE_CODES = [
  'unavailable',
  'rejected',
  'rate_limited',
  'timeout',
  'reference_unavailable',
  'provider_failed',
  'insufficient_provider_balance',
  'avatar_unavailable',
  'invalid_output',
] as const;
export type VideoGenerationFailureCode =
  (typeof VIDEO_GENERATION_FAILURE_CODES)[number];

/**
 * Whether the request may have reached the provider. It decides what a retry
 * is allowed to do (CS3.3.1 principle, stricter for video):
 *   - `not_sent`: provably never left (DNS, connection refused, local
 *     validation) — resubmitting is safe;
 *   - `refused`: the provider answered with an error and created nothing;
 *   - `unknown`: sent, answer lost (timeout, reset, 5xx without a body we can
 *     trust) — the job MAY exist; the domain reconciles, never resubmits blind.
 */
export type VideoGenerationDispatchOutcome = 'not_sent' | 'refused' | 'unknown';

export class VideoGenerationProviderError extends Error {
  readonly retryAfterSeconds: number | null;

  constructor(
    readonly code: VideoGenerationFailureCode,
    readonly retryable: boolean,
    readonly dispatch: VideoGenerationDispatchOutcome = 'refused',
    details: { retryAfterSeconds?: number } = {},
  ) {
    super(`video_generation_${code}`);
    this.name = 'VideoGenerationProviderError';
    this.retryAfterSeconds = details.retryAfterSeconds ?? null;
  }
}

/** Plan of one generative Reel: what the provider can do natively. */
export type VideoProviderCapabilities = {
  /** Longest single generation. */
  readonly nativeMaxSeconds: number;
  readonly nativeMinSeconds: number;
  /** Seconds one native extension may add; null = no extension. */
  readonly extension: {
    readonly minSeconds: number;
    readonly maxSeconds: number;
  } | null;
  /** Longest source an extension accepts. */
  readonly extensionSourceMaxSeconds: number | null;
  readonly maxReferenceImages: number;
  /** Provider-native audio is only offered for single-operation videos. */
  readonly audio: boolean;
};

/** DI-free port: the registry (`creative-video-generation.binding.ts`) owns instances. */
export abstract class VideoGenerationProvider {
  /** Stable internal id (`vidu`, `heygen`) for the ledger and logs. Never in the UI. */
  abstract readonly id: string;
  abstract readonly mode: CreativeVideoMode;

  get enabled(): boolean {
    return true;
  }

  /**
   * Whether a callback from this provider can be VERIFIED (signature). Only
   * then is a callback URL sent at all; otherwise polling alone drives it.
   */
  get callbacksVerifiable(): boolean {
    return false;
  }

  /**
   * Whether a catalog entry can be offered: the adapter knows its engines,
   * prices and voice requirements; the domain only stores the answer.
   */
  isAvatarUsable(entry: VideoAvatarCatalogEntry): boolean {
    void entry;
    return false;
  }

  /** Pricing table version this adapter's costs are computed with. */
  abstract readonly pricingVersion: string;

  capabilities(): VideoProviderCapabilities | null {
    return null;
  }

  abstract submit(
    input: VideoGenerationSubmitInput,
    context: VideoGenerationSubmitContext,
  ): Promise<ProviderVideoSubmitted>;

  /**
   * Finds a job a lost submit may have created, by `dispatchKey`, among jobs
   * created since `since`. Never creates anything — except where the provider
   * guarantees an idempotent replay (HeyGen `Idempotency-Key`), which the
   * adapter may use because it cannot create a second job.
   */
  abstract recover(
    input: VideoGenerationSubmitInput,
    context: VideoGenerationSubmitContext,
    since: Date,
  ): Promise<ProviderVideoRecovery>;

  abstract getStatus(job: ProviderVideoJob): Promise<ProviderVideoStatus>;

  abstract getResult(job: ProviderVideoJob): Promise<ProviderVideoResult>;

  /**
   * Cost snapshot of one operation from its provider-reported units, priced
   * with this adapter's versioned table (`creative-video-pricing.ts`). Null
   * when the provider reported no units (nothing to bill on). `model` is the
   * one persisted on the operation at submit — never today's configuration.
   */
  abstract cost(
    input: VideoGenerationSubmitInput,
    usage: VideoGenerationUsage | null,
    model: string,
  ): CreativeVideoCostSnapshot | null;

  /** Verifies a callback and extracts the job id; null = not ours / not verifiable. */
  parseCallback(
    request: VideoGenerationCallbackRequest,
  ): ProviderVideoCallback {
    void request;
    return null;
  }

  /** Internal diagnostics (balance, concurrency) — never a public endpoint. */
  diagnostics(): Promise<VideoProviderDiagnostics> {
    return Promise.resolve({
      provider: this.id,
      balance: null,
      concurrency: null,
    });
  }

  listAvatars?(): Promise<VideoAvatarCatalogEntry[]>;

  fetchAvatarPreview?(
    url: string,
  ): Promise<{ body: Buffer; mimeType: string } | null>;
}

/** Bound when a mode has no usable provider: refuses up front (503), never enqueues. */
export class DisabledVideoGenerationProvider extends VideoGenerationProvider {
  readonly id = 'disabled';
  readonly pricingVersion = 'none';

  constructor(readonly mode: CreativeVideoMode) {
    super();
  }

  override get enabled(): boolean {
    return false;
  }

  private refuse(): never {
    throw new VideoGenerationProviderError('unavailable', false, 'not_sent');
  }

  submit(): Promise<ProviderVideoSubmitted> {
    return Promise.resolve().then(() => this.refuse());
  }

  recover(): Promise<ProviderVideoRecovery> {
    return Promise.resolve({ state: 'unknown' });
  }

  getStatus(): Promise<ProviderVideoStatus> {
    return Promise.resolve().then(() => this.refuse());
  }

  getResult(): Promise<ProviderVideoResult> {
    return Promise.resolve().then(() => this.refuse());
  }

  cost(): null {
    return null;
  }
}
