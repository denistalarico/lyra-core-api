import { resolveCompanyAwareScope } from '../../common/context/company-aware-scope';
import type { RequestContext } from '../../common/context/request-context.interface';
import type { MediaAssetScope } from '../../common/media-assets';

export type CreativeStudioScope = MediaAssetScope & {
  companyContextId: string | null;
};

export function creativeStudioScope(ctx: RequestContext): CreativeStudioScope {
  return resolveCompanyAwareScope(ctx);
}
