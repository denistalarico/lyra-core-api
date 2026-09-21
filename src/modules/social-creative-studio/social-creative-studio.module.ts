import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MediaAssetsModule } from '../../common/media-assets';
import { PermissionsModule } from '../permissions';
import { SocialOrganicModule } from '../social-organic/social-organic.module';
import { CreativeAssetService } from './creative-asset.service';
import { CreativeFolderService } from './creative-folder.service';
import { CreativeThumbnailService } from './creative-thumbnail.service';
import { CreativeStudioController } from './creative-studio.controller';
import {
  CreativeAssetEntity,
  CreativeAssetVersionEntity,
  CreativeFolderEntity,
} from './entities';
import {
  SocialContentItemEntity,
  SocialPlanEntity,
} from '../social-planner/entities';

@Module({
  imports: [
    PermissionsModule,
    MediaAssetsModule,
    SocialOrganicModule,
    TypeOrmModule.forFeature(
      [
        CreativeAssetEntity,
        CreativeAssetVersionEntity,
        CreativeFolderEntity,
        SocialContentItemEntity,
        SocialPlanEntity,
      ],
      'agency',
    ),
  ],
  controllers: [CreativeStudioController],
  providers: [
    CreativeAssetService,
    CreativeFolderService,
    CreativeThumbnailService,
  ],
})
export class SocialCreativeStudioModule {}
