import {
  BadRequestException,
  ConflictException,
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { In, IsNull, Repository } from 'typeorm';
import {
  MediaAssetEntity,
  mediaAssetScopeWhere,
  MediaAssetUploadService,
} from '../../common/media-assets';
import { SocialPlannerService } from '../social-planner/services/social-planner.service';
import {
  CreativeAssetService,
  type CreativeVersionCreatedHook,
} from './creative-asset.service';
import {
  CreativeGenerationContextService,
  generationContextRecord,
  type ResolvedCreativeGenerationContext,
} from './creative-generation-context';
import {
  type CreativeGenerationReferenceSelection,
  CreativeGenerationReferenceSelector,
  type SelectedCreativeGenerationReference,
} from './creative-generation-references';
import { CREATIVE_VIDEO_GENERATION_MEDIA_SOURCE } from './creative-retention';
import type { CreativeStudioScope } from './creative-studio.scope';
import { planGenerativeReelOperations } from './creative-video-duration';
import { CreativeVideoProviderRegistry } from './creative-video-generation.binding';
import { CreativeVideoGenerationConfigService } from './creative-video-generation-config';
import {
  type CreativeVideoInputKind,
  type CreativeVideoMode,
  type CreativeVideoQuality,
  CREATIVE_VIDEO_MODES,
  CREATIVE_VIDEO_QUALITIES,
  MAX_VIDEO_DURATION_SECONDS,
  MIN_VIDEO_DURATION_SECONDS,
  type VideoGenerationFailureCode,
  type VideoProviderCapabilities,
} from './creative-video-generation.provider';
import {
  composeCreativeVideoPrompt,
  CREATIVE_VIDEO_PROMPT_COMPOSER_VERSION,
} from './creative-video-prompt.composer';
import { CreativeVersionApprovalService } from './creative-version-approval.service';
import {
  CreativeAssetEntity,
  type CreativeGenerationPromotionKind,
  CreativeVideoAvatarEntity,
  CreativeVideoGenerationEntity,
  type CreativeVideoGenerationStatus,
  CreativeVideoOperationEntity,
  type CreativeVideoReferencePurpose,
  CreativeVideoReferenceEntity,
} from './entities';

/**
 * Lyra's request vocabulary (CS4-B). Never: provider, model, resolution,
 * scope ids, storage URLs, cost or an effective prompt — the DTO forbids them
 * and this service re-checks the mode-specific shape for non-HTTP callers.
 */
export type CreativeVideoGenerationRequest = {
  mode: CreativeVideoMode;
  /** generative_reel: what the Reel should show. */
  prompt?: string;
  /** ugc_avatar: explicit words to speak; omitted = the Planner item's script. */
  script?: string;
  contentItemId?: string | null;
  /** generative: exact length (5–30 s); UGC: a target only, recorded. */
  durationSeconds?: number;
  quality?: CreativeVideoQuality;
  /** generative only: provider-native audio, single-operation Reels only. */
  audio?: boolean;
  /** generative: animate this image (must be vertical 9:16). */
  startFrame?: CreativeGenerationReferenceSelection;
  /** generative: subjects to keep consistent (1–6). */
  references?: CreativeGenerationReferenceSelection[];
  /** UGC: Lyra avatar id from `GET video-avatars`. */
  avatarId?: string;
  /** UGC: BCP-47 accent/locale (`pt-BR`). */
  language?: string;
  /** UGC: optional product image behind the avatar (PNG/JPEG). */
  productImage?: CreativeGenerationReferenceSelection;
};

export type CreativeVideoGenerationAccepted = {
  generationId: string;
  status: CreativeVideoGenerationStatus;
  statusPath: string;
};

/** Public shape: no provider, model, job id, credits, cost, lease or scope ids. */
export type CreativeVideoGenerationView = {
  generationId: string;
  type: 'video';
  mode: CreativeVideoMode;
  status: CreativeVideoGenerationStatus;
  request: {
    prompt: string | null;
    script: string | null;
    scriptSource: 'operator' | 'planner' | null;
    contentItemId: string | null;
    avatarId: string | null;
    language: string | null;
    durationSeconds: number | null;
    aspectRatio: '9:16';
    quality: CreativeVideoQuality;
    audio: boolean;
  };
  references: {
    position: number;
    purpose: CreativeVideoReferencePurpose;
    source: string;
    id: string;
    kind: string;
  }[];
  /** Neutral progress: a long Reel is several steps, never named after a vendor. */
  progress: { steps: number; completedSteps: number };
  output: {
    available: boolean;
    mimeType: string | null;
    width: number | null;
    height: number | null;
    byteSize: string | null;
    durationSeconds: number | null;
    hasAudio: boolean | null;
    retentionClass: 'temporary_generation';
    contentPath: string | null;
    posterPath: string | null;
    promotion: {
      kind: CreativeGenerationPromotionKind;
      creativeAssetId: string;
      versionId: string;
      promotedAt: string;
    } | null;
  } | null;
  error: { code: string; message: string; retryable: boolean } | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
};

const FAILURES: Record<
  VideoGenerationFailureCode,
  { status: number; message: string }
> = {
  unavailable: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message: 'A geração de vídeos não está disponível no momento.',
  },
  rejected: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message:
      'O pedido foi recusado pelas regras de conteúdo ou pelas imagens enviadas. Ajuste e tente novamente.',
  },
  rate_limited: {
    status: HttpStatus.TOO_MANY_REQUESTS,
    message: 'Muitas gerações em pouco tempo. Aguarde e tente novamente.',
  },
  timeout: {
    status: HttpStatus.GATEWAY_TIMEOUT,
    message: 'A geração do vídeo demorou mais que o esperado.',
  },
  reference_unavailable: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message:
      'Uma imagem de referência não está mais disponível. Revise as referências e gere novamente.',
  },
  provider_failed: {
    status: HttpStatus.BAD_GATEWAY,
    message: 'Não foi possível gerar o vídeo. Tente novamente.',
  },
  insufficient_provider_balance: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message:
      'A geração de vídeos está temporariamente indisponível. Nossa equipe já foi avisada.',
  },
  avatar_unavailable: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'O avatar escolhido não está disponível. Escolha outro avatar.',
  },
  invalid_output: {
    status: HttpStatus.BAD_GATEWAY,
    message: 'A geração retornou um vídeo inválido. Tente novamente.',
  },
};

export function videoFailureMessage(code: VideoGenerationFailureCode) {
  return FAILURES[code].message;
}

/** Sanitized failure: fixed message per code, no provider text. */
export class CreativeVideoGenerationException extends HttpException {
  constructor(
    readonly code: VideoGenerationFailureCode,
    readonly retryable: boolean,
  ) {
    const { status, message } = FAILURES[code];
    super(
      {
        statusCode: status,
        message,
        code: `video_generation_${code}`,
        retryable,
      },
      status,
    );
  }
}

class AlreadyPromotedError extends Error {}

const NOT_FOUND = 'Geração de vídeo não encontrada.';
const OUTPUT_EXPIRED = 'O vídeo gerado expirou. Gere novamente.';
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{1,180}$/;
const IDEMPOTENCY_INDEX = 'UQ_social_creative_video_generations_idempotency';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LANGUAGE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
/**
 * UGC script ceiling. About a minute of speech in Portuguese — twice the
 * 5–30 s product range, so a slightly long script is not refused, while a
 * pasted article is. Never truncated: longer is a 400 asking for a shorter
 * script (the spoken text is exactly what was approved, or nothing).
 */
export const MAX_UGC_SCRIPT_CHARS = 900;
/** Width/height tolerance of a 9:16 start frame (rounded encoder sizes). */
const VERTICAL_TOLERANCE = 0.02;
const FINGERPRINT_VERSION = 'video.v1';

/**
 * CS4-B — the API side of asynchronous Reel generation.
 *
 * `enqueue` persists a `queued` generation, its frozen references and its
 * PLANNED provider operations, and answers 202. The provider runs only in
 * `CreativeVideoGenerationWorker`. Every read and promotion is in the
 * caller's full four-part scope; an id alone authorizes nothing, and a
 * generation of another company answers exactly like a missing one.
 */
@Injectable()
export class CreativeVideoGenerationService {
  constructor(
    private readonly providers: CreativeVideoProviderRegistry,
    private readonly config: CreativeVideoGenerationConfigService,
    @InjectRepository(CreativeVideoGenerationEntity, 'agency')
    private readonly generations: Repository<CreativeVideoGenerationEntity>,
    @InjectRepository(CreativeVideoOperationEntity, 'agency')
    private readonly operations: Repository<CreativeVideoOperationEntity>,
    @InjectRepository(CreativeVideoReferenceEntity, 'agency')
    private readonly references: Repository<CreativeVideoReferenceEntity>,
    @InjectRepository(CreativeVideoAvatarEntity, 'agency')
    private readonly avatars: Repository<CreativeVideoAvatarEntity>,
    @InjectRepository(MediaAssetEntity, 'agency')
    private readonly media: Repository<MediaAssetEntity>,
    @InjectRepository(CreativeAssetEntity, 'agency')
    private readonly creativeAssets: Repository<CreativeAssetEntity>,
    private readonly mediaUpload: MediaAssetUploadService,
    private readonly assets: CreativeAssetService,
    private readonly versionApprovals: CreativeVersionApprovalService,
    private readonly context: CreativeGenerationContextService,
    private readonly referenceSelector: CreativeGenerationReferenceSelector,
    private readonly planner: SocialPlannerService,
  ) {}

  /**
   * At most one generation per `Idempotency-Key` in the caller's scope. Same
   * key + same intent = the same generation (any status); same key + another
   * mode, prompt, script, avatar, duration, reference or quality = 409. The
   * unique index decides races; the lookup is the fast path.
   *
   * Context (Brand Kit, Planner item, its script) and references are resolved
   * BEFORE the lookup because they are part of the intent's identity.
   */
  async enqueue(
    scope: CreativeStudioScope,
    actor: string | null,
    request: CreativeVideoGenerationRequest,
    idempotencyKey: string | undefined,
  ): Promise<CreativeVideoGenerationAccepted> {
    const key = requireIdempotencyKey(idempotencyKey);
    const input = validRequest(request);
    const context = await this.resolveContext(scope, input.contentItemId);
    const script =
      input.mode === 'ugc_avatar'
        ? await this.resolveScript(scope, input.script, input.contentItemId)
        : null;
    const avatar =
      input.mode === 'ugc_avatar'
        ? await this.resolveAvatar(input.avatarId)
        : null;
    const frozen = await this.freezeReferences(scope, context, input);
    const fingerprint = videoRequestFingerprint({
      ...input,
      script: script?.text ?? null,
      scriptSource: script?.source ?? null,
      contextDigest: context.digest,
      referencesDigest: referencesDigest(frozen),
    });

    const existing = await this.findByIdempotencyKey(scope, key);
    if (existing) return this.replayEnqueue(existing, fingerprint);

    const provider = this.providers.forMode(input.mode);
    if (!provider.enabled)
      throw new CreativeVideoGenerationException('unavailable', false);
    if (avatar && avatar.provider !== provider.id) throw avatarNotFound();

    const plan =
      input.mode === 'generative_reel'
        ? this.planGenerative(provider.capabilities(), input)
        : [{ sequence: 0, kind: 'generate' as const, durationSeconds: null }];

    const effectivePrompt =
      input.mode === 'generative_reel'
        ? composeCreativeVideoPrompt({
            prompt: input.prompt,
            inputKind: input.inputKind,
            referenceCount: frozen.length,
            brand: context.brand,
            content: context.content,
          })
        : null;

    let saved: CreativeVideoGenerationEntity;
    try {
      saved = await this.generations.manager.transaction(async (manager) => {
        const generations = manager.withRepository(this.generations);
        const generation = await generations.save(
          generations.create({
            tenantId: scope.tenantId,
            workspaceId: scope.workspaceId,
            agencyClientId: scope.agencyClientId,
            companyContextId: scope.companyContextId,
            mode: input.mode,
            inputKind: input.inputKind,
            status: 'queued',
            prompt: input.mode === 'generative_reel' ? input.prompt : null,
            script: script?.text ?? null,
            scriptSource: script?.source ?? null,
            contentItemId: input.contentItemId,
            avatarId: avatar?.id ?? null,
            language: input.language,
            effectivePrompt,
            generationContext: input.contentItemId
              ? (generationContextRecord(
                  context,
                  CREATIVE_VIDEO_PROMPT_COMPOSER_VERSION,
                  {
                    selection: 'explicit',
                    references: frozen.map((ref) => ({
                      source: ref.source,
                      kind: ref.kind,
                    })),
                    digest: referencesDigest(frozen),
                  },
                ) as unknown as Record<string, unknown>)
              : null,
            durationRequestedSeconds: input.durationSeconds,
            aspectRatio: '9:16',
            quality: input.quality,
            audioRequested: input.audio,
            provider: provider.id,
            idempotencyKey: key,
            requestFingerprint: fingerprint,
            maxStepRetries: this.config.maxStepRetries,
            deadlineAt: new Date(
              Date.now() + this.config.deadlineMinutes * 60_000,
            ),
            requestedById: actor,
          }),
        );
        for (const operation of plan)
          await manager.getRepository(CreativeVideoOperationEntity).insert({
            generationId: generation.id,
            sequence: operation.sequence,
            kind: operation.kind,
            status: 'pending',
            durationSeconds: operation.durationSeconds,
            provider: provider.id,
          });
        for (const [position, ref] of frozen.entries())
          await manager.getRepository(CreativeVideoReferenceEntity).insert({
            generationId: generation.id,
            position,
            purpose: ref.purpose,
            source: ref.source as 'brand' | 'planner' | 'operator',
            kind: ref.kind,
            brandKitAssetId: ref.source === 'brand' ? ref.assetId : null,
            mediaAssetId: ref.source === 'brand' ? null : ref.assetId,
            mimeType: ref.mimeType,
            byteSize: String(ref.byteSize),
            checksum: ref.checksum,
          });
        return generation;
      });
    } catch (error) {
      if (!isIdempotencyViolation(error)) throw error;
      const winner = await this.findByIdempotencyKey(scope, key);
      if (!winner) throw error;
      return this.replayEnqueue(winner, fingerprint);
    }
    return accepted(saved.id, 'queued');
  }

  private planGenerative(
    capabilities: VideoProviderCapabilities | null,
    input: ValidVideoRequest,
  ) {
    const plan = capabilities
      ? planGenerativeReelOperations(
          input.durationSeconds as number,
          capabilities,
        )
      : null;
    if (!plan)
      throw new BadRequestException({
        code: 'video_duration_unsupported',
        message: `Escolha uma duração entre ${MIN_VIDEO_DURATION_SECONDS} e ${MAX_VIDEO_DURATION_SECONDS} segundos.`,
      });
    if (input.audio && (plan.length > 1 || !capabilities?.audio))
      throw new BadRequestException({
        code: 'video_audio_unavailable_for_duration',
        message: `O áudio nativo está disponível para Reels de até ${capabilities?.nativeMaxSeconds ?? 0} segundos.`,
      });
    return plan;
  }

  private async resolveContext(
    scope: CreativeStudioScope,
    contentItemId: string | null,
  ): Promise<ResolvedCreativeGenerationContext> {
    return this.context.resolve(scope, contentItemId);
  }

  /**
   * The words the avatar speaks. An explicit `script` wins; otherwise the
   * Planner item's own script, read through its owner in the caller's scope
   * (the copy stays owned by the Planner — nothing is written back). Never
   * clipped: the Generation Context's 1,500-character digest view is not
   * what gets spoken.
   */
  private async resolveScript(
    scope: CreativeStudioScope,
    override: string | null,
    contentItemId: string | null,
  ): Promise<{ text: string; source: 'operator' | 'planner' }> {
    let text = override;
    let source: 'operator' | 'planner' = 'operator';
    if (text === null && contentItemId) {
      const item = await this.planner.getContent(scope, contentItemId);
      text = typeof item.script === 'string' ? item.script.trim() : '';
      source = 'planner';
    }
    if (!text)
      throw new BadRequestException({
        code: 'video_script_required',
        message:
          'Escreva o roteiro ou escolha um conteúdo do Planner com roteiro.',
      });
    if (text.length > MAX_UGC_SCRIPT_CHARS)
      throw new BadRequestException({
        code: 'video_script_too_long',
        message: `O roteiro pode ter até ${MAX_UGC_SCRIPT_CHARS} caracteres. Encurte o texto.`,
      });
    return { text, source };
  }

  private async resolveAvatar(id: string | null) {
    const avatar = id
      ? await this.avatars.findOneBy({ id, available: true })
      : null;
    if (!avatar || !avatar.providerVoiceId) throw avatarNotFound();
    return avatar;
  }

  /**
   * Freezes the reference images through the CS3.4.2 selector (same scope
   * rule, durable media only, checksum snapshot) and adds what video needs:
   * a start frame must be a vertical media image (the provider keeps its
   * aspect), a product background PNG/JPEG.
   */
  private async freezeReferences(
    scope: CreativeStudioScope,
    context: ResolvedCreativeGenerationContext,
    input: ValidVideoRequest,
  ): Promise<FrozenVideoReference[]> {
    const choices: {
      purpose: CreativeVideoReferencePurpose;
      choice: CreativeGenerationReferenceSelection;
    }[] = [];
    if (input.startFrame) {
      if (input.startFrame.source === 'brand')
        throw new BadRequestException({
          code: 'video_start_frame_unsupported',
          message:
            'Use uma imagem vertical (9:16) da biblioteca ou do Planner como quadro inicial.',
        });
      choices.push({ purpose: 'start_frame', choice: input.startFrame });
    }
    for (const choice of input.references ?? [])
      choices.push({ purpose: 'reference', choice });
    if (input.productImage)
      choices.push({ purpose: 'background', choice: input.productImage });
    if (!choices.length) return [];

    const plan = await this.referenceSelector.select(
      scope,
      context,
      choices.map((entry) => entry.choice),
    );
    const frozen = plan.references.map((ref, index) => ({
      ...ref,
      purpose: choices[index].purpose,
    }));

    const start = frozen.find((ref) => ref.purpose === 'start_frame');
    if (start) {
      const media = await this.media.findOne({
        where: { id: start.assetId, ...mediaAssetScopeWhere(scope) },
      });
      const ratio =
        media?.width && media.height ? media.width / media.height : 0;
      if (Math.abs(ratio - 9 / 16) > VERTICAL_TOLERANCE)
        throw new BadRequestException({
          code: 'video_start_frame_not_vertical',
          message: 'O quadro inicial precisa ser uma imagem vertical 9:16.',
        });
    }
    const background = frozen.find((ref) => ref.purpose === 'background');
    if (
      background &&
      !['image/png', 'image/jpeg'].includes(background.mimeType)
    )
      throw new BadRequestException({
        code: 'video_product_image_unsupported',
        message: 'Use uma imagem PNG ou JPEG para o produto.',
      });
    return frozen;
  }

  private findByIdempotencyKey(scope: CreativeStudioScope, key: string) {
    return this.generations.findOne({
      where: { ...mediaAssetScopeWhere(scope), idempotencyKey: key },
    });
  }

  private replayEnqueue(
    generation: CreativeVideoGenerationEntity,
    fingerprint: string,
  ): CreativeVideoGenerationAccepted {
    if (generation.requestFingerprint !== fingerprint)
      throw new ConflictException({
        code: 'idempotency_key_conflict',
        message:
          'Esta chave de idempotência já foi usada para um pedido diferente.',
      });
    return accepted(generation.id, generation.status);
  }

  async get(
    scope: CreativeStudioScope,
    generationId: string,
  ): Promise<CreativeVideoGenerationView> {
    const generation = await this.find(scope, generationId);
    const [operations, references] = await Promise.all([
      this.operations.find({ where: { generationId: generation.id } }),
      this.references.find({
        where: { generationId: generation.id },
        order: { position: 'ASC' },
      }),
    ]);
    const mediaIds = [
      generation.outputMediaAssetId,
      generation.posterMediaAssetId,
    ].filter((id): id is string => id !== null);
    const media = mediaIds.length
      ? await this.media.find({
          where: {
            id: In(mediaIds),
            ...mediaAssetScopeWhere(scope),
            source: CREATIVE_VIDEO_GENERATION_MEDIA_SOURCE,
          },
        })
      : [];
    const video = media.find((m) => m.id === generation.outputMediaAssetId);
    const poster = media.find((m) => m.id === generation.posterMediaAssetId);
    const base = `/social/creative-studio/video-generations/${generation.id}`;

    return {
      generationId: generation.id,
      type: 'video',
      mode: generation.mode,
      status: generation.status,
      request: {
        prompt: generation.prompt,
        script: generation.script,
        scriptSource: generation.scriptSource,
        contentItemId: generation.contentItemId,
        avatarId: generation.avatarId,
        language: generation.language,
        durationSeconds: generation.durationRequestedSeconds,
        aspectRatio: '9:16',
        quality: generation.quality,
        audio: generation.audioRequested,
      },
      references: references.map((ref) => ({
        position: ref.position,
        purpose: ref.purpose,
        source: ref.source,
        id: (ref.brandKitAssetId ?? ref.mediaAssetId) as string,
        kind: ref.kind,
      })),
      progress: {
        steps: operations.length,
        completedSteps: operations.filter((op) => op.status === 'succeeded')
          .length,
      },
      output:
        generation.status === 'completed'
          ? {
              available: Boolean(video),
              mimeType: video?.mimeType ?? null,
              width: video?.width ?? null,
              height: video?.height ?? null,
              byteSize: video?.byteSize ?? null,
              durationSeconds:
                generation.durationActualSeconds === null
                  ? null
                  : Number(generation.durationActualSeconds),
              hasAudio: generation.hasAudio,
              retentionClass: 'temporary_generation',
              contentPath: video ? `${base}/content` : null,
              posterPath: video && poster ? `${base}/poster` : null,
              promotion:
                generation.promotionKind &&
                generation.promotedCreativeAssetId &&
                generation.promotedVersionId &&
                generation.promotedAt
                  ? {
                      kind: generation.promotionKind,
                      creativeAssetId: generation.promotedCreativeAssetId,
                      versionId: generation.promotedVersionId,
                      promotedAt: generation.promotedAt.toISOString(),
                    }
                  : null,
            }
          : null,
      error:
        generation.status === 'failed' && generation.errorCode
          ? {
              code: `video_generation_${generation.errorCode}`,
              message: FAILURES[generation.errorCode].message,
              retryable: generation.errorRetryable ?? false,
            }
          : null,
      createdAt: generation.createdAt.toISOString(),
      startedAt: generation.startedAt?.toISOString() ?? null,
      completedAt: generation.completedAt?.toISOString() ?? null,
      failedAt: generation.failedAt?.toISOString() ?? null,
    };
  }

  async readContent(scope: CreativeStudioScope, generationId: string) {
    const generation = await this.find(scope, generationId);
    return this.temporary(scope, generation.outputMediaAssetId);
  }

  async readPoster(scope: CreativeStudioScope, generationId: string) {
    const generation = await this.find(scope, generationId);
    if (!generation.posterMediaAssetId)
      throw new NotFoundException('Capa não encontrada.');
    return this.temporary(scope, generation.posterMediaAssetId);
  }

  /**
   * Promotion copies the temporary video (and its poster, as the version's
   * thumbnail) through the Studio's normal upload path: same validation,
   * numbering and Planner reflection. The temporary binary becomes eligible
   * for cleanup on the next sweep. At most once per generation (CAS inside
   * the version's transaction); same intent replays, another is a 409.
   */
  promoteToNewAsset(
    scope: CreativeStudioScope,
    actor: string | null,
    generationId: string,
    input: { name?: string; folderId?: string; contentItemId?: string },
  ) {
    return this.promote(
      scope,
      actor,
      generationId,
      { kind: 'new_asset' },
      (generation, file, hook) =>
        this.assets.upload(scope, actor, {
          file,
          ...input,
          // A generation made for a Planner item stays linked to it.
          contentItemId:
            input.contentItemId ?? generation.contentItemId ?? undefined,
          sourceType: 'generated',
          onVersionCreated: hook,
        }),
      async (generation) => {
        const asset = await this.creativeAssets.findOne({
          where: {
            id: generation.promotedCreativeAssetId ?? '',
            ...mediaAssetScopeWhere(scope),
          },
        });
        if (!asset) throw new NotFoundException('Criativo não encontrado.');
        return asset;
      },
    );
  }

  promoteToVersion(
    scope: CreativeStudioScope,
    actor: string | null,
    generationId: string,
    input: { assetId: string; revisesVersionId?: string },
  ) {
    const { assetId, revisesVersionId } = input;
    return this.promote(
      scope,
      actor,
      generationId,
      { kind: revisesVersionId ? 'revision' : 'version', assetId },
      (_generation, file, hook) =>
        revisesVersionId
          ? this.versionApprovals.startRevision(
              scope,
              actor,
              assetId,
              revisesVersionId,
              file,
              hook,
            )
          : this.assets.createVersion(
              scope,
              actor,
              assetId,
              file,
              undefined,
              hook,
            ),
      async (generation) => {
        const versions = await this.assets.versionsFor(
          scope,
          generation.promotedCreativeAssetId ?? '',
        );
        const version = versions.find(
          (v) => v.id === generation.promotedVersionId,
        );
        if (!version) throw new NotFoundException('Versão não encontrada.');
        return version;
      },
    );
  }

  private async promote<T>(
    scope: CreativeStudioScope,
    actor: string | null,
    generationId: string,
    intent: { kind: CreativeGenerationPromotionKind; assetId?: string },
    perform: (
      generation: CreativeVideoGenerationEntity,
      file: Awaited<ReturnType<CreativeVideoGenerationService['outputFile']>>,
      hook: CreativeVersionCreatedHook,
    ) => Promise<T>,
    replay: (generation: CreativeVideoGenerationEntity) => Promise<T>,
  ): Promise<T> {
    const generation = await this.find(scope, generationId);
    if (generation.promotedVersionId)
      return this.replayPromotion(generation, intent, replay);
    if (generation.status !== 'completed')
      throw new ConflictException({
        code: 'video_generation_not_completed',
        message: 'Aguarde o vídeo ficar pronto para salvá-lo.',
      });
    const file = await this.outputFile(scope, generation);
    try {
      return await perform(generation, file, async (manager, created) => {
        const claimed = await manager.update(
          CreativeVideoGenerationEntity,
          { id: generation.id, promotedVersionId: IsNull() },
          {
            promotionKind: intent.kind,
            promotedCreativeAssetId: created.creativeAssetId,
            promotedVersionId: created.versionId,
            promotedById: actor,
            promotedAt: new Date(),
          },
        );
        if ((claimed.affected ?? 0) !== 1) throw new AlreadyPromotedError();
      });
    } catch (error) {
      const current = await this.generations.findOneBy({ id: generation.id });
      if (current?.promotedVersionId)
        return this.replayPromotion(current, intent, replay);
      throw error;
    }
  }

  private replayPromotion<T>(
    generation: CreativeVideoGenerationEntity,
    intent: { kind: CreativeGenerationPromotionKind; assetId?: string },
    replay: (generation: CreativeVideoGenerationEntity) => Promise<T>,
  ) {
    const same =
      generation.promotionKind === intent.kind &&
      (intent.assetId === undefined ||
        generation.promotedCreativeAssetId === intent.assetId);
    if (!same)
      throw new ConflictException({
        code: 'video_generation_already_promoted',
        message: 'Este vídeo gerado já foi usado em outro criativo.',
      });
    return replay(generation);
  }

  private async outputFile(
    scope: CreativeStudioScope,
    generation: CreativeVideoGenerationEntity,
  ) {
    const { asset, file } = await this.temporary(
      scope,
      generation.outputMediaAssetId,
    );
    const buffer = await readAll(file.body);
    let videoPoster:
      | { buffer: Buffer; originalname: string; mimetype: string }
      | undefined;
    if (generation.posterMediaAssetId) {
      const poster = await this.temporary(
        scope,
        generation.posterMediaAssetId,
      ).catch(() => null);
      if (poster)
        videoPoster = {
          buffer: await readAll(poster.file.body),
          originalname: 'capa',
          mimetype: poster.asset.mimeType,
        };
    }
    return {
      buffer,
      originalname: asset.originalFilename ?? 'reel-gerado.mp4',
      mimetype: asset.mimeType,
      size: buffer.length,
      videoPoster,
    };
  }

  /** Every "binary expired" state answers the same 410 (CS3.6.1 rule). */
  private async temporary(
    scope: CreativeStudioScope,
    mediaAssetId: string | null,
  ) {
    if (!mediaAssetId) throw new GoneException(OUTPUT_EXPIRED);
    try {
      return await this.mediaUpload.getTemporaryContent(
        scope,
        mediaAssetId,
        CREATIVE_VIDEO_GENERATION_MEDIA_SOURCE,
      );
    } catch (error) {
      if (error instanceof NotFoundException)
        throw new GoneException(OUTPUT_EXPIRED);
      throw error;
    }
  }

  private async find(scope: CreativeStudioScope, generationId: string) {
    if (!UUID.test(generationId)) throw new NotFoundException(NOT_FOUND);
    const generation = await this.generations.findOne({
      where: { id: generationId, ...mediaAssetScopeWhere(scope) },
    });
    if (!generation) throw new NotFoundException(NOT_FOUND);
    return generation;
  }
}

type FrozenVideoReference = SelectedCreativeGenerationReference & {
  purpose: CreativeVideoReferencePurpose;
};

type ValidVideoRequest = ReturnType<typeof validRequest>;

/**
 * Mode-specific shape, for HTTP and non-HTTP callers alike. A field that
 * belongs to the other mode is refused, not ignored: silently dropping a
 * script from a generative request would generate something else than asked.
 */
function validRequest(request: CreativeVideoGenerationRequest) {
  const mode = request?.mode;
  if (!(CREATIVE_VIDEO_MODES as readonly string[]).includes(mode))
    throw new BadRequestException({
      code: 'video_mode_invalid',
      message: 'Escolha o tipo de Reel.',
    });
  const quality = request.quality ?? 'standard';
  if (!(CREATIVE_VIDEO_QUALITIES as readonly string[]).includes(quality))
    throw new BadRequestException('Qualidade inválida.');
  const contentItemId = request.contentItemId ?? null;
  if (contentItemId !== null && !UUID.test(contentItemId))
    throw new BadRequestException({
      code: 'content_item_not_found',
      message: 'Conteúdo não encontrado.',
    });
  const notAllowed = (fields: (keyof CreativeVideoGenerationRequest)[]) => {
    const present = fields.filter((field) => request[field] !== undefined);
    if (present.length)
      throw new BadRequestException({
        code: 'video_field_not_allowed',
        message: `Campo não aceito neste tipo de Reel: ${present.join(', ')}.`,
      });
  };
  const durationSeconds = request.durationSeconds ?? null;
  if (
    durationSeconds !== null &&
    (!Number.isInteger(durationSeconds) ||
      durationSeconds < MIN_VIDEO_DURATION_SECONDS ||
      durationSeconds > MAX_VIDEO_DURATION_SECONDS)
  )
    throw new BadRequestException({
      code: 'video_duration_unsupported',
      message: `Escolha uma duração entre ${MIN_VIDEO_DURATION_SECONDS} e ${MAX_VIDEO_DURATION_SECONDS} segundos.`,
    });

  if (mode === 'generative_reel') {
    notAllowed(['script', 'avatarId', 'language', 'productImage']);
    const prompt =
      typeof request.prompt === 'string' ? request.prompt.trim() : '';
    if (!prompt) throw new BadRequestException('Descreva o Reel desejado.');
    if (prompt.length > 4000)
      throw new BadRequestException(
        'A descrição pode ter até 4000 caracteres.',
      );
    if (request.startFrame && request.references?.length)
      throw new BadRequestException({
        code: 'video_input_conflict',
        message: 'Use um quadro inicial OU imagens de referência, não os dois.',
      });
    if (request.references !== undefined && !Array.isArray(request.references))
      throw new BadRequestException({
        code: 'reference_not_found',
        message: 'Imagem de referência não encontrada.',
      });
    const inputKind: CreativeVideoInputKind = request.startFrame
      ? 'image'
      : request.references?.length
        ? 'reference'
        : 'text';
    return {
      mode,
      inputKind,
      prompt,
      script: null as string | null,
      contentItemId,
      avatarId: null as string | null,
      language: null as string | null,
      durationSeconds: durationSeconds ?? MIN_VIDEO_DURATION_SECONDS,
      quality,
      audio: request.audio === true,
      startFrame: request.startFrame ?? null,
      references: request.references ?? [],
      productImage: null as CreativeGenerationReferenceSelection | null,
    };
  }

  notAllowed(['prompt', 'startFrame', 'references', 'audio']);
  const avatarId = typeof request.avatarId === 'string' ? request.avatarId : '';
  if (!UUID.test(avatarId)) throw avatarNotFound();
  const language = request.language ?? null;
  if (language !== null && (!LANGUAGE.test(language) || language.length > 16))
    throw new BadRequestException({
      code: 'video_language_invalid',
      message: 'Idioma inválido. Use o formato pt-BR.',
    });
  const script =
    typeof request.script === 'string' && request.script.trim()
      ? request.script.trim()
      : null;
  if (script === null && !contentItemId)
    throw new BadRequestException({
      code: 'video_script_required',
      message:
        'Escreva o roteiro ou escolha um conteúdo do Planner com roteiro.',
    });
  return {
    mode,
    inputKind: 'avatar' as CreativeVideoInputKind,
    prompt: null as string | null,
    script,
    contentItemId,
    avatarId: avatarId.toLowerCase(),
    language,
    durationSeconds,
    quality,
    audio: false,
    startFrame: null as CreativeGenerationReferenceSelection | null,
    references: [] as CreativeGenerationReferenceSelection[],
    productImage: request.productImage ?? null,
  };
}

/**
 * sha256 of the normalized intent (`video.v1`). Scope stays out (it is part
 * of the unique key). The Planner script is part of a UGC intent: the same key
 * over an edited script is a different request (409), never a replay that
 * would speak the old words.
 */
export function videoRequestFingerprint(input: {
  mode: CreativeVideoMode;
  inputKind: CreativeVideoInputKind;
  prompt: string | null;
  script: string | null;
  scriptSource: string | null;
  contentItemId: string | null;
  avatarId: string | null;
  language: string | null;
  durationSeconds: number | null;
  quality: CreativeVideoQuality;
  audio: boolean;
  contextDigest: string;
  referencesDigest: string | null;
}) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        FINGERPRINT_VERSION,
        input.mode,
        input.inputKind,
        input.prompt,
        input.script,
        input.scriptSource,
        input.contentItemId?.toLowerCase() ?? null,
        input.avatarId,
        input.language,
        input.durationSeconds,
        input.quality,
        input.audio,
        input.contextDigest,
        input.referencesDigest,
      ]),
    )
    .digest('hex');
}

/** Order, purpose and bytes (checksum) are all part of the identity. */
function referencesDigest(references: readonly FrozenVideoReference[]) {
  if (!references.length) return null;
  return createHash('sha256')
    .update(
      JSON.stringify(
        references.map((ref) => [
          ref.purpose,
          ref.source,
          ref.assetId.toLowerCase(),
          ref.kind,
          ref.checksum,
        ]),
      ),
    )
    .digest('hex');
}

function accepted(
  generationId: string,
  status: CreativeVideoGenerationStatus,
): CreativeVideoGenerationAccepted {
  return {
    generationId,
    status,
    statusPath: `/social/creative-studio/video-generations/${generationId}`,
  };
}

function requireIdempotencyKey(value: string | undefined) {
  const key = value?.trim();
  if (!key || !IDEMPOTENCY_KEY.test(key))
    throw new BadRequestException({
      code: 'idempotency_key_required',
      message: 'Envie um cabeçalho Idempotency-Key válido.',
    });
  return key;
}

function avatarNotFound() {
  return new BadRequestException({
    code: 'video_avatar_not_found',
    message: 'Avatar não encontrado. Escolha um avatar da lista.',
  });
}

function isIdempotencyViolation(error: unknown) {
  const candidate = error as {
    code?: string;
    constraint?: string;
    driverError?: { code?: string; constraint?: string };
  } | null;
  const code = candidate?.code ?? candidate?.driverError?.code;
  const constraint =
    candidate?.constraint ?? candidate?.driverError?.constraint;
  return code === '23505' && constraint === IDEMPOTENCY_INDEX;
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  return Buffer.concat(chunks);
}
