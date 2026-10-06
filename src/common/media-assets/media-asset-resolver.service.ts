import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { MediaAssetEntity } from './media-asset.entity';
import { durableMediaAssetSource } from './media-asset-retention';

/**
 * The full media scope. `companyContextId` is required (CS3.1.1): before it,
 * Company A and Company B of one client shared every media row. Callers pass
 * a scope resolved from RequestContext (`resolveCompanyAwareScope`) or, for
 * workers, from the owning row — never from a request body.
 */
export type MediaAssetScope = {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly agencyClientId: string | null;
  readonly companyContextId: string | null;
};

/**
 * Exact-match `where` for a scope. `IsNull()` rather than a raw null, which
 * TypeORM reads as "no filter" — the widening this repository has already
 * paid for (Approvals). `== null` on purpose: an `undefined` from an untyped
 * caller or a partial row is dropped by TypeORM just the same, so it must
 * narrow to NULL rather than widen to every company.
 */
export function mediaAssetScopeWhere(scope: MediaAssetScope) {
  return {
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    agencyClientId:
      scope.agencyClientId == null ? IsNull() : scope.agencyClientId,
    companyContextId:
      scope.companyContextId == null ? IsNull() : scope.companyContextId,
  };
}

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
 * Scope (`tenantId`, `workspaceId`, `agencyClientId`, `companyContextId`) is matched
 * exactly against the row — never widened. A `mediaAssetId` that exists but
 * belongs to a different tenant, workspace, agency client or company resolves the
 * same as one that does not exist at all (cross-context existence is never
 * revealed). `deletedAt` excludes tombstoned assets from every query here;
 * TypeORM's default repository behaviour already does this, but the intent
 * is spelled out because a caller cannot get around it. Temporary assets
 * (CS3.1, `media-asset-retention.ts`) are excluded the same way: nothing that
 * resolves through here — publication above all — may depend on a binary that
 * lifecycle cleanup is allowed to delete.
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
        ...mediaAssetScopeWhere(input),
        source: durableMediaAssetSource(),
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
