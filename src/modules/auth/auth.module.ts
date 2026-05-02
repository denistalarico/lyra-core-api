import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserSecuritySettingsEntity } from '../settings/entities/user-security-settings.entity';
import { WorkspaceUserEntity } from '../settings/entities/workspace-user.entity';
import { UserSessionEntity } from '../settings/entities/user-session.entity';
import { UserTrustedDeviceEntity } from '../settings/entities/user-trusted-device.entity';
import { UserPreferencesEntity } from '../settings/entities/user-preferences.entity';
import { UserProfileEntity } from '../settings/entities/user-profile.entity';
import { WorkspaceSettingsCompanyEntity } from '../settings/entities/workspace-settings-company.entity';
import { WorkspaceUserModuleAccessEntity } from '../settings/entities/workspace-user-module-access.entity';
import { WorkspaceUserInvitationEntity } from '../settings/entities/workspace-user-invitation.entity';
import { PasswordResetEntity } from './entities/password-reset.entity';
import { EmailTwoFactorCodeEntity } from './entities/email-2fa-code.entity';
import { EmailModule } from '../email/email.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { SettingsCryptoService } from '../../common/crypto/settings-crypto.service';
import { AccessControlModule } from '../../common/access-control/access-control.module';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({}),
    EmailModule,
    AccessControlModule,
    TypeOrmModule.forFeature([
      UserSecuritySettingsEntity,
      WorkspaceUserEntity,
      UserSessionEntity,
      UserTrustedDeviceEntity,
      UserPreferencesEntity,
      UserProfileEntity,
      WorkspaceSettingsCompanyEntity,
      WorkspaceUserModuleAccessEntity,
      WorkspaceUserInvitationEntity,
      PasswordResetEntity,
      EmailTwoFactorCodeEntity,
    ]),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, SettingsCryptoService],
  exports: [AuthService],
})
export class AuthModule {}
