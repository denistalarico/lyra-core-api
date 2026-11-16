import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  BadGatewayException,
  ForbiddenException,
} from '@nestjs/common';
import {
  SocialOrganicCredentialError,
  SocialOrganicCredentialResolver,
} from '../../credentials';
import type { SocialOrganicConnectionScope } from '../../connections/social-organic-connection.service';
import { TiktokApiClient, TiktokApiError } from './tiktok-api.client';
import { TIKTOK_PROVIDER } from './tiktok-capabilities';
import {
  TIKTOK_CLIENT_AUDITED,
  TIKTOK_UNAUDITED_PRIVACY_LEVEL,
} from './tiktok-publisher.adapter';

export type TiktokCreatorInfoView = {
  assetId: string;
  creator: {
    username: string | null;
    nickname: string | null;
    avatarUrl: string | null;
  };
  /** Exactly what TikTok returned; the user picks among these (D-I10). */
  privacyLevelOptions: string[];
  /** Subset of the options Lyra accepts today (private-only until audit). */
  allowedPrivacyLevels: string[];
  clientAudited: boolean;
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSec: number | null;
};

/**
 * `creator_info/query` for the FE screen TikTok requires before a post. Live,
 * never cached, agency-only. The token never leaves the credential resolver.
 */
@Injectable()
export class TiktokCreatorInfoService {
  constructor(
    private readonly credentials: SocialOrganicCredentialResolver,
    private readonly api: TiktokApiClient,
  ) {}

  async read(
    input: SocialOrganicConnectionScope & { assetId: string },
  ): Promise<TiktokCreatorInfoView> {
    try {
      const credential = await this.credentials.resolve({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        agencyClientId: input.agencyClientId,
        companyContextId: input.companyContextId ?? null,
        assetId: input.assetId,
      });
      if (credential.provider !== TIKTOK_PROVIDER) {
        throw new NotFoundException('asset_not_found');
      }
      const info = await this.api.creatorInfo(credential.accessToken);
      return {
        assetId: input.assetId,
        creator: {
          username: info.username,
          nickname: info.nickname,
          avatarUrl: info.avatarUrl,
        },
        privacyLevelOptions: info.privacyLevelOptions,
        allowedPrivacyLevels: TIKTOK_CLIENT_AUDITED
          ? info.privacyLevelOptions
          : info.privacyLevelOptions.filter(
              (level) => level === TIKTOK_UNAUDITED_PRIVACY_LEVEL,
            ),
        clientAudited: TIKTOK_CLIENT_AUDITED,
        commentDisabled: info.commentDisabled,
        duetDisabled: info.duetDisabled,
        stitchDisabled: info.stitchDisabled,
        maxVideoPostDurationSec: info.maxVideoPostDurationSec,
      };
    } catch (error) {
      if (error instanceof SocialOrganicCredentialError) {
        switch (error.code) {
          case 'asset_not_found':
            throw new NotFoundException('asset_not_found');
          case 'credential_expired':
          case 'credential_removed':
            throw new ConflictException('reauth_required');
          case 'credential_refresh_failed':
            throw new ServiceUnavailableException('refresh_failed');
          default:
            throw new ConflictException(error.code);
        }
      }
      if (error instanceof TiktokApiError) {
        if (error.status === 401)
          throw new ConflictException('reauth_required');
        if (error.status === 403)
          throw new ForbiddenException('permission_denied');
        if (
          error.status === 429 ||
          error.status >= 500 ||
          error.code === 'network'
        ) {
          throw new ServiceUnavailableException('tiktok_unavailable');
        }
        if (
          error.code === 'spam_risk_too_many_posts' ||
          error.code === 'reached_active_user_cap'
        ) {
          throw new ServiceUnavailableException(error.code);
        }
        throw new BadGatewayException('tiktok_invalid_response');
      }
      throw error;
    }
  }
}
