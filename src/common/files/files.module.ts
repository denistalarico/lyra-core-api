import { Module } from '@nestjs/common';
import { AssetsController } from './assets.controller';
import { FilesService } from './files.service';

@Module({
  controllers: [AssetsController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
