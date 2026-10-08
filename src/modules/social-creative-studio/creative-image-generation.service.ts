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
  durableMediaAssetSource,
  MediaAssetEntity,
  mediaAssetScopeWhere,
  MediaAssetUploadService,
} from '../../common/media-assets';
import {
  CreativeAssetService,
  type CreativeVersionCreatedHook,
} from './creative-asset.service';
import { CreativeGenerationConfigService } from './creative-generation-config';
import {
  CreativeGenerationContextService,
  generationContextRecord,
} from './creative-generation-context';
import {
  type CreativeGenerationPersistedReferenceSource,
  type CreativeGenerationReferenceSelection,
  CreativeGenerationReferenceSelector,
  type SelectedCreativeGenerationReference,
} from './creative-generation-references';
import {
  type CreativeGenerationFailureCode,
  type CreativeImageAspectRatio,
  type CreativeImageQuality,
  IMAGE_GENERATION_REFERENCE_MIME_TYPES,
  ImageGenerationProvider,
  type ImageGenerationReferenceRole,
  MAX_IMAGE_GENERATION_OUTPUTS,
  MAX_IMAGE_GENERATION_REFERENCE_BYTES,
} from './creative-image-generation.provider';
import {
  composeCreativeImagePrompt,
  CREATIVE_IMAGE_PROMPT_COMPOSER_VERSION,
} from './creative-image-prompt.composer';
import {
  CREATIVE_GENERATION_MEDIA_SOURCE,
  type CreativeRetentionClass,
} from './creative-retention';
import type { CreativeStudioScope } from './creative-studio.scope';
import { CreativeVersionApprovalService } from './creative-version-approval.service';
import {
  CreativeAssetEntity,
  CreativeAssetVersionEntity,
  CreativeGenerationEntity,
  CreativeGenerationOutputEntity,
  type CreativeGenerationPromotionKind,
  type CreativeGenerationOriginType,
  CreativeGenerationReferenceEntity,
  type CreativeGenerationStatus,
} from './entities';

/**
 * Lyra's request vocabulary. Context arrives as REFERENCES only (CS3.4.1):
 * `contentItemId` is resolved server-side under the caller's scope, and the
 * Brand Kit comes from the scope itself. Palette, guidelines, copy or scope
 * ids are never accepted from the client — the Brand Kit stays in Social
 * Settings and copy/caption stay in the Planner.
 */
export type CreativeImageGenerationRequest = {
  prompt: string;
  contentItemId?: string | null;
  outputCount?: number;
  aspectRatio?: CreativeImageAspectRatio;
  quality?: CreativeImageQuality;
  /**
   * CS3.4.2 — explicit, ordered reference selection. Omitted = the default
   * rule (the item's Planner references, in Planner order); `[]` = none.
   */
  references?: CreativeGenerationReferenceSelection[];
};

/**
 * CS3.6.2 — "Gerar novamente": a NEW generation with the origin's intent.
 * Only legitimate overrides; everything omitted is taken from the origin
 * (prompt, settings, and — when the origin chose them explicitly — its
 * references). The Planner item is always the origin's, never chosen here.
 */
export type CreativeImageRegenerationRequest = {
  prompt?: string;
  outputCount?: number;
  aspectRatio?: CreativeImageAspectRatio;
  quality?: CreativeImageQuality;
  /** Replaces the origin's ordinary references; a variation's base stays. */
  references?: CreativeGenerationReferenceSelection[];
};

/**
 * CS3.6.2 — "Criar variação": what to change in the base image. The base
 * comes from the route (an output or a Creative Version), never from here.
 * `references` are ADDITIONAL images (omitted = none); the base counts
 * toward the six.
 */
export type CreativeImageVariationRequest = {
  prompt: string;
  outputCount?: number;
  aspectRatio?: CreativeImageAspectRatio;
  quality?: CreativeImageQuality;
  references?: CreativeGenerationReferenceSelection[];
};

/** Exactly one origin per derived generation (CS3.6.2). */
type CreativeGenerationOrigin =
  | { type: 'regeneration'; generationId: string }
  | { type: 'variation'; outputId: string }
  | { type: 'variation'; versionId: string };

/** Everything `enqueueIntent` needs; built by each entry point. */
type CreativeGenerationIntent = {
  input: ReturnType<CreativeImageGenerationService['validRequest']>;
  references: CreativeGenerationReferenceSelection[] | undefined;
  base?: SelectedCreativeGenerationReference;
  origin?: CreativeGenerationOrigin;
  /**
   * Regeneration reusing the origin's own explicit selection: owner id →
   * checksum frozen by the origin. Gone, moved out of reach or other bytes
   * is a 409 — never a silent substitute.
   */
  frozen?: Map<string, string>;
};

/**
 * `status` is `queued` on creation; an idempotent replay answers with the
 * generation's current status (it may already be processing or terminal).
 */
export type CreativeImageGenerationAccepted = {
  generationId: string;
  status: CreativeGenerationStatus;
  statusPath: string;
};

export type CreativeGeneratedOutputView = {
  id: string;
  outputIndex: number;
  mediaType: 'image';
  /** False once lifecycle cleanup removed the temporary binary. */
  available: boolean;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  byteSize: string | null;
  retentionClass: Extract<CreativeRetentionClass, 'temporary_generation'>;
  contentPath: string | null;
  promotion: {
    kind: CreativeGenerationPromotionKind;
    creativeAssetId: string;
    versionId: string;
    promotedAt: string;
  } | null;
};

/** Public shape: no provider, model, usage, cost, lease or scope ids. */
export type CreativeImageGenerationView = {
  generationId: string;
  type: 'image';
  status: CreativeGenerationStatus;
  /** `prompt` is the operator's text; the composed prompt stays internal. */
  request: {
    prompt: string;
    contentItemId: string | null;
    outputCount: number;
    aspectRatio: CreativeImageAspectRatio;
    quality: CreativeImageQuality;
  };
  /**
   * CS3.6.2 — where this generation came from. `generationId` is the
   * generation to go back to (the regenerated one, or the one that produced
   * the varied output); `creativeAssetId`/`versionId` name a varied version.
   */
  origin: {
    type: CreativeGenerationOriginType;
    generationId: string | null;
    outputId: string | null;
    creativeAssetId: string | null;
    versionId: string | null;
  };
  /**
   * CS3.4.2 — the references frozen for this generation, in the order sent
   * ("Image 1..N"). Owner ids only: no storage key, checksum or URL.
   */
  references: {
    position: number;
    source: CreativeGenerationPersistedReferenceSource;
    /** Brand Kit asset id (`brand`) or media asset id (`planner`/`operator`/`base`). */
    id: string;
    kind: string;
    role: ImageGenerationReferenceRole;
    /** First dispatch attempt started; not proof the provider received it. */
    dispatchStartedAt: string | null;
  }[];
  outputs: CreativeGeneratedOutputView[];
  error: { code: string; message: string; retryable: boolean } | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
};

export type PromoteToNewAssetInput = {
  name?: string;
  folderId?: string;
  contentItemId?: string;
};

export type PromoteToVersionInput = {
  assetId: string;
  revisesVersionId?: string;
};

const FAILURES: Record<
  CreativeGenerationFailureCode,
  { status: number; message: string }
> = {
  unavailable: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message: 'A geração de imagens não está disponível no momento.',
  },
  rejected: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message:
      'O pedido foi recusado pelas regras de conteúdo. Ajuste a descrição e tente novamente.',
  },
  rate_limited: {
    status: HttpStatus.TOO_MANY_REQUESTS,
    message: 'Muitas gerações em pouco tempo. Aguarde e tente novamente.',
  },
  timeout: {
    status: HttpStatus.GATEWAY_TIMEOUT,
    message: 'A geração demorou mais que o esperado. Tente novamente.',
  },
  failed: {
    status: HttpStatus.BAD_GATEWAY,
    message: 'Não foi possível gerar a imagem. Tente novamente.',
  },
  invalid_output: {
    status: HttpStatus.BAD_GATEWAY,
    message: 'A geração retornou um resultado inválido. Tente novamente.',
  },
  // CS3.4.2: a frozen reference could not be read (deleted, replaced) before
  // the provider call. Nothing was sent or billed; nothing is substituted.
  reference_unavailable: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message:
      'Uma imagem de referência não está mais disponível. Revise as referências e gere novamente.',
  },
};

/**
 * The sanitized failure. `code` is the contract; the message is fixed per
 * code, so no provider text can reach a client. Thrown by the API (provider
 * unavailable at enqueue) and used by the worker to classify a failed attempt.
 */
export class CreativeImageGenerationException extends HttpException {
  constructor(
    readonly code: CreativeGenerationFailureCode,
    readonly retryable: boolean,
  ) {
    const { status, message } = FAILURES[code];
    super(
      {
        statusCode: status,
        message,
        code: `image_generation_${code}`,
        retryable,
      },
      status,
    );
  }
}

/** Thrown inside the version transaction when another request promoted first. */
class OutputAlreadyPromotedError extends Error {}

const OUTPUT_NOT_FOUND = 'Imagem gerada não encontrada.';
const OUTPUT_EXPIRED = 'A imagem gerada expirou. Gere novamente.';
const BASE_EXPIRED =
  'Este resultado expirou e não pode mais ser usado como base.';

/** Same rule as the Inbox `Idempotency-Key` headers. */
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{1,180}$/;
const IDEMPOTENCY_INDEX = 'UQ_social_creative_generations_idempotency';
/** Callers outside HTTP skip the DTO; a malformed id must not reach SQL. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * CS3.2 — the API side of asynchronous image generation.
 *
 * `enqueue` only persists a `queued` generation and answers 202: the provider
 * runs in `CreativeImageGenerationWorker`, outside any HTTP request. Reads and
 * promotions go through the persisted generation/output rows, always in the
 * caller's full four-part scope — an id alone authorizes nothing.
 *
 * Storage still goes exclusively through `MediaAssetUploadService`: no bucket,
 * key or endpoint is known here.
 */
@Injectable()
export class CreativeImageGenerationService {
  constructor(
    private readonly provider: ImageGenerationProvider,
    private readonly config: CreativeGenerationConfigService,
    @InjectRepository(CreativeGenerationEntity, 'agency')
    private readonly generations: Repository<CreativeGenerationEntity>,
    @InjectRepository(CreativeGenerationOutputEntity, 'agency')
    private readonly outputs: Repository<CreativeGenerationOutputEntity>,
    @InjectRepository(MediaAssetEntity, 'agency')
    private readonly media: Repository<MediaAssetEntity>,
    @InjectRepository(CreativeAssetEntity, 'agency')
    private readonly creativeAssets: Repository<CreativeAssetEntity>,
    private readonly mediaUpload: MediaAssetUploadService,
    private readonly assets: CreativeAssetService,
    private readonly versionApprovals: CreativeVersionApprovalService,
    private readonly context: CreativeGenerationContextService,
    private readonly referenceSelector: CreativeGenerationReferenceSelector,
    @InjectRepository(CreativeGenerationReferenceEntity, 'agency')
    private readonly references: Repository<CreativeGenerationReferenceEntity>,
  ) {}

  /**
   * Persists the request as a `queued` generation. The INSERT is the enqueue,
   * so a generation exists exactly when its job does.
   *
   * CS3.2.1 — at most one generation per `Idempotency-Key` in the caller's
   * full scope. The same key with the same request answers with the existing
   * generation, whatever its status — a replay never re-enqueues or resets
   * it (retrying the provider is the worker's job). The same key with another
   * request is a 409. The unique index decides concurrent requests; the
   * lookup before the INSERT is only the fast path for plain retries.
   *
   * CS3.4.1 — the context is resolved BEFORE the idempotency lookup because
   * it is part of the request's identity: the same key and the same typed
   * prompt over a different Brand Kit or Planner content is a different
   * intent (409), not a replay. The effective prompt is composed and frozen
   * here, so the worker sends exactly what was accepted.
   *
   * CS3.4.2 — the reference selection is resolved with the context, for the
   * same reason: the ordered images (with their checksums) are part of the
   * intent. They are inserted with the generation in one transaction, so the
   * worker can never claim a generation whose references are not there yet.
   * No bytes are read here — only owner rows (scope, mime, size, checksum).
   */
  async enqueue(
    scope: CreativeStudioScope,
    actor: string | null,
    request: CreativeImageGenerationRequest,
    idempotencyKey: string | undefined,
  ): Promise<CreativeImageGenerationAccepted> {
    const key = requireIdempotencyKey(idempotencyKey);
    return this.enqueueIntent(scope, actor, key, {
      input: this.validRequest(request),
      references: request.references,
    });
  }

  /**
   * CS3.6.2 — "Gerar novamente". A new generation (never a reset of the
   * old one, which stays byte-for-byte as it was) with:
   *   - the origin's operator prompt and settings, unless overridden;
   *   - its Planner item, resolved again — the CURRENT Brand Kit and Planner
   *     context, so a correction made since then is used (decision 48);
   *   - its explicit reference selection, the same images with the same
   *     bytes (409 when one is gone); a default selection is the default rule
   *     again, over the item's current references;
   *   - a variation's base, the exact same bytes (410 once expired).
   * The effective prompt is composed again; nothing internal is copied.
   */
  async regenerate(
    scope: CreativeStudioScope,
    actor: string | null,
    generationId: string,
    request: CreativeImageRegenerationRequest,
    idempotencyKey: string | undefined,
  ): Promise<CreativeImageGenerationAccepted> {
    const key = requireIdempotencyKey(idempotencyKey);
    const origin = await this.generations.findOne({
      where: { id: generationId, ...mediaAssetScopeWhere(scope) },
    });
    if (!origin) throw new NotFoundException('Geração não encontrada.');
    if (origin.status !== 'completed' && origin.status !== 'failed')
      throw new ConflictException({
        code: 'generation_not_finished',
        message: 'Aguarde a geração terminar para gerar novamente.',
      });
    this.assertOriginContent(origin);

    const rows = await this.references.find({
      where: { generationId: origin.id },
      order: { position: 'ASC' },
    });
    const baseRow = rows.find((row) => row.source === 'base');
    const previous = rows.filter((row) => row.source !== 'base');
    const reuse =
      request.references === undefined &&
      origin.generationContext?.references.selected?.selection === 'explicit';
    return this.enqueueIntent(scope, actor, key, {
      input: this.validRequest({
        prompt: request.prompt ?? origin.prompt,
        contentItemId: origin.contentItemId,
        outputCount: request.outputCount ?? origin.outputCount,
        aspectRatio: request.aspectRatio ?? origin.aspectRatio,
        quality: request.quality ?? origin.quality,
        references: request.references,
      }),
      references: reuse ? previous.map(selectionOf) : request.references,
      frozen: reuse
        ? new Map(previous.map((row) => [ownerId(row), row.checksum]))
        : undefined,
      base: baseRow ? await this.frozenBase(scope, baseRow) : undefined,
      origin: { type: 'regeneration', generationId: origin.id },
    });
  }

  /**
   * CS3.6.2 — variation of a generation output. The base is that output's
   * temporary binary while it exists; once expired it is a 410, even when
   * the output was promoted — the saved copy is named in the answer, and
   * using it is an explicit choice (`varyVersion`), never a silent swap.
   * Settings and Planner item default to the origin generation's.
   */
  async varyOutput(
    scope: CreativeStudioScope,
    actor: string | null,
    outputId: string,
    request: CreativeImageVariationRequest,
    idempotencyKey: string | undefined,
  ): Promise<CreativeImageGenerationAccepted> {
    const key = requireIdempotencyKey(idempotencyKey);
    const output = await this.findOutput(scope, outputId);
    const origin = await this.generations.findOneByOrFail({
      id: output.generationId,
    });
    this.assertOriginContent(origin);
    const media = output.mediaAssetId
      ? await this.media.findOne({
          where: {
            id: output.mediaAssetId,
            ...mediaAssetScopeWhere(scope),
            source: CREATIVE_GENERATION_MEDIA_SOURCE,
          },
        })
      : null;
    if (!media)
      throw new GoneException({
        code: 'variation_base_expired',
        message: BASE_EXPIRED,
        savedCopy:
          output.promotedCreativeAssetId && output.promotedVersionId
            ? {
                creativeAssetId: output.promotedCreativeAssetId,
                versionId: output.promotedVersionId,
              }
            : null,
      });
    return this.enqueueIntent(scope, actor, key, {
      input: this.validRequest(
        {
          prompt: request.prompt,
          contentItemId: origin.contentItemId,
          outputCount: request.outputCount ?? 1,
          aspectRatio: request.aspectRatio ?? origin.aspectRatio,
          quality: request.quality ?? origin.quality,
          references: request.references,
        },
        'Descreva o que deseja mudar.',
      ),
      references: request.references ?? [],
      base: baseReference(media),
      origin: { type: 'variation', outputId: output.id },
    });
  }

  /**
   * CS3.6.2 — variation of an immutable Creative Version: its durable media
   * is the base, read through the same media boundary by the worker — no
   * copy is made up front. The Planner item is the asset's.
   */
  async varyVersion(
    scope: CreativeStudioScope,
    actor: string | null,
    assetId: string,
    versionId: string,
    request: CreativeImageVariationRequest,
    idempotencyKey: string | undefined,
  ): Promise<CreativeImageGenerationAccepted> {
    const key = requireIdempotencyKey(idempotencyKey);
    const asset = await this.creativeAssets.findOne({
      where: { id: assetId, ...mediaAssetScopeWhere(scope) },
    });
    const version = asset
      ? await this.creativeAssets.manager
          .getRepository(CreativeAssetVersionEntity)
          .findOneBy({ id: versionId, creativeAssetId: asset.id })
      : null;
    if (!asset || !version)
      throw new NotFoundException('Versão não encontrada.');
    const media =
      asset.assetType === 'image'
        ? await this.media.findOne({
            where: {
              id: version.mediaAssetId,
              ...mediaAssetScopeWhere(scope),
              source: durableMediaAssetSource(),
            },
          })
        : null;
    if (!media) throw unsupportedBase();
    return this.enqueueIntent(scope, actor, key, {
      input: this.validRequest(
        {
          prompt: request.prompt,
          contentItemId: asset.contentItemId,
          outputCount: request.outputCount,
          aspectRatio: request.aspectRatio,
          quality: request.quality,
          references: request.references,
        },
        'Descreva o que deseja mudar.',
      ),
      references: request.references ?? [],
      base: baseReference(media),
      origin: { type: 'variation', versionId: version.id },
    });
  }

  /**
   * An origin made for a Planner item whose link was erased (item hard
   * deleted → FK SET NULL) must not silently become standalone.
   */
  private assertOriginContent(origin: CreativeGenerationEntity) {
    if (!origin.contentItemId && origin.generationContext?.content)
      throw originContentUnavailable();
  }

  /** A regenerated variation's base: the same media, still the same bytes. */
  private async frozenBase(
    scope: CreativeStudioScope,
    row: CreativeGenerationReferenceEntity,
  ) {
    const media = await this.media.findOne({
      where: { id: row.mediaAssetId ?? '', ...mediaAssetScopeWhere(scope) },
    });
    if (!media || media.checksum !== row.checksum)
      throw new GoneException({
        code: 'variation_base_expired',
        message: BASE_EXPIRED,
        savedCopy: null,
      });
    return baseReference(media);
  }

  private async enqueueIntent(
    scope: CreativeStudioScope,
    actor: string | null,
    key: string,
    intent: CreativeGenerationIntent,
  ): Promise<CreativeImageGenerationAccepted> {
    const { input, origin } = intent;
    const context = await this.resolveContext(
      scope,
      input.contentItemId,
      origin,
    );
    const plan = await this.selectReferences(scope, context, intent);
    const digests = {
      contextDigest: context.digest,
      referencesDigest: plan.digest,
    };
    const fingerprint = origin
      ? derivedImageRequestFingerprint({ ...input, ...digests, origin })
      : imageRequestFingerprint({ ...input, ...digests });

    const existing = await this.findByIdempotencyKey(scope, key);
    if (existing) return this.replayEnqueue(existing, fingerprint);

    // Accepting work only a disabled provider could pick up would leave it
    // queued forever or failing later; refuse now with the CS3.1 code.
    if (!this.provider.enabled)
      throw new CreativeImageGenerationException('unavailable', false);
    let saved: CreativeGenerationEntity;
    try {
      saved = await this.generations.manager.transaction(async (manager) => {
        const generations = manager.withRepository(this.generations);
        const generation = await generations.save(
          generations.create({
            tenantId: scope.tenantId,
            workspaceId: scope.workspaceId,
            agencyClientId: scope.agencyClientId,
            companyContextId: scope.companyContextId,
            generationType: 'image',
            status: 'queued',
            prompt: input.prompt,
            contentItemId: input.contentItemId,
            outputCount: input.outputCount,
            aspectRatio: input.aspectRatio,
            quality: input.quality,
            originType: origin?.type ?? 'fresh',
            originGenerationId:
              origin && 'generationId' in origin ? origin.generationId : null,
            originOutputId:
              origin && 'outputId' in origin ? origin.outputId : null,
            originVersionId:
              origin && 'versionId' in origin ? origin.versionId : null,
            effectivePrompt: composeCreativeImagePrompt({
              prompt: input.prompt,
              aspectRatio: input.aspectRatio,
              brand: context.brand,
              content: context.content,
              references: plan.references,
            }),
            generationContext: generationContextRecord(
              context,
              CREATIVE_IMAGE_PROMPT_COMPOSER_VERSION,
              plan,
            ),
            idempotencyKey: key,
            requestFingerprint: fingerprint,
            maxAttempts: this.config.maxAttempts,
            requestedById: actor,
          }),
        );
        // Sequential on purpose: one transaction client, one query at a time.
        for (const [position, ref] of plan.references.entries())
          await manager
            .getRepository(CreativeGenerationReferenceEntity)
            .insert({
              generationId: generation.id,
              position,
              source: ref.source,
              kind: ref.kind,
              role: ref.role,
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
      // Lost the race: the winner's row is committed by the time Postgres
      // reports the violation.
      const winner = await this.findByIdempotencyKey(scope, key);
      if (!winner) throw error;
      return this.replayEnqueue(winner, fingerprint);
    }
    return this.accepted(saved.id, 'queued');
  }

  /** A derived generation's Planner item must still resolve (409 otherwise). */
  private async resolveContext(
    scope: CreativeStudioScope,
    contentItemId: string | null,
    origin: CreativeGenerationOrigin | undefined,
  ) {
    try {
      return await this.context.resolve(scope, contentItemId);
    } catch (error) {
      if (origin && refusalCode(error) === 'content_item_not_found')
        throw originContentUnavailable();
      throw error;
    }
  }

  private async selectReferences(
    scope: CreativeStudioScope,
    context: Awaited<ReturnType<CreativeGenerationContextService['resolve']>>,
    intent: CreativeGenerationIntent,
  ) {
    const { frozen } = intent;
    let plan: Awaited<
      ReturnType<CreativeGenerationReferenceSelector['select']>
    >;
    try {
      plan = await this.referenceSelector.select(
        scope,
        context,
        intent.references,
        intent.base,
      );
    } catch (error) {
      if (frozen && refusalCode(error) === 'reference_not_found')
        throw originReferenceUnavailable();
      throw error;
    }
    if (
      frozen &&
      plan.references.some(
        (ref) =>
          ref.source !== 'base' && frozen.get(ref.assetId) !== ref.checksum,
      )
    )
      throw originReferenceUnavailable();
    return plan;
  }

  private findByIdempotencyKey(scope: CreativeStudioScope, key: string) {
    return this.generations.findOne({
      where: {
        ...mediaAssetScopeWhere(scope),
        generationType: 'image',
        idempotencyKey: key,
      },
    });
  }

  private replayEnqueue(
    generation: CreativeGenerationEntity,
    fingerprint: string,
  ): CreativeImageGenerationAccepted {
    if (generation.requestFingerprint !== fingerprint)
      throw new ConflictException({
        code: 'idempotency_key_conflict',
        message:
          'Esta chave de idempotência já foi usada para um pedido diferente.',
      });
    return this.accepted(generation.id, generation.status);
  }

  private accepted(
    generationId: string,
    status: CreativeGenerationStatus,
  ): CreativeImageGenerationAccepted {
    return {
      generationId,
      status,
      statusPath: `/social/creative-studio/generations/${generationId}`,
    };
  }

  async get(
    scope: CreativeStudioScope,
    generationId: string,
  ): Promise<CreativeImageGenerationView> {
    const generation = await this.generations.findOne({
      // Same four-part rule as the media boundary (`IsNull()` for null parts).
      where: { id: generationId, ...mediaAssetScopeWhere(scope) },
    });
    if (!generation) throw new NotFoundException('Geração não encontrada.');

    const outputs =
      generation.status === 'completed'
        ? await this.outputs.find({
            where: { generationId: generation.id },
            order: { outputIndex: 'ASC' },
          })
        : [];
    const mediaIds = outputs
      .map((output) => output.mediaAssetId)
      .filter((id): id is string => id !== null);
    const media = mediaIds.length
      ? await this.media.find({
          where: {
            id: In(mediaIds),
            ...mediaAssetScopeWhere(scope),
            source: CREATIVE_GENERATION_MEDIA_SOURCE,
          },
        })
      : [];
    const mediaById = new Map(media.map((asset) => [asset.id, asset]));
    const references = await this.references.find({
      where: { generationId: generation.id },
      order: { position: 'ASC' },
    });
    // The origin rows are in the generation's scope by trigger.
    const originOutput = generation.originOutputId
      ? await this.outputs.findOneBy({ id: generation.originOutputId })
      : null;
    const originVersion = generation.originVersionId
      ? await this.creativeAssets.manager
          .getRepository(CreativeAssetVersionEntity)
          .findOneBy({ id: generation.originVersionId })
      : null;

    return {
      generationId: generation.id,
      type: generation.generationType,
      status: generation.status,
      request: {
        prompt: generation.prompt,
        contentItemId: generation.contentItemId,
        outputCount: generation.outputCount,
        aspectRatio: generation.aspectRatio,
        quality: generation.quality,
      },
      origin: {
        type: generation.originType,
        generationId:
          generation.originGenerationId ?? originOutput?.generationId ?? null,
        outputId: generation.originOutputId,
        creativeAssetId: originVersion?.creativeAssetId ?? null,
        versionId: generation.originVersionId,
      },
      references: references.map((ref) => ({
        position: ref.position,
        source: ref.source,
        id: (ref.brandKitAssetId ?? ref.mediaAssetId) as string,
        kind: ref.kind,
        role: ref.role,
        dispatchStartedAt: ref.dispatchStartedAt?.toISOString() ?? null,
      })),
      outputs: outputs.map((output) =>
        this.outputView(
          output,
          output.mediaAssetId ? mediaById.get(output.mediaAssetId) : undefined,
        ),
      ),
      error:
        generation.status === 'failed' && generation.errorCode
          ? {
              code: `image_generation_${generation.errorCode}`,
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

  /** Authorized read of one temporary output, in the caller's full company scope. */
  async readOutput(scope: CreativeStudioScope, outputId: string) {
    const output = await this.findOutput(scope, outputId);
    return this.temporaryContent(scope, output);
  }

  /**
   * Promotion copies the chosen output's bytes through the Studio's normal
   * upload path — same validation, numbering, thumbnail and Planner
   * reflection — and leaves the temporary row as it is. A version therefore
   * never shares a binary with a candidate, and the candidate's binary
   * becomes eligible for cleanup on the next sweep (CS3.6.1), never inside
   * this transaction. A replay after cleanup still answers from the output
   * row: it needs no binary.
   *
   * At most once per output: the output records the version it became in the
   * same transaction that creates it. A repeated request with the same intent
   * (double click, client retry) answers with that first result; any other
   * intent is a 409.
   */
  promoteToNewAsset(
    scope: CreativeStudioScope,
    actor: string | null,
    outputId: string,
    input: PromoteToNewAssetInput,
  ) {
    return this.promote(
      scope,
      actor,
      outputId,
      { kind: 'new_asset' },
      (file, onVersionCreated) =>
        this.assets.upload(scope, actor, {
          file,
          ...input,
          sourceType: 'generated',
          onVersionCreated,
        }),
      (output) => this.promotedAsset(scope, output),
    );
  }

  promoteToVersion(
    scope: CreativeStudioScope,
    actor: string | null,
    outputId: string,
    input: PromoteToVersionInput,
  ) {
    const { assetId, revisesVersionId } = input;
    return this.promote(
      scope,
      actor,
      outputId,
      { kind: revisesVersionId ? 'revision' : 'version', assetId },
      (file, onVersionCreated) =>
        revisesVersionId
          ? this.versionApprovals.startRevision(
              scope,
              actor,
              assetId,
              revisesVersionId,
              file,
              onVersionCreated,
            )
          : this.assets.createVersion(
              scope,
              actor,
              assetId,
              file,
              undefined,
              onVersionCreated,
            ),
      (output) => this.promotedVersion(scope, output),
    );
  }

  private async promote<T>(
    scope: CreativeStudioScope,
    actor: string | null,
    outputId: string,
    intent: { kind: CreativeGenerationPromotionKind; assetId?: string },
    perform: (
      file: Awaited<ReturnType<CreativeImageGenerationService['outputFile']>>,
      onVersionCreated: CreativeVersionCreatedHook,
    ) => Promise<T>,
    replay: (output: CreativeGenerationOutputEntity) => Promise<T>,
  ): Promise<T> {
    const output = await this.findOutput(scope, outputId);
    if (output.promotedVersionId) return this.replay(output, intent, replay);

    const file = await this.outputFile(scope, output);
    try {
      return await perform(file, async (manager, created) => {
        // Compare-and-set inside the version's transaction: of two concurrent
        // promotions only one moves NULL → version; the other rolls back here
        // and the Studio compensates its binaries.
        const claimed = await manager.update(
          CreativeGenerationOutputEntity,
          { id: output.id, promotedVersionId: IsNull() },
          {
            promotionKind: intent.kind,
            promotedCreativeAssetId: created.creativeAssetId,
            promotedVersionId: created.versionId,
            promotedById: actor,
            promotedAt: new Date(),
          },
        );
        if ((claimed.affected ?? 0) !== 1)
          throw new OutputAlreadyPromotedError();
      });
    } catch (error) {
      // The winner of a race may also make the loser fail earlier (revision
      // pointer already moved, version number taken). Whatever the error, a
      // promotion that now exists is the answer.
      const current = await this.outputs.findOneBy({ id: output.id });
      if (current?.promotedVersionId)
        return this.replay(current, intent, replay);
      throw error;
    }
  }

  private replay<T>(
    output: CreativeGenerationOutputEntity,
    intent: { kind: CreativeGenerationPromotionKind; assetId?: string },
    replay: (output: CreativeGenerationOutputEntity) => Promise<T>,
  ): Promise<T> {
    const same =
      output.promotionKind === intent.kind &&
      (intent.assetId === undefined ||
        output.promotedCreativeAssetId === intent.assetId);
    if (!same)
      throw new ConflictException({
        code: 'generation_output_already_promoted',
        message: 'Esta imagem gerada já foi usada em outro criativo.',
      });
    return replay(output);
  }

  private async promotedAsset(
    scope: CreativeStudioScope,
    output: CreativeGenerationOutputEntity,
  ) {
    const asset = await this.creativeAssets.findOne({
      where: {
        id: output.promotedCreativeAssetId ?? '',
        ...mediaAssetScopeWhere(scope),
      },
    });
    if (!asset) throw new NotFoundException('Criativo não encontrado.');
    return asset;
  }

  private async promotedVersion(
    scope: CreativeStudioScope,
    output: CreativeGenerationOutputEntity,
  ) {
    const versions = await this.assets.versionsFor(
      scope,
      output.promotedCreativeAssetId ?? '',
    );
    const version = versions.find((v) => v.id === output.promotedVersionId);
    if (!version) throw new NotFoundException('Versão não encontrada.');
    return version;
  }

  /** The output, only if its generation is in the caller's full scope. */
  private async findOutput(scope: CreativeStudioScope, outputId: string) {
    const output = await this.outputs.findOneBy({ id: outputId });
    if (
      !output ||
      !(await this.generations.exists({
        where: { id: output.generationId, ...mediaAssetScopeWhere(scope) },
      }))
    )
      throw new NotFoundException(OUTPUT_NOT_FOUND);
    return output;
  }

  /**
   * CS3.6.1 — every "binary expired" state answers the same 410: purged
   * (`media_asset_id` NULL), tombstoned by cleanup but not yet purged (the row
   * is hidden from reads), or object already gone mid-purge. `findOutput`
   * already proved the output is the caller's, and the output's media is held
   * to the generation's scope by trigger, so a missing media here is never a
   * scope denial.
   */
  private async temporaryContent(
    scope: CreativeStudioScope,
    output: CreativeGenerationOutputEntity,
  ) {
    if (!output.mediaAssetId) throw new GoneException(OUTPUT_EXPIRED);
    try {
      return await this.mediaUpload.getTemporaryContent(
        scope,
        output.mediaAssetId,
        CREATIVE_GENERATION_MEDIA_SOURCE,
      );
    } catch (error) {
      if (error instanceof NotFoundException)
        throw new GoneException(OUTPUT_EXPIRED);
      throw error;
    }
  }

  private async outputFile(
    scope: CreativeStudioScope,
    output: CreativeGenerationOutputEntity,
  ) {
    const { asset, file } = await this.temporaryContent(scope, output);
    const buffer = await readAll(file.body);
    return {
      buffer,
      originalname: asset.originalFilename ?? 'imagem-gerada',
      mimetype: asset.mimeType,
      size: buffer.length,
    };
  }

  private validRequest(
    request: CreativeImageGenerationRequest,
    emptyPrompt = 'Descreva a imagem desejada.',
  ) {
    const prompt =
      typeof request.prompt === 'string' ? request.prompt.trim() : '';
    if (!prompt) throw new BadRequestException(emptyPrompt);
    const contentItemId = request.contentItemId ?? null;
    if (contentItemId !== null && !UUID.test(contentItemId))
      throw new BadRequestException({
        code: 'content_item_not_found',
        message: 'Conteúdo não encontrado.',
      });
    if (request.references !== undefined && !Array.isArray(request.references))
      throw new BadRequestException({
        code: 'reference_not_found',
        message: 'Imagem de referência não encontrada.',
      });
    const outputCount = request.outputCount ?? 1;
    if (
      !Number.isInteger(outputCount) ||
      outputCount < 1 ||
      outputCount > MAX_IMAGE_GENERATION_OUTPUTS
    )
      throw new BadRequestException(
        `Peça entre 1 e ${MAX_IMAGE_GENERATION_OUTPUTS} imagens.`,
      );
    return {
      prompt,
      contentItemId,
      outputCount,
      aspectRatio: request.aspectRatio ?? ('1:1' as const),
      quality: request.quality ?? ('standard' as const),
    };
  }

  private outputView(
    output: CreativeGenerationOutputEntity,
    asset: MediaAssetEntity | undefined,
  ): CreativeGeneratedOutputView {
    return {
      id: output.id,
      outputIndex: output.outputIndex,
      mediaType: 'image',
      available: Boolean(asset),
      mimeType: asset?.mimeType ?? null,
      width: asset?.width ?? null,
      height: asset?.height ?? null,
      byteSize: asset?.byteSize ?? null,
      retentionClass: 'temporary_generation',
      contentPath: asset
        ? `/social/creative-studio/generations/outputs/${output.id}/content`
        : null,
      promotion:
        output.promotionKind &&
        output.promotedCreativeAssetId &&
        output.promotedVersionId &&
        output.promotedAt
          ? {
              kind: output.promotionKind,
              creativeAssetId: output.promotedCreativeAssetId,
              versionId: output.promotedVersionId,
              promotedAt: output.promotedAt.toISOString(),
            }
          : null,
    };
  }
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

/**
 * sha256 of the normalized business request: defaults applied and the prompt
 * trimmed, serialized with a fixed field order. `outputCount` omitted and
 * `outputCount: 1` are the same request. Scope, actor, time and queue state
 * stay out — scope is part of the unique key instead.
 *
 * `image.v2` (CS3.4.1) adds the intent's context: the Planner item and the
 * Generation Context digest (normalized creative facts + reference
 * identities; no timestamps, no volatile ids). The composer version is left
 * out on purpose — a recipe deploy must not turn a client retry into a 409.
 * Rows fingerprinted as `image.v1` simply never match a v2 request.
 *
 * `image.v3` (CS3.4.2) adds the SELECTED references: their ordered identities
 * and checksums (`referencesDigest`, NULL = none). Order counts — the prompt
 * names images by position. The available set stays in `contextDigest`.
 * Whether the selection was explicit or the default does not: the same
 * images in the same order are the same request.
 */
export function imageRequestFingerprint(input: {
  prompt: string;
  contentItemId: string | null;
  outputCount: number;
  aspectRatio: CreativeImageAspectRatio;
  quality: CreativeImageQuality;
  contextDigest: string;
  referencesDigest: string | null;
}) {
  const canonical = JSON.stringify([
    'image.v3',
    input.prompt,
    input.contentItemId,
    input.outputCount,
    input.aspectRatio,
    input.quality,
    input.contextDigest,
    input.referencesDigest,
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * `image.v4` (CS3.6.2) — the fingerprint of a DERIVED intent: every v3
 * field plus the mode and the exact origin. The base is inside
 * `referencesDigest` (source `base`, Image 1, its checksum), so another base,
 * the same base with other bytes, or the same image moved between base and
 * reference all differ. A fresh request keeps `image.v3` untouched, so rows
 * accepted before this slice still replay; a derived intent can never match
 * a fresh one (or its own origin) under the same key.
 */
export function derivedImageRequestFingerprint(input: {
  origin: CreativeGenerationOrigin;
  prompt: string;
  contentItemId: string | null;
  outputCount: number;
  aspectRatio: CreativeImageAspectRatio;
  quality: CreativeImageQuality;
  contextDigest: string;
  referencesDigest: string | null;
}) {
  const { origin } = input;
  const canonical = JSON.stringify([
    'image.v4',
    origin.type,
    'generationId' in origin
      ? ['generation', origin.generationId.toLowerCase()]
      : 'outputId' in origin
        ? ['output', origin.outputId.toLowerCase()]
        : ['version', origin.versionId.toLowerCase()],
    input.prompt,
    input.contentItemId,
    input.outputCount,
    input.aspectRatio,
    input.quality,
    input.contextDigest,
    input.referencesDigest,
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * The base as a frozen reference. Only a binary the provider can take and
 * whose bytes can be proven (checksum); anything else is not a base.
 */
function baseReference(
  media: MediaAssetEntity,
): SelectedCreativeGenerationReference {
  const byteSize = Number(media.byteSize);
  if (
    !media.checksum ||
    !(IMAGE_GENERATION_REFERENCE_MIME_TYPES as readonly string[]).includes(
      media.mimeType,
    ) ||
    !Number.isSafeInteger(byteSize) ||
    byteSize <= 0 ||
    byteSize > MAX_IMAGE_GENERATION_REFERENCE_BYTES
  )
    throw unsupportedBase();
  return {
    source: 'base',
    assetId: media.id,
    kind: 'base',
    role: 'base',
    mimeType: media.mimeType,
    byteSize,
    checksum: media.checksum,
  };
}

function unsupportedBase() {
  return new BadRequestException({
    code: 'variation_base_unsupported',
    message:
      'Esta imagem não pode ser usada como base. Use uma imagem PNG, JPEG ou WebP de até 16 MB.',
  });
}

function originContentUnavailable() {
  return new ConflictException({
    code: 'origin_content_item_unavailable',
    message:
      'O conteúdo do Planner desta geração não está mais disponível. Crie uma nova geração.',
  });
}

function originReferenceUnavailable() {
  return new ConflictException({
    code: 'origin_reference_unavailable',
    message:
      'Uma referência da geração original não está mais disponível. Revise as referências.',
  });
}

function refusalCode(error: unknown) {
  if (!(error instanceof HttpException)) return null;
  const body = error.getResponse() as { code?: unknown } | string;
  return typeof body === 'object' && typeof body.code === 'string'
    ? body.code
    : null;
}

function ownerId(row: CreativeGenerationReferenceEntity) {
  return (row.brandKitAssetId ?? row.mediaAssetId) as string;
}

/** A frozen row back into the explicit choice that produced it. */
function selectionOf(
  row: CreativeGenerationReferenceEntity,
): CreativeGenerationReferenceSelection {
  return row.source === 'operator'
    ? {
        source: 'operator',
        id: ownerId(row),
        kind: row.kind as CreativeGenerationReferenceSelection['kind'],
      }
    : { source: row.source as 'brand' | 'planner', id: ownerId(row) };
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
