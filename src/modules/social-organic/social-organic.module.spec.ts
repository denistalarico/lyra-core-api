jest.mock('@nestjs/typeorm', () => ({
  InjectDataSource: jest.fn(() => jest.fn()),
  InjectRepository: jest.fn(() => jest.fn()),
  TypeOrmModule: {
    forFeature: jest.fn(() => class AgencySocialOrganicTypeOrmFeatureModule {}),
  },
}));

import { MODULE_METADATA } from '@nestjs/common/constants';
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
import { SocialOrganicModule } from './social-organic.module';

describe('SocialOrganicModule', () => {
  it('binds repositories and the credential boundary to the agency module', () => {
    expect((TypeOrmModule.forFeature as jest.Mock).mock.calls).toContainEqual([
      [SocialOrganicConnectionEntity, SocialOrganicAssetEntity],
      'agency',
    ]);
    expect(
      Reflect.getMetadata(MODULE_METADATA.PROVIDERS, SocialOrganicModule),
    ).toEqual([
      SocialOrganicCredentialResolver,
      SocialOrganicOAuthProviderRegistry,
      SocialOrganicOAuthService,
      SocialOrganicConnectionService,
      SettingsCryptoService,
    ]);
    expect(
      Reflect.getMetadata(MODULE_METADATA.EXPORTS, SocialOrganicModule),
    ).toEqual([
      SocialOrganicCredentialResolver,
      SocialOrganicOAuthProviderRegistry,
      SocialOrganicOAuthService,
      SocialOrganicConnectionService,
    ]);
  });
});
