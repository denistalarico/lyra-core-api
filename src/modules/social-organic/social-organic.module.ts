import { Module } from '@nestjs/common';
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

@Module({
  imports: [
    PermissionsModule,
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
