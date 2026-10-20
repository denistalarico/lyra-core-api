import { NotFoundException } from '@nestjs/common';
import type { RequestContext } from '../../common/context/request-context.interface';
import { CLIENT_AREA_ACTOR_ROLE } from '../client-area/client-area.types';

/** Guards run before Multer. The bridge proves the URL intent; after parsing, require the same intent. */
export function assertClientAreaMediaIntent(
  ctx: RequestContext,
  body: { conversationId?: string; channelId?: string; to?: string },
  conversationId?: string,
  channelId?: string,
  to?: string,
) {
  if (ctx.role !== CLIENT_AREA_ACTOR_ROLE) return;
  if (
    !conversationId ||
    !channelId ||
    !to ||
    body.conversationId !== conversationId ||
    body.channelId !== channelId ||
    body.to !== to
  )
    throw new NotFoundException('Resource is not available.');
}
