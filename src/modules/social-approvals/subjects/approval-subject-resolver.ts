import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { CompanyAwareScope } from '../../../common/context/company-aware-scope';
import {
  CreativeAssetEntity,
  CreativeAssetVersionEntity,
} from '../../social-creative-studio/entities';
import {
  SocialContentItemEntity,
  SocialContentRevisionEntity,
  SocialPlanEntity,
} from '../../social-planner/entities';

export type ResolvedApprovalSubject = {
  subjectType: 'creative_version' | 'planner_content_revision';
  subjectId: string;
  subjectRevisionId: string;
  sourceModule: 'creative_studio' | 'social_planner';
  displayType: 'creative' | 'content_revision';
  title: string;
  subjectVersionLabel: string;
};

/** Only resolver-owned, revision-specific fields leave this boundary. */
export type ApprovalSubjectPreview = {
  subjectType: ResolvedApprovalSubject['subjectType'];
  title: string;
  versionLabel: string;
  format: 'media' | 'text';
  text?: {
    copy: string | null;
    caption: string | null;
    script: string | null;
    cta: string | null;
    hashtags: string[];
    firstComment: string | null;
  };
  media?: {
    assetType: 'image' | 'video';
    contentPath: string;
    thumbnailPath: string | null;
  };
};

/** A narrow registry boundary: AP1 validates one immutable pilot, not ten repositories. */
@Injectable()
export class ApprovalSubjectResolver {
  constructor(
    @InjectRepository(CreativeAssetEntity, 'agency')
    private readonly assets: Repository<CreativeAssetEntity>,
    @InjectRepository(CreativeAssetVersionEntity, 'agency')
    private readonly versions: Repository<CreativeAssetVersionEntity>,
    @InjectRepository(SocialPlanEntity, 'agency')
    private readonly plans: Repository<SocialPlanEntity>,
    @InjectRepository(SocialContentItemEntity, 'agency')
    private readonly contentItems: Repository<SocialContentItemEntity>,
    @InjectRepository(SocialContentRevisionEntity, 'agency')
    private readonly contentRevisions: Repository<SocialContentRevisionEntity>,
  ) {}
  async resolve(
    scope: CompanyAwareScope,
    input: {
      subjectType: string;
      subjectId: string;
      subjectRevisionId: string;
    },
  ): Promise<ResolvedApprovalSubject> {
    if (input.subjectType === 'creative_version')
      return this.resolveCreativeVersion(scope, input);
    if (input.subjectType === 'planner_content_revision')
      return this.resolvePlannerContentRevision(scope, input);
    throw new BadRequestException(
      'Tipo de aprovação não suportado nesta fase.',
    );
  }

  async getPreview(
    scope: CompanyAwareScope,
    input: Pick<ResolvedApprovalSubject, 'subjectType' | 'subjectId' | 'subjectRevisionId'> & {
      title?: string;
      subjectVersionLabel?: string;
    },
  ): Promise<ApprovalSubjectPreview> {
    const subject = await this.resolve(scope, input);
    if (subject.subjectType === 'creative_version') {
      const asset = await this.assets.findOneOrFail({
        where: {
          id: subject.subjectId,
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          agencyClientId: scope.agencyClientId!,
          companyContextId: scope.companyContextId!,
        },
      });
      const version = await this.versions.findOneOrFail({
        where: { id: subject.subjectRevisionId, creativeAssetId: asset.id },
      });
      const versionQuery = `?versionId=${encodeURIComponent(version.id)}`;
      return {
        subjectType: subject.subjectType,
        title: input.title ?? subject.title,
        versionLabel: input.subjectVersionLabel ?? subject.subjectVersionLabel,
        format: 'media',
        media: {
          assetType: asset.assetType,
          contentPath: `/social/creative-studio/assets/${asset.id}/content${versionQuery}`,
          thumbnailPath: version.thumbnailMediaAssetId
            ? `/social/creative-studio/assets/${asset.id}/thumbnail${versionQuery}`
            : null,
        },
      };
    }
    const revision = await this.contentRevisions.findOneOrFail({
      where: {
        id: subject.subjectRevisionId,
        contentItemId: subject.subjectId,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId!,
      },
    });
    return {
      subjectType: subject.subjectType,
      title: input.title ?? subject.title,
      versionLabel: input.subjectVersionLabel ?? subject.subjectVersionLabel,
      format: 'text',
      text: {
        copy: revision.copy,
        caption: revision.caption,
        script: revision.script,
        cta: revision.cta,
        hashtags: revision.hashtags,
        firstComment: revision.firstComment,
      },
    };
  }

  private async resolveCreativeVersion(
    scope: CompanyAwareScope,
    input: { subjectId: string; subjectRevisionId: string },
  ): Promise<ResolvedApprovalSubject> {
    const asset = await this.assets.findOne({
      where: {
        id: input.subjectId,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId!,
        companyContextId: scope.companyContextId!,
      },
    });
    if (!asset)
      throw new NotFoundException('Criativo não encontrado no contexto atual.');
    const version = await this.versions.findOne({
      where: { id: input.subjectRevisionId, creativeAssetId: asset.id },
    });
    if (!version)
      throw new BadRequestException(
        'A revisão informada não pertence ao criativo ou não existe.',
      );
    return {
      subjectType: 'creative_version',
      subjectId: asset.id,
      subjectRevisionId: version.id,
      sourceModule: 'creative_studio',
      displayType: 'creative',
      title: asset.name,
      subjectVersionLabel: `v${version.versionNumber}`,
    };
  }
  private async resolvePlannerContentRevision(
    scope: CompanyAwareScope,
    input: { subjectId: string; subjectRevisionId: string },
  ): Promise<ResolvedApprovalSubject> {
    const item = await this.contentItems.findOne({
      where: {
        id: input.subjectId,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId!,
      },
    });
    if (!item)
      throw new NotFoundException('Conteúdo do Planner não encontrado no contexto atual.');
    const plan = await this.plans.findOne({
      where: {
        id: item.planId,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId!,
        companyContextId: scope.companyContextId!,
      },
    });
    if (!plan)
      throw new NotFoundException('Conteúdo do Planner não encontrado no contexto atual.');
    const revision = await this.contentRevisions.findOne({
      where: {
        id: input.subjectRevisionId,
        contentItemId: item.id,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId!,
      },
    });
    if (!revision)
      throw new BadRequestException(
        'A revisão informada não pertence ao conteúdo ou não existe.',
      );
    return {
      subjectType: 'planner_content_revision',
      subjectId: item.id,
      subjectRevisionId: revision.id,
      sourceModule: 'social_planner',
      displayType: 'content_revision',
      title: item.title,
      subjectVersionLabel: `r${revision.revisionNumber}`,
    };
  }
}
