import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingsCryptoService } from '../../common/crypto/settings-crypto.service';
import { EmailModule } from '../email/email.module';
import { AgencyAuthController } from './agency-auth.controller';
import { AgencyAuthService } from './agency-auth.service';
import {
  AgencyEmailTwoFactorCodeEntity,
  AgencyPasswordResetEntity,
  AgencyUserLoginEventEntity,
  AgencyUserSecuritySettingsEntity,
  AgencyUserSessionEntity,
  AgencyUserTrustedDeviceEntity,
} from './entities/agency-auth.entities';
import {
  AgencyWorkspaceEmailSettingsEntity,
  AgencyWorkspaceUserEntity,
  AgencyWorkspaceUserPermissionEntity,
} from './entities/agency-settings.entities';

const AGENCY_CONNECTION = 'agency';

@Module({
  imports: [
    ConfigModule,
    JwtModule.register({}),
    EmailModule,
    TypeOrmModule.forFeature(
      [
        AgencyUserSecuritySettingsEntity,
        AgencyWorkspaceUserEntity,
        AgencyWorkspaceUserPermissionEntity,
        AgencyUserSessionEntity,
        AgencyPasswordResetEntity,
        AgencyEmailTwoFactorCodeEntity,
        AgencyUserLoginEventEntity,
        AgencyWorkspaceEmailSettingsEntity,
        AgencyUserTrustedDeviceEntity,
      ],
      AGENCY_CONNECTION,
    ),
  ],
  controllers: [AgencyAuthController],
  providers: [AgencyAuthService, SettingsCryptoService],
  exports: [AgencyAuthService],
})
export class AgencyAuthModule {}
