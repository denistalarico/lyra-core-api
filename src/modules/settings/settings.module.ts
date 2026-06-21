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
import { WorkspaceUserInvitationEntity } from './entities/workspace-user-invitation.entity';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../email/email.module';
import { FilesModule } from '../../common/files/files.module';
import { AccessControlModule } from '../../common/access-control/access-control.module';
import { PermissionsModule } from '../permissions';

@Module({
  imports: [
    AuthModule,
    EmailModule,
    FilesModule,
    AccessControlModule,
    PermissionsModule,
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
      WorkspaceUserInvitationEntity,
    ]),
  ],
  controllers: [SettingsController],
  providers: [SettingsService, SettingsCryptoService],
  exports: [SettingsService, SettingsCryptoService],
})
export class SettingsModule {}
