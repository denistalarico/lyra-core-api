import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { FilesService } from '../../../common/files/files.service';
import { InboxMediaAssetEntity } from '../entities/inbox-media-asset.entity';
import { InboxChannelEntity } from '../entities/inbox-channel.entity';

@Injectable()
export class InboxMediaService {
  constructor(
    @InjectRepository(InboxMediaAssetEntity, 'agency')
    private readonly mediaRepository: Repository<InboxMediaAssetEntity>,
    @InjectRepository(InboxChannelEntity, 'agency')
    private readonly channelsRepository: Repository<InboxChannelEntity>,
    private readonly filesService: FilesService,
  ) {}

  async getAuthorizedAsset(ctx: RequestContext, id: string) {
    if (!ctx.workspaceId) throw new NotFoundException('Media not found.');
    const asset = await this.mediaRepository.findOne({
      where: { id, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
    });
    if (!asset || asset.status !== 'available' || !asset.objectKey) {
      throw new NotFoundException('Media not found or not available.');
    }
    const channel = await this.channelsRepository.findOne({
      where: {
        id: asset.channelId,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
    });
    const clientId =
      typeof channel?.metadata?.clientId === 'string'
        ? channel.metadata.clientId
        : null;
    const allowed =
      ctx.managedContext?.operatingMode === 'client'
        ? clientId === ctx.managedContext.clientId
        : !clientId || channel?.metadata?.operatingMode === 'agency';
    if (!channel || !allowed) throw new NotFoundException('Media not found.');
    return {
      asset,
      file: await this.filesService.getPrivateAsset(asset.objectKey),
    };
  }
}
