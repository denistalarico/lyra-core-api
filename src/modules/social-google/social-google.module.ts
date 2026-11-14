import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingsCryptoService } from '../../common/crypto/settings-crypto.service';
import { PermissionsModule } from '../permissions';
import {
  SocialGoogleAuditEventEntity,
  SocialGoogleAuthorizationEntity,
  SocialGoogleOAuthSessionEntity,
  SocialGoogleProductLinkEntity,
} from './entities';
import { SocialAdAccountConnectionEntity } from '../social-integrations/entities/social-ad-account-connection.entity';
import { GoogleAdsCredentialResolver } from './google-ads-credential.resolver';
import { GoogleApiClient } from './google-api.client';
import { GoogleOAuthClient } from './google-oauth.client';
import { SocialGoogleSelectionService } from './social-google-selection.service';
import { SocialGoogleAuthorizationService } from './social-google-authorization.service';
import { SocialGoogleOAuthService } from './social-google-oauth.service';
import { SocialGoogleController } from './social-google.controller';

/**
 * Google OAuth foundation for Lyra Social (GA4, Ads, Business Profile).
 * Exports `SocialGoogleAuthorizationService` so later phases obtain tokens
 * through `getAccessToken` instead of touching credentials.
 */
@Module({
  imports: [
    PermissionsModule,
    TypeOrmModule.forFeature(
      [
        SocialGoogleAuthorizationEntity,
        SocialGoogleOAuthSessionEntity,
        SocialGoogleProductLinkEntity,
        SocialGoogleAuditEventEntity,
        SocialAdAccountConnectionEntity,
      ],
      'agency',
    ),
  ],
  controllers: [SocialGoogleController],
  providers: [
    GoogleOAuthClient,
    GoogleApiClient,
    GoogleAdsCredentialResolver,
    SocialGoogleSelectionService,
    SettingsCryptoService,
    SocialGoogleOAuthService,
    SocialGoogleAuthorizationService,
  ],
  exports: [SocialGoogleAuthorizationService, GoogleAdsCredentialResolver],
})
export class SocialGoogleModule {}
