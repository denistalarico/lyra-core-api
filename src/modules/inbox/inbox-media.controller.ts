import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  RequireAnyPermission,
  RequireProductEntitlement,
} from '../permissions';
import { InboxMediaService } from './services/inbox-media.service';

@Controller('inbox/media')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('leadflow')
export class InboxMediaController {
  constructor(private readonly mediaService: InboxMediaService) {}

  @Get(':mediaId/content')
  @RequireAnyPermission(
    'leadflow.inbox.conversation.view.assigned',
    'leadflow.inbox.conversation.view.client',
    'leadflow.inbox.conversation.view.all',
  )
  async content(
    @RequestContextData() ctx: RequestContext,
    @Param('mediaId') mediaId: string,
    @Res() response: Response,
  ) {
    const { file } = await this.mediaService.getAuthorizedAsset(ctx, mediaId);
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    file.body.pipe(response);
  }
}
