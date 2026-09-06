import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  SocialOrganicAssetEntity,
  SocialOrganicConnectionEntity,
} from './entities';

@Module({
  imports: [
    TypeOrmModule.forFeature(
      [SocialOrganicConnectionEntity, SocialOrganicAssetEntity],
      'agency',
    ),
  ],
})
export class SocialOrganicModule {}
