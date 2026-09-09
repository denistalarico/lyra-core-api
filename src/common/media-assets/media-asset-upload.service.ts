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
import { IsNull, Repository } from 'typeorm';
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
import type { MediaAssetScope } from './media-asset-resolver.service';

export type UploadMediaAssetInput = {
  readonly file: {
    readonly buffer: Buffer;
    readonly originalname: string;
    readonly mimetype?: string;
    readonly size?: number;
  };
  readonly source: string;
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
          metadata: {},
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
   * `agencyClientId ?? IsNull()` is the whole authorization here. A raw null
   * would be read by TypeORM as "no filter on this column" and would return
   * every managed client's media to an agency-context caller — the exact leak
   * this repository has already paid for once.
   */
  async list(scope: MediaAssetScope, query: { limit?: number } = {}) {
    const limit = Math.min(
      Math.max(query.limit ?? DEFAULT_LIST_LIMIT, 1),
      MAX_LIST_LIMIT,
    );

    const [items, total] = await this.mediaAssets.findAndCount({
      where: {
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId:
          scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
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
   * client simply does not match and surfaces as 404 — the same answer as an
   * id that never existed, so this never confirms that someone else's asset
   * is real.
   */
  async getContent(scope: MediaAssetScope, mediaAssetId: string) {
    const asset = await this.mediaAssets.findOne({
      where: {
        id: mediaAssetId,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId:
          scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
      },
    });

    if (!asset) {
      throw new NotFoundException('Media asset not found.');
    }

    const file = await this.filesService.getPrivateAsset(asset.storagePath);

    return { asset, file };
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
