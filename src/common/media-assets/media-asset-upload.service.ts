// src/common/media-assets/media-asset-upload.service.ts
//
// Writes and lists private-bucket media identities (Social Planner E3, B1).
//
// Before this service, `MediaAsset` was a read-only boundary: the publication
// contract required a `mediaAssetId` and nothing in the platform could mint
// one, so no operator could ever schedule a publication with media. This is
// the write half; `MediaAssetResolverService` remains the read half and is
// still the only place a `mediaAssetId` becomes a storage location.

import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { IsNull, Not, Repository } from 'typeorm';
import { FilesService } from '../files/files.service';
import {
  MEDIA_ASSET_METADATA_READER,
  type MediaAssetMetadataReader,
} from './media-asset-metadata.port';
import {
  assertMediaAssetSize,
  buildMediaAssetObjectKey,
  resolveMediaAssetContentType,
  sanitizeMediaAssetFilename,
} from './media-asset-upload.rules';
import { MediaAssetEntity } from './media-asset.entity';
import {
  type MediaAssetScope,
  mediaAssetScopeWhere,
} from './media-asset-resolver.service';
import {
  durableMediaAssetSource,
  isTemporaryMediaAssetSource,
} from './media-asset-retention';

export type UploadMediaAssetInput = {
  readonly file: {
    readonly buffer: Buffer;
    readonly originalname: string;
    readonly mimetype?: string;
    readonly size?: number;
  };
  readonly source: string;
  /** Sanitized product metadata (the entity's rule applies: no secrets). */
  readonly metadata?: Record<string, unknown>;
};

/** Upper bound on one listing page, so a scope with thousands of assets cannot be asked for all of them at once. */
const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 50;

@Injectable()
export class MediaAssetUploadService {
  constructor(
    @InjectRepository(MediaAssetEntity, 'agency')
    private readonly mediaAssets: Repository<MediaAssetEntity>,
    private readonly filesService: FilesService,
    @Inject(MEDIA_ASSET_METADATA_READER)
    private readonly metadataReader: MediaAssetMetadataReader,
  ) {}

  /**
   * Stores one binary and the row that identifies it.
   *
   * ORDER: validate → object → row, with the object best-effort removed if the
   * row fails. This is the order `brand-kit.service.ts` settled on and the
   * reasoning carries over unchanged: a row pointing at a key that does not
   * exist is a permanently broken asset indistinguishable from a real one,
   * while an orphaned object is invisible and reclaimable.
   *
   * METADATA IS EXTRACTED HERE, NOT LATER. `checkMediaAssetCapability` fails
   * closed when width and height are both null, so an asset stored without
   * metadata could never be published — it would upload successfully and then
   * be refused at schedule time with `media_metadata_incomplete`, which reads
   * to an operator as a bug. Extracting at upload means an unreadable file is
   * refused at the moment someone can still choose a different one.
   */
  async upload(
    scope: MediaAssetScope,
    actorUserId: string | null,
    input: UploadMediaAssetInput,
  ) {
    const file = input.file;

    if (!file?.buffer?.length) {
      throw new BadRequestException('Nenhum arquivo foi enviado.');
    }

    // 1. Validate before anything is created or written anywhere.
    assertMediaAssetSize(file.size ?? file.buffer.length);
    assertMediaAssetSize(file.buffer.length);
    const contentType = resolveMediaAssetContentType(
      file.buffer,
      file.mimetype,
    );

    // 2. Intrinsic properties, from the bytes. M2 throws a 400 for anything it
    //    cannot read; that refusal is deliberate and is not softened here into
    //    a stored row with null dimensions.
    const metadata = await this.metadataReader.extract({
      body: file.buffer,
      mimeType: contentType,
    });

    // 3. Server-controlled id and key. No part of the user's filename.
    const { assetId, objectKey } = buildMediaAssetObjectKey({
      tenantId: scope.tenantId,
      agencyClientId: scope.agencyClientId,
      assetId: randomUUID(),
      contentType,
    });

    // 4. Object first.
    await this.filesService.uploadPrivateBuffer({
      body: file.buffer,
      path: objectKey,
      contentType,
    });

    // 5. Row second, with cleanup if it fails.
    try {
      return await this.mediaAssets.save(
        this.mediaAssets.create({
          id: assetId,
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          agencyClientId: scope.agencyClientId,
          companyContextId: scope.companyContextId,
          storagePath: objectKey,
          mimeType: contentType,
          byteSize: String(file.buffer.length),
          originalFilename: sanitizeMediaAssetFilename(file.originalname),
          checksum: createHash('sha256').update(file.buffer).digest('hex'),
          width: metadata.width,
          height: metadata.height,
          durationMs:
            metadata.durationSeconds === null
              ? null
              : String(Math.round(metadata.durationSeconds * 1000)),
          codec: metadata.codec || null,
          source: input.source,
          metadata: input.metadata ?? {},
          createdById: actorUserId,
        }),
      );
    } catch (error) {
      await this.bestEffortRemoveObject(objectKey);
      throw error;
    }
  }

  /**
   * Lists the scope's assets, newest first.
   *
   * `mediaAssetScopeWhere` is the whole authorization here: tenant,
   * workspace, client AND company (CS3.1.1), each null matched with
   * `IsNull()`. A raw null would be read by TypeORM as "no filter on this
   * column" and would return every managed client's media to an
   * agency-context caller — the exact leak this repository has already paid
   * for once. Temporary assets never appear:
   * this listing is the publication media picker.
   */
  async list(scope: MediaAssetScope, query: { limit?: number } = {}) {
    const limit = Math.min(
      Math.max(query.limit ?? DEFAULT_LIST_LIMIT, 1),
      MAX_LIST_LIMIT,
    );

    const [items, total] = await this.mediaAssets.findAndCount({
      where: {
        ...mediaAssetScopeWhere(scope),
        source: durableMediaAssetSource(),
      },
      order: { createdAt: 'DESC' },
      take: limit,
    });

    return { items, total };
  }

  /**
   * Resolves one asset for reading its bytes.
   *
   * The scope filter IS the authorization: an asset belonging to another
   * tenant, to the agency while a client context is active, or to a different
   * client or company simply does not match and surfaces as 404 — the same answer as an
   * id that never existed, so this never confirms that someone else's asset
   * is real. A temporary asset answers the same 404: only its owner reads it,
   * through `getTemporaryContent`.
   */
  async getContent(scope: MediaAssetScope, mediaAssetId: string) {
    const asset = await this.mediaAssets.findOne({
      where: {
        id: mediaAssetId,
        ...mediaAssetScopeWhere(scope),
        source: durableMediaAssetSource(),
      },
    });

    if (!asset) {
      throw new NotFoundException('Media asset not found.');
    }

    const file = await this.filesService.getPrivateAsset(asset.storagePath);

    return { asset, file };
  }

  /**
   * Reads a temporary asset for the module that wrote it (CS3.1).
   *
   * `source` must be the exact temporary source the owner wrote, so one
   * owner's candidates are never readable through another's path. Scope is
   * the full four-part scope, Company Context included (CS3.1.1): a candidate
   * of Company B answers Company A with the same 404 as a missing row,
   * decided before any object is opened.
   */
  async getTemporaryContent(
    scope: MediaAssetScope,
    mediaAssetId: string,
    source: string,
  ) {
    if (!isTemporaryMediaAssetSource(source)) {
      throw new Error('getTemporaryContent requires a temporary source.');
    }

    const asset = await this.mediaAssets.findOne({
      where: { id: mediaAssetId, ...mediaAssetScopeWhere(scope), source },
    });

    if (!asset) {
      throw new NotFoundException('Media asset not found.');
    }

    const file = await this.filesService.getPrivateAsset(asset.storagePath);

    return { asset, file };
  }

  /**
   * Compensating action for a caller whose own transaction fails after a media
   * row was created. This is intentionally not a user-facing delete API: it
   * is only safe before the asset has been exposed or referenced elsewhere.
   */
  async removeAfterFailedConsumerOperation(
    scope: MediaAssetScope,
    mediaAssetId: string,
  ): Promise<void> {
    const asset = await this.mediaAssets.findOne({
      where: { id: mediaAssetId, ...mediaAssetScopeWhere(scope) },
    });
    if (!asset) return;
    await this.mediaAssets.remove(asset);
    await this.bestEffortRemoveObject(asset.storagePath);
  }

  /**
   * CS3.6.1 — last step of a temporary asset's lifecycle: object, then row.
   *
   * Only for a row its owning module already TOMBSTONED (`deleted_at`) after
   * proving it expired: from that commit on, no read path serves it (every
   * repository read skips tombstones) and no owner can attach to it, so the
   * binary can go without a reader seeing it disappear underneath.
   *
   * ORDER: object → row, never the reverse. A storage failure throws and
   * leaves the tombstone, which still knows the key, so the owner retries
   * later. A row delete that fails after the object is gone leaves an
   * invisible tombstone, and the retry converges: deleting a missing key
   * succeeds (S3 semantics; a backend answering 404 is treated the same).
   * Removing the row first would turn a failed storage call into an orphan
   * object nothing can ever find again.
   *
   * `false` when there was nothing to purge: never tombstoned, another
   * source, or already purged by a concurrent sweep.
   */
  async purgeTombstonedTemporary(
    mediaAssetId: string,
    source: string,
  ): Promise<boolean> {
    if (!isTemporaryMediaAssetSource(source)) {
      throw new Error('purgeTombstonedTemporary requires a temporary source.');
    }

    const asset = await this.mediaAssets.findOne({
      where: { id: mediaAssetId, source, deletedAt: Not(IsNull()) },
      withDeleted: true,
    });
    if (!asset) return false;

    try {
      await this.filesService.deleteObject({
        bucket: 'private',
        path: asset.storagePath,
      });
    } catch (error) {
      if (!isMissingObject(error)) throw error;
    }

    const removed = await this.mediaAssets.delete({
      id: mediaAssetId,
      source,
      deletedAt: Not(IsNull()),
    });
    return (removed.affected ?? 0) > 0;
  }

  /**
   * Rollback cleanup only. A failure here is swallowed on purpose: the caller
   * is already throwing the error that matters, and replacing it with a
   * storage error would hide why the upload actually failed.
   */
  private async bestEffortRemoveObject(objectKey: string): Promise<void> {
    try {
      await this.filesService.deleteObject({
        bucket: 'private',
        path: objectKey,
      });
    } catch {
      // Intentionally ignored — see docblock.
    }
  }
}

/** S3 deletes of a missing key succeed; some compatible backends answer 404 instead. */
function isMissingObject(error: unknown): boolean {
  const candidate = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  } | null;
  return (
    candidate?.$metadata?.httpStatusCode === 404 ||
    candidate?.name === 'NoSuchKey' ||
    candidate?.name === 'NotFound'
  );
}
