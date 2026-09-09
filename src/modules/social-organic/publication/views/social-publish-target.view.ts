// src/modules/social-organic/publication/views/social-publish-target.view.ts
//
// The composer's projection of a connected account (Social Planner E3).
//
// Reuses `maskOrganicExternalAssetId` rather than exposing the raw external
// id: the connections surface already decided that a provider's account id is
// masked before it reaches a client, and a second endpoint returning the same
// id unmasked would quietly undo that decision.
//
// `assetTimezone` IS included and is not defaulted. A composer that schedules
// "10:00" needs to know whose 10:00 that is, and a silent UTC default is how a
// post ends up published three hours early. Null here means the account never
// reported one — the UI must ask rather than assume.

import type { SocialOrganicAssetEntity } from '../../entities';
import { maskOrganicExternalAssetId } from '../../connections/views/social-organic-connection.view';

export type SocialPublishTargetView = {
  id: string;
  provider: string;
  assetType: string;
  maskedExternalAssetId: string;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  assetTimezone: string | null;
};

export function toSocialPublishTargetView(
  asset: SocialOrganicAssetEntity,
): SocialPublishTargetView {
  return {
    id: asset.id,
    provider: asset.provider,
    assetType: asset.assetType,
    maskedExternalAssetId: maskOrganicExternalAssetId(asset.externalAssetId),
    displayName: asset.displayName,
    username: asset.username,
    avatarUrl: asset.avatarUrl,
    assetTimezone: asset.assetTimezone,
  };
}
