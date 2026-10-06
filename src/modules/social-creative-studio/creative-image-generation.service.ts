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
import {
  CreativeAssetService,
  type CreativeVersionCreatedHook,
} from './creative-asset.service';
import { CreativeGenerationConfigService } from './creative-generation-config';
import {
  type CreativeImageAspectRatio,
  type CreativeImageQuality,
  type ImageGenerationFailureCode,
  ImageGenerationProvider,
  MAX_IMAGE_GENERATION_OUTPUTS,
} from './creative-image-generation.provider';
import {
  CREATIVE_GENERATION_MEDIA_SOURCE,
  type CreativeRetentionClass,
} from './creative-retention';
import type { CreativeStudioScope } from './creative-studio.scope';
import { CreativeVersionApprovalService } from './creative-version-approval.service';
import {
  CreativeAssetEntity,
  CreativeGenerationEntity,
  CreativeGenerationOutputEntity,
  type CreativeGenerationPromotionKind,
  type CreativeGenerationStatus,
} from './entities';

/**
 * Lyra's request vocabulary. Brand Kit and Planner context will be added as
 * REFERENCES (ids resolved server-side under the same scope), never as copied
 * fields: the Brand Kit stays in Social Settings and copy/caption stay in the
 * Planner.
 */
export type CreativeImageGenerationRequest = {
  prompt: string;
  outputCount?: number;
  aspectRatio?: CreativeImageAspectRatio;
  quality?: CreativeImageQuality;
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
  request: {
    prompt: string;
    outputCount: number;
    aspectRatio: CreativeImageAspectRatio;
    quality: CreativeImageQuality;
  };
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
  ImageGenerationFailureCode,
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
};

/**
 * The sanitized failure. `code` is the contract; the message is fixed per
 * code, so no provider text can reach a client. Thrown by the API (provider
 * unavailable at enqueue) and used by the worker to classify a failed attempt.
 */
export class CreativeImageGenerationException extends HttpException {
  constructor(
    readonly code: ImageGenerationFailureCode,
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

/** Same rule as the Inbox `Idempotency-Key` headers. */
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{1,180}$/;
const IDEMPOTENCY_INDEX = 'UQ_social_creative_generations_idempotency';

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
   */
  async enqueue(
    scope: CreativeStudioScope,
    actor: string | null,
    request: CreativeImageGenerationRequest,
    idempotencyKey: string | undefined,
  ): Promise<CreativeImageGenerationAccepted> {
    const key = requireIdempotencyKey(idempotencyKey);
    const input = this.validRequest(request);
    const fingerprint = imageRequestFingerprint(input);

    const existing = await this.findByIdempotencyKey(scope, key);
    if (existing) return this.replayEnqueue(existing, fingerprint);

    // Accepting work only a disabled provider could pick up would leave it
    // queued forever or failing later; refuse now with the CS3.1 code.
    if (!this.provider.enabled)
      throw new CreativeImageGenerationException('unavailable', false);
    let saved: CreativeGenerationEntity;
    try {
      saved = await this.generations.save(
        this.generations.create({
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          agencyClientId: scope.agencyClientId,
          companyContextId: scope.companyContextId,
          generationType: 'image',
          status: 'queued',
          ...input,
          idempotencyKey: key,
          requestFingerprint: fingerprint,
          maxAttempts: this.config.maxAttempts,
          requestedById: actor,
        }),
      );
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

    return {
      generationId: generation.id,
      type: generation.generationType,
      status: generation.status,
      request: {
        prompt: generation.prompt,
        outputCount: generation.outputCount,
        aspectRatio: generation.aspectRatio,
        quality: generation.quality,
      },
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
   * reflection — and leaves the temporary row as it is, still eligible for
   * cleanup. A version therefore never shares a binary with a candidate.
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

  private temporaryContent(
    scope: CreativeStudioScope,
    output: CreativeGenerationOutputEntity,
  ) {
    if (!output.mediaAssetId)
      throw new GoneException('A imagem gerada expirou. Gere novamente.');
    return this.mediaUpload.getTemporaryContent(
      scope,
      output.mediaAssetId,
      CREATIVE_GENERATION_MEDIA_SOURCE,
    );
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

  private validRequest(request: CreativeImageGenerationRequest) {
    const prompt = request.prompt?.trim();
    if (!prompt) throw new BadRequestException('Descreva a imagem desejada.');
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
 * trimmed (exactly what is stored and sent to the provider), serialized with
 * a fixed field order. `outputCount` omitted and `outputCount: 1` are the
 * same request. Scope, actor, time and queue state stay out — scope is part
 * of the unique key instead. The version prefix lets the fields evolve.
 */
export function imageRequestFingerprint(input: {
  prompt: string;
  outputCount: number;
  aspectRatio: CreativeImageAspectRatio;
  quality: CreativeImageQuality;
}) {
  const canonical = JSON.stringify([
    'image.v1',
    input.prompt,
    input.outputCount,
    input.aspectRatio,
    input.quality,
  ]);
  return createHash('sha256').update(canonical).digest('hex');
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
