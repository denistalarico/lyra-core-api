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
import { PermissionsModule } from '../permissions';
import { SocialContentDestinationEntity } from '../social-planner/entities/social-content-destination.entity';
import { SocialContentItemEntity } from '../social-planner/entities/social-content-item.entity';
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
import {
  SocialPublicationController,
  SocialPublicationEntity,
  SocialPublicationConfigService,
  SocialPublicationRunService,
  SocialPublicationScheduler,
  SocialPublicationService,
  SocialPublicationWorker,
} from './publication';
import { SocialPublisherRegistry } from './providers';
import { SocialOrganicModule } from './social-organic.module';

describe('SocialOrganicModule', () => {
  it('binds repositories and the credential boundary to the agency module', () => {
    expect((TypeOrmModule.forFeature as jest.Mock).mock.calls).toContainEqual([
      [
        SocialOrganicConnectionEntity,
        SocialOrganicAssetEntity,
        SocialPublicationEntity,
        SocialContentItemEntity,
        SocialContentDestinationEntity,
      ],
      'agency',
    ]);
    expect(
      Reflect.getMetadata(MODULE_METADATA.IMPORTS, SocialOrganicModule),
    ).toContain(PermissionsModule);
    expect(
      Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, SocialOrganicModule),
    ).toEqual([SocialPublicationController]);
    expect(
      Reflect.getMetadata(MODULE_METADATA.PROVIDERS, SocialOrganicModule),
    ).toEqual([
      SocialOrganicCredentialResolver,
      SocialOrganicOAuthProviderRegistry,
      SocialOrganicOAuthService,
      SocialOrganicConnectionService,
      SocialPublicationRunService,
      SocialPublicationScheduler,
      SocialPublicationService,
      SocialPublicationWorker,
      SocialPublicationConfigService,
      SocialPublisherRegistry,
      SettingsCryptoService,
    ]);
    expect(
      Reflect.getMetadata(MODULE_METADATA.EXPORTS, SocialOrganicModule),
    ).toEqual([
      SocialOrganicCredentialResolver,
      SocialOrganicOAuthProviderRegistry,
      SocialOrganicOAuthService,
      SocialOrganicConnectionService,
      SocialPublicationRunService,
      SocialPublicationService,
      SocialPublisherRegistry,
    ]);
  });
});
