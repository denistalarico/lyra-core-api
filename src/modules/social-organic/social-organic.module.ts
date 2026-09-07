import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingsCryptoService } from '../../common/crypto/settings-crypto.service';
import { FilesModule } from '../../common/files/files.module';
import { MediaAssetsModule } from '../../common/media-assets';
import { PermissionsModule } from '../permissions';
import { SocialContentDestinationEntity } from '../social-planner/entities/social-content-destination.entity';
import { SocialContentItemEntity } from '../social-planner/entities/social-content-item.entity';
import {
  SOCIAL_ORGANIC_OAUTH_PROVIDERS,
  SocialOrganicController,
  SocialOrganicConnectionService,
  SocialOrganicOAuthProviderRegistry,
  SocialOrganicOAuthService,
} from './connections';
import { SocialOrganicCredentialResolver } from './credentials';
import {
  SocialOrganicAssetEntity,
  SocialOrganicConnectionEntity,
} from './entities';
import { MediaPreparationService } from './media/media-preparation.service';
import {
  SocialPublicationController,
  SocialPublicationEntity,
  SocialPublicationConfigService,
  SocialPublicationRunService,
  SocialPublicationScheduler,
  SocialPublicationService,
  SocialPublicationWorker,
} from './publication';
import { SocialPublicationExecutorService } from './publication/social-publication.executor';
import { SOCIAL_PUBLICATION_EXECUTOR } from './publication/social-publication.worker';
import {
  MetaOrganicAssetDiscoveryService,
  MetaOrganicGraphService,
  MetaOrganicOAuthProvider,
  SocialPublisherRegistry,
} from './providers';

export function createMetaOrganicOAuthProviders(
  meta: MetaOrganicOAuthProvider,
) {
  return [meta];
}

@Module({
  imports: [
    PermissionsModule,
    FilesModule,
    MediaAssetsModule,
    TypeOrmModule.forFeature(
      [
        SocialOrganicConnectionEntity,
        SocialOrganicAssetEntity,
        SocialPublicationEntity,
        SocialContentItemEntity,
        SocialContentDestinationEntity,
      ],
      'agency',
    ),
  ],
  controllers: [SocialOrganicController, SocialPublicationController],
  providers: [
    MetaOrganicGraphService,
    MetaOrganicAssetDiscoveryService,
    MetaOrganicOAuthProvider,
    {
      provide: SOCIAL_ORGANIC_OAUTH_PROVIDERS,
      useFactory: createMetaOrganicOAuthProviders,
      inject: [MetaOrganicOAuthProvider],
    },
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
    MediaPreparationService,
    SocialPublicationExecutorService,
    {
      provide: SOCIAL_PUBLICATION_EXECUTOR,
      useExisting: SocialPublicationExecutorService,
    },
  ],
  exports: [
    SocialOrganicCredentialResolver,
    SocialOrganicOAuthProviderRegistry,
    SocialOrganicOAuthService,
    SocialOrganicConnectionService,
    SocialPublicationRunService,
    SocialPublicationService,
    SocialPublisherRegistry,
  ],
})
export class SocialOrganicModule {}
