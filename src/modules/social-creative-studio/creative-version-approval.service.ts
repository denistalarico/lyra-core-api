import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CompanyContextRequiredException } from '../../common/context/company-aware-scope';
import { SocialApprovalsService } from '../social-approvals/social-approvals.service';
import { SocialContentProductionStatusService } from '../social-planner/services/social-content-production-status.service';
import { CreativeAssetEntity, CreativeAssetVersionEntity } from './entities';
import { CreativeAssetService } from './creative-asset.service';
import type { CreativeStudioScope } from './creative-studio.scope';
import type { CreativeVersionApprovalResponse } from './dto/creative-version-approval.dto';

/**
 * CS2B.2 — the Creative Studio owner-domain entry point into Approvals.
 *
 * The Studio owns the asset and its immutable versions; Approvals owns the
 * workflow. This service proves that the explicitly chosen version belongs
 * to an asset in the authorized Company Context, then delegates creation or
 * read-only state projection (CS2B.3) to Approvals. Status, supersede, the
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
    private readonly plannerStatus: SocialContentProductionStatusService,
    private readonly assetVersions: CreativeAssetService,
  ) {}

  async sendForApproval(
    scope: CreativeStudioScope,
    actorUserId: string | null | undefined,
    assetId: string,
    versionId: string,
  ) {
    const { asset, version } = await this.resolveVersion(
      scope,
      assetId,
      versionId,
    );
    const request = await this.approvals.create(scope, actorUserId, {
      subjectType: 'creative_version',
      subjectId: asset.id,
      subjectRevisionId: version.id,
    });
    // CS2B.4: handing a version to Approvals is where production ends for the
    // Planner (`creative_ready`, "Em aprovação"). Only the hand-off is
    // reflected; later Approval statuses never reach `planningStatus`.
    // Approvals commits in its own transaction, so this runs after it.
    if (asset.contentItemId)
      await this.plannerStatus.reflectCreativeStatus(scope, {
        contentItemId: asset.contentItemId,
        status: 'creative_ready',
        actorUserId: actorUserId ?? null,
      });
    return request;
  }

  /**
   * CS2B.6 — revision loop. The client asked for changes on `versionId`; the
   * agency answers with a new immutable version of the same asset.
   *
   * Approvals is the evidence: only a version whose request is currently
   * `changes_requested` can be revised. Nothing in Approvals changes here —
   * the old request keeps pointing at the old version and is superseded by
   * Approvals itself when the new version is sent for approval
   * (`sendForApproval` → `SocialApprovalsService.create`). Production of the
   * version and its hand-off to approval stay separate operator actions.
   */
  async startRevision(
    scope: CreativeStudioScope,
    actorUserId: string | null | undefined,
    assetId: string,
    versionId: string,
    file: Parameters<CreativeAssetService['createVersion']>[3],
  ) {
    const { asset, version } = await this.resolveVersion(
      scope,
      assetId,
      versionId,
    );
    const approval = await this.approvals.findStateForSubjectRevision(scope, {
      subjectType: 'creative_version',
      subjectId: asset.id,
      subjectRevisionId: version.id,
    });
    if (approval?.status !== 'changes_requested')
      throw new ConflictException({
        code: 'revision_requires_changes_requested',
        message:
          'Só é possível criar uma revisão para uma versão com alterações solicitadas.',
      });
    return this.assetVersions.createVersion(
      scope,
      actorUserId ?? null,
      asset.id,
      file,
      { revisesVersionId: version.id },
    );
  }

  async approvalForVersion(
    scope: CreativeStudioScope,
    assetId: string,
    versionId: string,
  ): Promise<CreativeVersionApprovalResponse> {
    const { asset, version } = await this.resolveVersion(
      scope,
      assetId,
      versionId,
    );
    const approval = await this.approvals.findStateForSubjectRevision(scope, {
      subjectType: 'creative_version',
      subjectId: asset.id,
      subjectRevisionId: version.id,
    });
    return { approval };
  }

  private async resolveVersion(
    scope: CreativeStudioScope,
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
      select: { id: true, contentItemId: true },
    });
    if (!asset) throw new NotFoundException('Criativo não encontrado.');
    // A version id alone never authorizes: it must belong to the scoped asset.
    const version = await this.versions.findOne({
      where: { id: versionId, creativeAssetId: asset.id },
      select: { id: true },
    });
    if (!version) throw new NotFoundException('Versão não encontrada.');
    return { asset, version };
  }
}
