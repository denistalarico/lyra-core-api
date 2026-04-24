import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { UserPreferencesEntity } from './entities/user-preferences.entity';
import { WorkspaceSettingsAiEntity } from './entities/workspace-settings-ai.entity';
import { WorkspaceSettingsCompanyEntity } from './entities/workspace-settings-company.entity';
import { UserProfileEntity } from './entities/user-profile.entity';
import { WorkspaceUserEntity } from './entities/workspace-user.entity';
import { WorkspaceUserModuleAccessEntity } from './entities/workspace-user-module-access.entity';
import { WorkspaceSettingsEmailEntity } from './entities/workspace-settings-email.entity';
import { SettingsCryptoService } from '../../common/crypto/settings-crypto.service';
import { WorkspaceIntegrationEntity } from './entities/workspace-integration.entity';
import { UserSecuritySettingsEntity } from './entities/user-security-settings.entity';
import { UserSessionEntity } from './entities/user-session.entity';
import { UserTrustedDeviceEntity } from './entities/user-trusted-device.entity';
import { UserNotificationEntity } from './entities/user-notification.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserPreferencesEntity,
      WorkspaceSettingsAiEntity,
      WorkspaceSettingsCompanyEntity,
      UserProfileEntity,
      WorkspaceUserEntity,
      WorkspaceUserModuleAccessEntity,
      WorkspaceSettingsEmailEntity,
      WorkspaceIntegrationEntity,
      UserSecuritySettingsEntity,
      UserSessionEntity,
      UserTrustedDeviceEntity,
      UserNotificationEntity,
    ]),
  ],
  controllers: [SettingsController],
  providers: [SettingsService, SettingsCryptoService],
  exports: [SettingsService, SettingsCryptoService],
})
export class SettingsModule {}
