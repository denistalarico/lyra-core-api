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

export type ResolvedApprovalSubject = {
  subjectType: 'creative_version';
  subjectId: string;
  subjectRevisionId: string;
  sourceModule: 'creative_studio';
  displayType: 'creative';
  title: string;
  subjectVersionLabel: string;
};

/** A narrow registry boundary: AP1 validates one immutable pilot, not ten repositories. */
@Injectable()
export class ApprovalSubjectResolver {
  constructor(
    @InjectRepository(CreativeAssetEntity, 'agency')
    private readonly assets: Repository<CreativeAssetEntity>,
    @InjectRepository(CreativeAssetVersionEntity, 'agency')
    private readonly versions: Repository<CreativeAssetVersionEntity>,
  ) {}
  async resolve(
    scope: CompanyAwareScope,
    input: {
      subjectType: string;
      subjectId: string;
      subjectRevisionId: string;
    },
  ): Promise<ResolvedApprovalSubject> {
    if (input.subjectType !== 'creative_version')
      throw new BadRequestException(
        'Tipo de aprovação não suportado nesta fase.',
      );
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
}
