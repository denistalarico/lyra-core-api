import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingsCryptoService } from '../../common/crypto/settings-crypto.service';
import { FilesModule } from '../../common/files/files.module';
import { EmailModule } from '../email/email.module';
import { AgencySettingsController } from './agency-settings.controller';
import { AgencySettingsService } from './agency-settings.service';
import {
  AgencyEmailTwoFactorCodeEntity,
  AgencyUserSecuritySettingsEntity,
  AgencyUserSessionEntity,
  AgencyUserTrustedDeviceEntity,
} from './entities/agency-auth.entities';
import {
  AgencyUserNotificationPreferencesEntity,
  AgencyUserPreferencesEntity,
  AgencyUserProfileEntity,
  AgencyWorkspaceAdvancedSettingsEntity,
  AgencyWorkspaceAppsSettingsEntity,
  AgencyWorkspaceCompanySettingsEntity,
  AgencyWorkspaceEmailSettingsEntity,
  AgencyWorkspaceFinanceSettingsEntity,
  AgencyWorkspaceIntegrationEntity,
  AgencyWorkspaceNotificationSettingsEntity,
  AgencyWorkspaceSecuritySettingsEntity,
  AgencyWorkspaceSubscriptionSettingsEntity,
  AgencyWorkspaceUserEntity,
  AgencyWorkspaceUserPermissionEntity,
} from './entities/agency-settings.entities';

const AGENCY_CONNECTION = 'agency';

@Module({
  imports: [
    FilesModule,
    EmailModule,
    TypeOrmModule.forFeature(
      [
        AgencyUserPreferencesEntity,
        AgencyUserProfileEntity,
        AgencyWorkspaceCompanySettingsEntity,
        AgencyWorkspaceEmailSettingsEntity,
        AgencyWorkspaceNotificationSettingsEntity,
        AgencyUserNotificationPreferencesEntity,
        AgencyUserSecuritySettingsEntity,
        AgencyUserSessionEntity,
        AgencyUserTrustedDeviceEntity,
        AgencyEmailTwoFactorCodeEntity,
        AgencyWorkspaceSecuritySettingsEntity,
        AgencyWorkspaceAppsSettingsEntity,
        AgencyWorkspaceFinanceSettingsEntity,
        AgencyWorkspaceSubscriptionSettingsEntity,
        AgencyWorkspaceAdvancedSettingsEntity,
        AgencyWorkspaceIntegrationEntity,
        AgencyWorkspaceUserEntity,
        AgencyWorkspaceUserPermissionEntity,
      ],
      AGENCY_CONNECTION,
    ),
  ],
  controllers: [AgencySettingsController],
  providers: [AgencySettingsService, SettingsCryptoService],
  exports: [AgencySettingsService],
})
export class AgencySettingsModule {}
