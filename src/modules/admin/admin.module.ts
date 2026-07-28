import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingsCryptoService } from '../../common/crypto/settings-crypto.service';
import { AgencyUserSecuritySettingsEntity } from '../agency/entities/agency-auth.entities';
import { EmailModule } from '../email/email.module';
import {
  AgencyUserProfileEntity,
  AgencyWorkspaceUserEntity,
} from '../agency/entities/agency-settings.entities';
import { AgencyAdminIdentityAdapter } from './adapters/agency-admin-identity.adapter';
import { AdminIdentityGateway } from './contracts/admin-identity.gateway';
import { AdminAccessController } from './controllers/admin-access.controller';
import { AdminAuthController } from './controllers/admin-auth.controller';
import {
  PlatformAdminAuditEventEntity,
  PlatformAdminSessionEntity,
  PlatformAdminTwoFactorCodeEntity,
  PlatformInternalAdminEntity,
} from './entities';
import { AdminAccessGuard } from './guards/admin-access.guard';
import { AdminAuthenticationGuard } from './guards/admin-authentication.guard';
import { AdminBrowserOriginGuard } from './guards/admin-browser-origin.guard';
import { AdminAccessService } from './services/admin-access.service';
import { AdminAuthRateLimitService } from './services/admin-auth-rate-limit.service';
import { AdminAuthTokenService } from './services/admin-auth-token.service';
import { AdminAuthService } from './services/admin-auth.service';
import { AdminAuditService } from './services/admin-audit.service';
import { AdminBootstrapService } from './services/admin-bootstrap.service';
import { AdminIdentityService } from './services/admin-identity.service';

const AGENCY_CONNECTION = 'agency';

@Module({
  imports: [
    ConfigModule,
    JwtModule.register({}),
    EmailModule,
    TypeOrmModule.forFeature(
      [
        PlatformInternalAdminEntity,
        PlatformAdminAuditEventEntity,
        PlatformAdminSessionEntity,
        PlatformAdminTwoFactorCodeEntity,
        AgencyUserSecuritySettingsEntity,
        AgencyWorkspaceUserEntity,
        AgencyUserProfileEntity,
      ],
      AGENCY_CONNECTION,
    ),
  ],
  controllers: [AdminAccessController, AdminAuthController],
  providers: [
    {
      provide: AdminIdentityGateway,
      useClass: AgencyAdminIdentityAdapter,
    },
    AdminIdentityService,
    AdminAccessService,
    AdminAuditService,
    AdminAuthTokenService,
    AdminAuthRateLimitService,
    AdminAuthService,
    AdminBootstrapService,
    SettingsCryptoService,
    AdminAuthenticationGuard,
    AdminAccessGuard,
    AdminBrowserOriginGuard,
  ],
  exports: [
    AdminIdentityGateway,
    AdminIdentityService,
    AdminAccessService,
    AdminAuditService,
    AdminAuthTokenService,
    AdminAuthService,
    AdminBootstrapService,
    AdminAuthenticationGuard,
    AdminAccessGuard,
    AdminBrowserOriginGuard,
  ],
})
export class AdminModule {}
