import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingsCryptoService } from '../../common/crypto/settings-crypto.service';
import { PermissionsModule } from '../permissions';
import { SocialAdAccountConnectionEntity } from './entities';
import { SocialInternalAccessService } from './internal/social-internal-access.service';
import { MetaAdsGraphService } from './services/meta-ads-graph.service';
import { MetaAdsOAuthService } from './services/meta-ads-oauth.service';
import { MetaAdsSystemUserService } from './services/meta-ads-system-user.service';
import { SocialAdConnectionService } from './services/social-ad-connection.service';
import { SocialIntegrationsController } from './social-integrations.controller';

/**
 * Ad account connections for Lyra Social.
 *
 * Imports `PermissionsModule` (guard, entitlement, managed context) and
 * nothing from Inbox. The only shared pieces are platform-level primitives —
 * `SettingsCryptoService` and the Meta app credentials — which belong to the
 * platform rather than to either product.
 */
@Module({
  imports: [
    PermissionsModule,
    TypeOrmModule.forFeature([SocialAdAccountConnectionEntity], 'agency'),
  ],
  controllers: [SocialIntegrationsController],
  providers: [
    MetaAdsGraphService,
    MetaAdsOAuthService,
    MetaAdsSystemUserService,
    SocialAdConnectionService,
    SocialInternalAccessService,
    SettingsCryptoService,
  ],
  exports: [SocialAdConnectionService],
})
export class SocialIntegrationsModule {}
