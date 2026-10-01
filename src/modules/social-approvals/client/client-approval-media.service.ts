import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { CompanyAwareScope } from '../../../common/context/company-aware-scope';
import {
  MediaAssetResolverService,
  type ResolvedMediaAsset,
} from '../../../common/media-assets/media-asset-resolver.service';
import {
  CreativeAssetEntity,
  CreativeAssetVersionEntity,
} from '../../social-creative-studio/entities';
import { ClientApprovalsService } from './client-approvals.service';
import {
  isClientApprovalMediaRef,
  type ClientApprovalMediaRef,
} from './client-approval.view';

const AGENCY_CONNECTION = 'agency';

/**
 * AP3 — the Client Area media boundary (§26–§28).
 *
 * WHY A REF AND NOT AN ID
 * -----------------------
 * The client is never given an asset id, a version id or a storage key, so
 * there is nothing for a client to tamper with: the request says only *which
 * approval* and *which slot of that approval's revision* ("content" or
 * "thumbnail"). Everything else is derived server-side. A storage key supplied
 * by a caller is not merely rejected — it has nowhere to enter.
 *
 * THE CHAIN, IN ORDER, ALL FAIL-CLOSED
 * ------------------------------------
 *   1. ClientAreaContext            (guards, before this service is reached)
 *   2. approval visible to company  `findVisible` — scope tuple + sent phase
 *   3. revision belongs to approval `approval.subjectRevisionId`, not a param
 *   4. media belongs to revision    the version row's own media asset column
 *   5. asset in scope               `MediaAssetResolverService` re-checks
 *
 * Step 3 is what makes "media of approval B requested through approval A"
 * impossible: the revision is read off the approval row that step 2 already
 * proved visible, so a caller cannot name one.
 *
 * NO URL IS RETURNED
 * ------------------
 * Bytes are streamed by the controller through the private-asset reader. No
 * bucket, MinIO host, storage key or signed URL is ever produced, so there is
 * no expiry to tune and no link that outlives the session that fetched it.
 */
@Injectable()
export class ClientApprovalMediaService {
  constructor(
    @InjectRepository(CreativeAssetEntity, AGENCY_CONNECTION)
    private readonly assets: Repository<CreativeAssetEntity>,
    @InjectRepository(CreativeAssetVersionEntity, AGENCY_CONNECTION)
    private readonly versions: Repository<CreativeAssetVersionEntity>,
    private readonly approvals: ClientApprovalsService,
    private readonly media: MediaAssetResolverService,
  ) {}

  async resolve(
    scope: CompanyAwareScope,
    approvalId: string,
    mediaRef: string,
  ): Promise<ResolvedMediaAsset> {
    if (!isClientApprovalMediaRef(mediaRef)) {
      throw new NotFoundException('Mídia não encontrada.');
    }

    // Step 2: proves company scope *and* that the approval reached the client.
    const approval = await this.approvals.findVisible(scope, approvalId);

    if (approval.subjectType !== 'creative_version') {
      // A text revision has no media slot; asking for one is not an error
      // worth distinguishing from a missing file.
      throw new NotFoundException('Mídia não encontrada.');
    }

    const asset = await this.assets.findOne({
      where: {
        id: approval.subjectId,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId!,
        companyContextId: scope.companyContextId!,
      },
    });
    if (!asset) throw new NotFoundException('Mídia não encontrada.');

    // Step 3/4: the revision comes from the approval, and the media id comes
    // from that revision's own row — never from the request.
    const version = await this.versions.findOne({
      where: {
        id: approval.subjectRevisionId,
        creativeAssetId: asset.id,
      },
    });
    if (!version) throw new NotFoundException('Mídia não encontrada.');

    const mediaAssetId = this.mediaAssetIdFor(version, mediaRef);
    if (!mediaAssetId) throw new NotFoundException('Mídia não encontrada.');

    // Step 5: the resolver matches the scope triple again and answers the
    // same way for "missing" and "belongs to someone else".
    return this.media.resolve({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId!,
      mediaAssetId,
    });
  }

  private mediaAssetIdFor(
    version: CreativeAssetVersionEntity,
    mediaRef: ClientApprovalMediaRef,
  ): string | null {
    return mediaRef === 'thumbnail'
      ? version.thumbnailMediaAssetId
      : version.mediaAssetId;
  }
}
