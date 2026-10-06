import { resolveCompanyAwareScope } from '../../common/context/company-aware-scope';
import type { RequestContext } from '../../common/context/request-context.interface';
import type { MediaAssetScope } from '../../common/media-assets';

/** Since CS3.1.1 the media scope already carries Company Context. */
export type CreativeStudioScope = MediaAssetScope;

export function creativeStudioScope(ctx: RequestContext): CreativeStudioScope {
  return resolveCompanyAwareScope(ctx);
}
