import { Injectable, NotFoundException } from '@nestjs/common';
import type { CompanyAwareScope } from '../../common/context/company-aware-scope';
import { FilesService } from '../../common/files/files.service';
import { MediaAssetResolverService } from '../../common/media-assets/media-asset-resolver.service';
import type {
  ApprovalFileSnapshotPayload,
  ApprovalMediaSetSnapshotPayload,
} from './entities';
import { APPROVAL_SNAPSHOT_MEDIA_SLOT } from './approval-snapshot-media-ref';
import { SocialApprovalPiecesService } from './social-approval-pieces.service';

/**
 * Turns a snapshot slot into bytes (F-02, D-29). The slot is enumerable and
 * resolved against the snapshot row in the caller's full scope, so there is
 * no id or storage key a request could tamper with.
 */
@Injectable()
export class SocialApprovalMediaService {
  constructor(
    private readonly pieces: SocialApprovalPiecesService,
    private readonly media: MediaAssetResolverService,
    private readonly files: FilesService,
  ) {}

  private async locate(
    scope: CompanyAwareScope,
    snapshotId: string,
    ref: string,
    stepId?: string,
  ): Promise<{ storagePath: string; mimeType: string }> {
    const match = APPROVAL_SNAPSHOT_MEDIA_SLOT.exec(ref);
    if (!match) throw new NotFoundException('Mídia não encontrada.');
    const snapshot = await this.pieces.snapshotForMedia(scope, {
      snapshotId,
      stepId,
    });

    if (ref === 'file') {
      if (snapshot.kind !== 'file')
        throw new NotFoundException('Mídia não encontrada.');
      const file = snapshot.payload as ApprovalFileSnapshotPayload;
      return { storagePath: file.storagePath, mimeType: file.mimeType };
    }
    if (snapshot.kind !== 'media_set')
      throw new NotFoundException('Mídia não encontrada.');
    const item = (snapshot.payload as ApprovalMediaSetSnapshotPayload).items[
      Number(match[1])
    ];
    const mediaAssetId = match[2]
      ? item?.thumbnailMediaAssetId
      : item?.mediaAssetId;
    if (!mediaAssetId) throw new NotFoundException('Mídia não encontrada.');
    const resolved = await this.media.resolve({ ...scope, mediaAssetId });
    return { storagePath: resolved.storagePath, mimeType: resolved.mimeType };
  }

  async open(
    scope: CompanyAwareScope,
    snapshotId: string,
    ref: string,
    stepId?: string,
  ) {
    const location = await this.locate(scope, snapshotId, ref, stepId);
    return {
      file: await this.files.getPrivateAsset(location.storagePath),
      mimeType: location.mimeType,
    };
  }
}
