import { BrandKitController } from '../brand-kit/brand-kit.controller';
/**
 * CA10 — reflective inventory of the Social controllers, for the route
 * table/decorator parity spec and the HTTP matrix. Test support only: the
 * application never imports it.
 */
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { CLIENT_AREA_EXPOSED_METADATA } from '../../common/client-area-bridge/client-area-bridge.registry';
import { MediaAssetController } from '../../common/media-assets/media-asset.controller';
import type { ClientAreaModuleKey } from '../client-area/client-area.types';
import {
  ANY_PERMISSION_KEYS_METADATA,
  PERMISSION_KEY_METADATA,
} from '../permissions/decorators/permissions.decorators';
import { SocialCampaignsController } from '../social-campaigns/social-campaigns.controller';
import {
  CreativeImageGenerationController,
  CreativeVersionVariationController,
} from '../social-creative-studio/creative-image-generation.controller';
import { CreativeProductionController } from '../social-creative-studio/creative-production.controller';
import { CreativeStudioController } from '../social-creative-studio/creative-studio.controller';
import { CreativeVersionApprovalController } from '../social-creative-studio/creative-version-approval.controller';
import { CreativeCostController } from '../social-creative-studio/creative-cost.controller';
import {
  CreativeVideoAvatarController,
  CreativeVideoGenerationController,
} from '../social-creative-studio/creative-video-generation.controller';
import { SocialAnalyticsController } from '../social-integrations/social-analytics.controller';
import { DestinationCreativeController } from '../social-organic/publication/destination-creative.controller';
import { SocialPublicationController } from '../social-organic/publication/social-publication.controller';
import { SocialContentReferenceController } from '../social-planner/social-content-reference.controller';
import { SocialPlannerController } from '../social-planner/social-planner.controller';

export const SOCIAL_CLIENT_AREA_CONTROLLERS = [
  BrandKitController,
  SocialPlannerController,
  SocialContentReferenceController,
  DestinationCreativeController,
  SocialPublicationController,
  MediaAssetController,
  CreativeStudioController,
  CreativeImageGenerationController,
  CreativeVersionVariationController,
  CreativeVideoGenerationController,
  CreativeVideoAvatarController,
  CreativeProductionController,
  CreativeVersionApprovalController,
  CreativeCostController,
  SocialCampaignsController,
  SocialAnalyticsController,
];

const VERBS: Partial<Record<RequestMethod, string>> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.DELETE]: 'DELETE',
};

export type SocialExposedRoute = {
  key: string;
  verb: string;
  path: string;
  module: ClientAreaModuleKey;
  permissions: string[];
  handler: string;
};

/** Every Social handler as Nest sees it, opted in or not. */
export function socialRoutes(): (SocialExposedRoute & { exposed: boolean })[] {
  return SOCIAL_CLIENT_AREA_CONTROLLERS.flatMap((controller) =>
    Object.getOwnPropertyNames(controller.prototype).flatMap((name) => {
      const handler = Reflect.get(controller.prototype, name) as object;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as
        | RequestMethod
        | undefined;
      if (name === 'constructor' || method === undefined) return [];
      const base = Reflect.getMetadata(PATH_METADATA, controller) as string;
      const own = Reflect.getMetadata(PATH_METADATA, handler) as string;
      const path = `/${base}/${own === '/' ? '' : own}`
        .replace(/\/+/g, '/')
        .replace(/\/$/, '');
      const verb = VERBS[method]!;
      const module = Reflect.getMetadata(
        CLIENT_AREA_EXPOSED_METADATA,
        handler,
      ) as ClientAreaModuleKey | undefined;
      const required =
        (Reflect.getMetadata(PERMISSION_KEY_METADATA, handler) as
          | string
          | undefined) ??
        (Reflect.getMetadata(PERMISSION_KEY_METADATA, controller) as
          | string
          | undefined);
      const any =
        (Reflect.getMetadata(ANY_PERMISSION_KEYS_METADATA, handler) as
          | string[]
          | undefined) ?? [];
      return [
        {
          key: `${verb} ${path}`,
          verb,
          path,
          module: module!,
          permissions: [...(required ? [required] : []), ...any],
          handler: `${controller.name}.${name}`,
          exposed: module !== undefined,
        },
      ];
    }),
  );
}
