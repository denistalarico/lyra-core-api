import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionsModule } from '../permissions';
import { SocialChannelPreferenceEntity } from './social-channel-preference.entity';
import { SocialChannelPreferencesController } from './social-channel-preferences.controller';
import { SocialChannelPreferencesService } from './social-channel-preferences.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([SocialChannelPreferenceEntity], 'agency'),
    PermissionsModule,
  ],
  controllers: [SocialChannelPreferencesController],
  providers: [SocialChannelPreferencesService],
  exports: [SocialChannelPreferencesService],
})
export class SocialChannelPreferencesModule {}
