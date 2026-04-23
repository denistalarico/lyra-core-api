// src/modules/settings/settings.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { UserPreferencesEntity } from './entities/user-preferences.entity';
import { WorkspaceSettingsAiEntity } from './entities/workspace-settings-ai.entity';
import { WorkspaceSettingsCompanyEntity } from './entities/workspace-settings-company.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserPreferencesEntity,
      WorkspaceSettingsAiEntity,
      WorkspaceSettingsCompanyEntity,
    ]),
  ],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
