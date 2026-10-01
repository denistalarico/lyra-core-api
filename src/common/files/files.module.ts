import { Module } from '@nestjs/common';
import { AssetAccessService } from './asset-access.service';
import { AssetsController } from './assets.controller';
import { FilesService } from './files.service';

@Module({
  controllers: [AssetsController],
  providers: [FilesService, AssetAccessService],
  exports: [FilesService, AssetAccessService],
})
export class FilesModule {}
