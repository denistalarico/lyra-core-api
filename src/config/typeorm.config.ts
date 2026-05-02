import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { UserPreferencesEntity } from '../modules/settings/entities/user-preferences.entity';
import { WorkspaceSettingsAiEntity } from '../modules/settings/entities/workspace-settings-ai.entity';
import { WorkspaceSettingsCompanyEntity } from '../modules/settings/entities/workspace-settings-company.entity';
import { UserProfileEntity } from '../modules/settings/entities/user-profile.entity';
import { WorkspaceUserEntity } from '../modules/settings/entities/workspace-user.entity';
import { WorkspaceUserModuleAccessEntity } from '../modules/settings/entities/workspace-user-module-access.entity';
import { WorkspaceSettingsEmailEntity } from '../modules/settings/entities/workspace-settings-email.entity';
import { WorkspaceIntegrationEntity } from '../modules/settings/entities/workspace-integration.entity';
import { UserSecuritySettingsEntity } from '../modules/settings/entities/user-security-settings.entity';
import { UserSessionEntity } from '../modules/settings/entities/user-session.entity';
import { UserTrustedDeviceEntity } from '../modules/settings/entities/user-trusted-device.entity';
import { UserNotificationEntity } from '../modules/settings/entities/user-notification.entity';
import { WorkspaceUserInvitationEntity } from '../modules/settings/entities/workspace-user-invitation.entity';
import { PasswordResetEntity } from '../modules/auth/entities/password-reset.entity';
import { EmailTwoFactorCodeEntity } from '../modules/auth/entities/email-2fa-code.entity';
import { ContactEntity } from '../modules/contacts/entities/contact.entity';
import { ContactMethodEntity } from '../modules/contacts/entities/contact-method.entity';
import { ContactAddressEntity } from '../modules/contacts/entities/contact-address.entity';
import { ContactListEntity } from '../modules/contacts/entities/contact-list.entity';
import { ContactListMemberEntity } from '../modules/contacts/entities/contact-list-member.entity';
import { ContactTagEntity } from '../modules/contacts/entities/contact-tag.entity';
import { ContactTagAssignmentEntity } from '../modules/contacts/entities/contact-tag-assignment.entity';
import { ContactCustomFieldEntity } from '../modules/contacts/entities/contact-custom-field.entity';
import { ContactCustomFieldValueEntity } from '../modules/contacts/entities/contact-custom-field-value.entity';
import { ContactSegmentEntity } from '../modules/contacts/entities/contact-segment.entity';
import { ContactBusinessModeEntity } from '../modules/contacts/entities/contact-business-mode.entity';
import { ContactViewPreferenceEntity } from '../modules/contacts/entities/contact-view-preference.entity';



export function getTypeOrmConfig(): TypeOrmModuleOptions {
  return {
    type: 'postgres',
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5433),
    username: process.env.DB_USERNAME ?? 'lyra',
    password: process.env.DB_PASSWORD ?? 'lyra_dev_password',
    database: process.env.DB_NAME ?? 'lyra_core',
    synchronize: false,
    autoLoadEntities: false,
    logging: false,
    entities: [
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
      PasswordResetEntity,
      EmailTwoFactorCodeEntity,
      ContactEntity,
      ContactMethodEntity,
      ContactAddressEntity,
      ContactListEntity,
      ContactListMemberEntity,
      ContactTagEntity,
      ContactTagAssignmentEntity,
      ContactCustomFieldEntity,
      ContactCustomFieldValueEntity,
      ContactSegmentEntity,
      ContactBusinessModeEntity,
      ContactViewPreferenceEntity,
    ],
  };
}
