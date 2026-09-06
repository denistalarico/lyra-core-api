import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingsCryptoService } from '../../common/crypto/settings-crypto.service';
import {
  SocialOrganicConnectionService,
  SocialOrganicOAuthProviderRegistry,
  SocialOrganicOAuthService,
} from './connections';
import { SocialOrganicCredentialResolver } from './credentials';
import {
  SocialOrganicAssetEntity,
  SocialOrganicConnectionEntity,
} from './entities';

@Module({
  imports: [
    TypeOrmModule.forFeature(
      [SocialOrganicConnectionEntity, SocialOrganicAssetEntity],
      'agency',
    ),
  ],
  providers: [
    SocialOrganicCredentialResolver,
    SocialOrganicOAuthProviderRegistry,
    SocialOrganicOAuthService,
    SocialOrganicConnectionService,
    SettingsCryptoService,
  ],
  exports: [
    SocialOrganicCredentialResolver,
    SocialOrganicOAuthProviderRegistry,
    SocialOrganicOAuthService,
    SocialOrganicConnectionService,
  ],
})
export class SocialOrganicModule {}
