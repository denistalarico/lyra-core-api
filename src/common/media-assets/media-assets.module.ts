import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FilesModule } from '../files/files.module';
import { MediaAssetResolverService } from './media-asset-resolver.service';
import { MediaAssetEntity } from './media-asset.entity';

/**
 * Shared persistence wiring for private media identities.
 *
 * `MediaAssetUploadService` is exported as a class but NOT provided here, and
 * `MediaAssetController` is not declared here either. Both depend on things
 * that belong to the importing product module, not to this shared boundary:
 * the controller's authorization is Social's (product entitlement +
 * `social.publishing.media.*`), and the upload service needs
 * `MEDIA_ASSET_METADATA_READER`, whose only implementation (M2's
 * `MediaMetadataService`) lives in `social-organic`. Providing them here would
 * force every future importer — Creative Studio, LeadFlow — to mount a Social
 * endpoint and satisfy a Social dependency.
 *
 * `SocialOrganicModule` provides both, and `TypeOrmModule` is re-exported so
 * the repository the upload service injects resolves there.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([MediaAssetEntity], 'agency'),
    FilesModule,
  ],
  providers: [MediaAssetResolverService],
  exports: [TypeOrmModule, FilesModule, MediaAssetResolverService],
})
export class MediaAssetsModule {}
