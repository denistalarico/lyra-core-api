import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { MediaAssetEntity } from './media-asset.entity';

export type MediaAssetScope = {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly agencyClientId: string | null;
};

export type ResolveMediaAssetInput = MediaAssetScope & {
  readonly mediaAssetId: string;
};

/** Internal-only resolved shape: `storagePath` must never leave this boundary. */
export type ResolvedMediaAsset = {
  readonly id: string;
  readonly storagePath: string;
  readonly mimeType: string;
  readonly byteSize: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly durationMs: string | null;
  readonly codec: string | null;
};

/**
 * The only place a `mediaAssetId` is turned into a storage location.
 *
 * Scope is a triple (`tenantId`, `workspaceId`, `agencyClientId`) matched
 * exactly against the row — never widened. A `mediaAssetId` that exists but
 * belongs to a different tenant, workspace or agency client resolves the
 * same as one that does not exist at all (cross-context existence is never
 * revealed). `deletedAt` excludes tombstoned assets from every query here;
 * TypeORM's default repository behaviour already does this, but the intent
 * is spelled out because a caller cannot get around it.
 */
@Injectable()
export class MediaAssetResolverService {
  constructor(
    @InjectRepository(MediaAssetEntity, 'agency')
    private readonly mediaAssetsRepository: Repository<MediaAssetEntity>,
  ) {}

  async resolve(input: ResolveMediaAssetInput): Promise<ResolvedMediaAsset> {
    const asset = await this.mediaAssetsRepository.findOne({
      where: {
        id: input.mediaAssetId,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        agencyClientId:
          input.agencyClientId === null ? IsNull() : input.agencyClientId,
      },
    });

    if (!asset) {
      throw new NotFoundException('Media asset not found.');
    }

    return {
      id: asset.id,
      storagePath: asset.storagePath,
      mimeType: asset.mimeType,
      byteSize: asset.byteSize,
      width: asset.width,
      height: asset.height,
      durationMs: asset.durationMs,
      codec: asset.codec,
    };
  }
}
