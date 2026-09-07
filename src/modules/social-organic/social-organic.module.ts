import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingsCryptoService } from '../../common/crypto/settings-crypto.service';
import { MediaAssetsModule } from '../../common/media-assets';
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
import { SocialPublisherRegistry } from './providers';

@Module({
  imports: [
    PermissionsModule,
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
  controllers: [SocialPublicationController],
  providers: [
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
