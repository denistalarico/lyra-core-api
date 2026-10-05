import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CompanyContextRequiredException } from '../../common/context/company-aware-scope';
import { SocialApprovalsService } from '../social-approvals/social-approvals.service';
import { CreativeAssetEntity, CreativeAssetVersionEntity } from './entities';
import type { CreativeStudioScope } from './creative-studio.scope';

/**
 * CS2B.2 — the Creative Studio owner-domain entry point into Approvals.
 *
 * The Studio owns the asset and its immutable versions; Approvals owns the
 * workflow. This service only proves that the explicitly chosen version
 * belongs to an asset in the authorized Company Context, then hands its
 * identity to `SocialApprovalsService.create()`. Status, supersede, the
 * advisory lock and active-request uniqueness all stay in that domain.
 */
@Injectable()
export class CreativeVersionApprovalService {
  constructor(
    @InjectRepository(CreativeAssetEntity, 'agency')
    private readonly assets: Repository<CreativeAssetEntity>,
    @InjectRepository(CreativeAssetVersionEntity, 'agency')
    private readonly versions: Repository<CreativeAssetVersionEntity>,
    private readonly approvals: SocialApprovalsService,
  ) {}

  async sendForApproval(
    scope: CreativeStudioScope,
    actorUserId: string | null | undefined,
    assetId: string,
    versionId: string,
  ) {
    // Domain rule, not a workaround: an approval request always belongs to a
    // Company Context (`CK_social_approval_requests_scope`), and
    // `SocialApprovalsService.create()` enforces the same. Rejecting here
    // keeps agency scope from running any Studio lookup for a request that
    // can never exist.
    if (!scope.agencyClientId || !scope.companyContextId)
      throw new CompanyContextRequiredException();
    const asset = await this.assets.findOne({
      where: {
        id: assetId,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId,
        companyContextId: scope.companyContextId,
      },
      select: { id: true },
    });
    if (!asset) throw new NotFoundException('Criativo não encontrado.');
    // A version id alone never authorizes: it must belong to the scoped asset.
    const version = await this.versions.findOne({
      where: { id: versionId, creativeAssetId: asset.id },
      select: { id: true },
    });
    if (!version) throw new NotFoundException('Versão não encontrada.');
    return this.approvals.create(scope, actorUserId, {
      subjectType: 'creative_version',
      subjectId: asset.id,
      subjectRevisionId: version.id,
    });
  }
}
