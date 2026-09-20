import { BadRequestException } from '@nestjs/common';
import type { RequestContext } from '../../common/context/request-context.interface';
import type { MediaAssetScope } from '../../common/media-assets';

export function creativeStudioScope(ctx: RequestContext): MediaAssetScope {
  if (!ctx.tenantId || !ctx.workspaceId) throw new BadRequestException('Tenant and workspace context are required.');
  const agencyClientId = ctx.managedContext?.operatingMode === 'client' ? (ctx.managedContext.clientId ?? null) : null;
  if (ctx.managedContext?.operatingMode === 'client' && !agencyClientId) throw new BadRequestException('Client context is required.');
  return { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, agencyClientId };
}
