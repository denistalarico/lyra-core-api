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
import { CompositeAdminIdentityGateway } from './adapters/composite-admin-identity.gateway';
import { PlatformAdminIdentityAdapter } from './adapters/platform-admin-identity.adapter';
import { AdminIdentityGateway } from './contracts/admin-identity.gateway';
import { AdminAccessController } from './controllers/admin-access.controller';
import { AdminAuthController } from './controllers/admin-auth.controller';
import { AdminInternalUsersController } from './controllers/admin-internal-users.controller';
import { AdminInvitationsPublicController } from './controllers/admin-invitations-public.controller';
import { AdminSettingsController } from './controllers/admin-settings.controller';
import {
  PlatformAdminAuditEventEntity,
  PlatformAdminIdentityEntity,
  PlatformAdminIdentityTokenEntity,
  PlatformAdminInvitationEntity,
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
import { AdminIdentityLifecycleService } from './services/admin-identity-lifecycle.service';
import { AdminInternalUsersService } from './services/admin-internal-users.service';
import { AdminInvitationsService } from './services/admin-invitations.service';
import { AdminInvitationTokenService } from './services/admin-invitation-token.service';
import { AdminRolePolicyService } from './services/admin-role-policy.service';
import { AdminSettingsService } from './services/admin-settings.service';

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
        PlatformAdminInvitationEntity,
        PlatformAdminSessionEntity,
        PlatformAdminTwoFactorCodeEntity,
        PlatformAdminIdentityEntity,
        PlatformAdminIdentityTokenEntity,
        AgencyUserSecuritySettingsEntity,
        AgencyWorkspaceUserEntity,
        AgencyUserProfileEntity,
      ],
      AGENCY_CONNECTION,
    ),
  ],
  controllers: [
    AdminAccessController,
    AdminAuthController,
    AdminInvitationsPublicController,
    AdminInternalUsersController,
    AdminSettingsController,
  ],
  providers: [
    AgencyAdminIdentityAdapter,
    PlatformAdminIdentityAdapter,
    CompositeAdminIdentityGateway,
    {
      provide: AdminIdentityGateway,
      useExisting: CompositeAdminIdentityGateway,
    },
    AdminIdentityService,
    AdminIdentityLifecycleService,
    AdminAccessService,
    AdminAuditService,
    AdminAuthTokenService,
    AdminAuthRateLimitService,
    AdminAuthService,
    AdminBootstrapService,
    AdminSettingsService,
    AdminInternalUsersService,
    AdminInvitationsService,
    AdminInvitationTokenService,
    AdminRolePolicyService,
    SettingsCryptoService,
    AdminAuthenticationGuard,
    AdminAccessGuard,
    AdminBrowserOriginGuard,
  ],
  exports: [
    AdminIdentityGateway,
    AdminIdentityService,
    AdminIdentityLifecycleService,
    AdminAccessService,
    AdminAuditService,
    AdminAuthTokenService,
    AdminAuthService,
    AdminBootstrapService,
    AdminSettingsService,
    AdminInternalUsersService,
    AdminInvitationsService,
    AdminInvitationTokenService,
    AdminRolePolicyService,
    AdminAuthenticationGuard,
    AdminAccessGuard,
    AdminBrowserOriginGuard,
  ],
})
export class AdminModule {}
