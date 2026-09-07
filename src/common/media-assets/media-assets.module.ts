import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MediaAssetResolverService } from './media-asset-resolver.service';
import { MediaAssetEntity } from './media-asset.entity';

/** Shared persistence wiring for private media identities. */
@Module({
  imports: [TypeOrmModule.forFeature([MediaAssetEntity], 'agency')],
  providers: [MediaAssetResolverService],
  exports: [TypeOrmModule, MediaAssetResolverService],
})
export class MediaAssetsModule {}
