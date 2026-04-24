import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { UserPreferencesEntity } from '../modules/settings/entities/user-preferences.entity';
import { WorkspaceSettingsAiEntity } from '../modules/settings/entities/workspace-settings-ai.entity';
import { WorkspaceSettingsCompanyEntity } from '../modules/settings/entities/workspace-settings-company.entity';
import { UserProfileEntity } from '../modules/settings/entities/user-profile.entity';
import { WorkspaceUserEntity } from '../modules/settings/entities/workspace-user.entity';
import { WorkspaceUserModuleAccessEntity } from '../modules/settings/entities/workspace-user-module-access.entity';
import { CreateSettingsTables1760000000000 } from './migrations/1760000000000-create-settings-tables';
import { AddCompanyBrandAssets1760000001000 } from './migrations/1760000001000-add-company-brand-assets';
import { AlterCompanyBrandLogoUrlToText1760000002000 } from './migrations/1760000002000-alter-company-brand-logo-url-to-text';
import { CreateUserProfile1760000003000 } from './migrations/1760000003000-create-user-profile';
import { CreateWorkspaceUsers1760000004000 } from './migrations/1760000004000-create-workspace-users';
import { WorkspaceSettingsEmailEntity } from '../modules/settings/entities/workspace-settings-email.entity';
import { CreateWorkspaceSettingsEmail1760000005000 } from './migrations/1760000005000-create-workspace-settings-email';
import { CreateWorkspaceIntegrations1760000006000 } from './migrations/1760000006000-create-workspace-integrations';
import { UserSecuritySettingsEntity } from '../modules/settings/entities/user-security-settings.entity';
import { UserSessionEntity } from '../modules/settings/entities/user-session.entity';
import { UserTrustedDeviceEntity } from '../modules/settings/entities/user-trusted-device.entity';
import { CreateSecurityLogin1760000007000 } from './migrations/1760000007000-create-security-login';
import { UserNotificationEntity } from '../modules/settings/entities/user-notification.entity';
import { CreateUserNotifications1760000008000 } from './migrations/1760000008000-create-user-notifications';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5433),
  username: process.env.DB_USERNAME ?? 'lyra',
  password: process.env.DB_PASSWORD ?? 'lyra_dev_password',
  database: process.env.DB_NAME ?? 'lyra_core',
  synchronize: false,
  logging: false,
  entities: [
    UserPreferencesEntity,
    WorkspaceSettingsAiEntity,
    WorkspaceSettingsCompanyEntity,
    UserProfileEntity,
    WorkspaceUserEntity,
    WorkspaceUserModuleAccessEntity,
    WorkspaceSettingsEmailEntity,
    UserSecuritySettingsEntity,
    UserSessionEntity,
    UserTrustedDeviceEntity,
    UserNotificationEntity,
  ],
  migrations: [
    CreateSettingsTables1760000000000,
    AddCompanyBrandAssets1760000001000,
    AlterCompanyBrandLogoUrlToText1760000002000,
    CreateUserProfile1760000003000,
    CreateWorkspaceUsers1760000004000,
    CreateWorkspaceSettingsEmail1760000005000,
    CreateWorkspaceIntegrations1760000006000,
    CreateSecurityLogin1760000007000,
    CreateUserNotifications1760000008000,
  ],
});
