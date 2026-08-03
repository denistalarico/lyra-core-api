import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { FilesService } from '../../../common/files/files.service';
import { LeadFlowBriefingSourceVersionEntity } from '../entities';

const AGENCY_CONNECTION = 'agency';

export type BriefingVersionContent =
  | { kind: 'object'; file: Awaited<ReturnType<FilesService['getPrivateAsset']>> }
  | { kind: 'text'; text: string; mimeType: string };

/**
 * Serves a source version's original content back to an authorized human
 * reviewer — tenant+workspace+source scoped, mirroring
 * InboxMediaService.getAuthorizedAsset. Text-pasted sources (no objectKey)
 * return their rawText directly instead of hitting object storage.
 */
@Injectable()
export class LeadFlowBriefingContentService {
  constructor(
    @InjectRepository(LeadFlowBriefingSourceVersionEntity, AGENCY_CONNECTION)
    private readonly versionRepository: Repository<LeadFlowBriefingSourceVersionEntity>,
    private readonly filesService: FilesService,
  ) {}

  async getAuthorizedVersionContent(
    ctx: RequestContext,
    sourceId: string,
    versionId: string,
  ): Promise<BriefingVersionContent> {
    if (!ctx.workspaceId) {
      throw new BadRequestException('Workspace context is required.');
    }

    const version = await this.versionRepository.findOne({
      where: {
        id: versionId,
        sourceId,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
    });
    if (!version) {
      throw new NotFoundException('Briefing source version not found.');
    }

    if (version.objectKey) {
      return { kind: 'object', file: await this.filesService.getPrivateAsset(version.objectKey) };
    }
    if (version.rawText != null) {
      return { kind: 'text', text: version.rawText, mimeType: version.mimeType ?? 'text/plain' };
    }
    throw new NotFoundException('Briefing source version has no content yet.');
  }
}
