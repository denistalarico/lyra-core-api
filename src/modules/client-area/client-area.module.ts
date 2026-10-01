import { Logger, Module, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgencyIdentityCredentialsModule } from '../agency/agency-identity-credentials.module';
import {
  AgencyPasswordResetEntity,
  AgencyUserSecuritySettingsEntity,
  AgencyUserSessionEntity,
} from '../agency/entities/agency-auth.entities';
import {
  AgencyUserProfileEntity,
  AgencyWorkspaceCompanySettingsEntity,
  AgencyWorkspaceUserEntity,
} from '../agency/entities/agency-settings.entities';
import { AgencyClient } from '../clients/entities/agency-client.entity';
import { AgencyClientCompanyContext } from '../clients/entities/agency-client-company-context.entity';
import { ContactEntity } from '../contacts/entities/contact.entity';
import { ContactCompanyLinkEntity } from '../contacts/entities/contact-company-link.entity';
import { EmailModule } from '../email/email.module';
import { TenantProductEntitlementEntity } from '../platform/entities/tenant-product-entitlement.entity';
import {
  CLIENT_AREA_ENABLED_ENV,
  isClientAreaEnabled,
} from './client-area.config';
import { ClientAreaAuthController } from './controllers/client-area-auth.controller';
import { ClientAreaDirectoryController } from './controllers/client-area-directory.controller';
import { ClientAreaInvitationsController } from './controllers/client-area-invitations.controller';
import { ClientAreaInvitationEntity } from './entities/client-area-invitation.entity';
import { ClientAreaMemberEventEntity } from './entities/client-area-member-event.entity';
import { ClientAreaIdentityContactEntity } from './entities/client-area-identity-contact.entity';
import { ClientAreaMembershipEntity } from './entities/client-area-membership.entity';
import {
  ClientAreaCompanySettingsEntity,
  ClientAreaPreviewEventEntity,
  ClientAreaSettingsEntity,
} from './entities/client-area-settings.entity';
import {
  ClientAreaAuthGuard,
  ClientAreaEnabledGuard,
  ClientAreaMembershipGuard,
} from './guards/client-area.guards';
import { ClientAreaAuthService } from './services/client-area-auth.service';
import { ClientAreaAuthorizationService } from './services/client-area-authorization.service';
import { ClientAreaDirectoryService } from './services/client-area-directory.service';
import { ClientAreaEmailService } from './services/client-area-email.service';
import { ClientAreaInvitationService } from './services/client-area-invitation.service';
import { ClientAreaMemberAuditService } from './services/client-area-member-audit.service';
import { ClientAreaMembershipService } from './services/client-area-membership.service';
import { ClientAreaEligibilityService } from './services/client-area-eligibility.service';
import { ClientAreaLegacyAuditService } from './services/client-area-legacy-audit.service';
import { ClientAreaPasswordResetService } from './services/client-area-password-reset.service';
import { ClientAreaRateLimitService } from './services/client-area-rate-limit.service';
import { ClientAreaSessionService } from './services/client-area-session.service';
import { ClientAreaManagementService } from './services/client-area-management.service';
import { ClientAreaJwtStrategy } from './strategies/client-area-jwt.strategy';

const AGENCY_CONNECTION = 'agency';

/**
 * CA1 — Client Area identity & membership foundation; CA2 — invitations,
 * password reset, rate limits and the member management services. Self-
 * contained on purpose: it imports no Agency permission, context or
 * directory module (the Agency management controller lives in
 * `ClientAreaAgencyModule`).
 */
@Module({
  imports: [
    PassportModule,
    JwtModule.register({}),
    AgencyIdentityCredentialsModule,
    EmailModule,
    TypeOrmModule.forFeature(
      [
        ClientAreaMembershipEntity,
        ClientAreaIdentityContactEntity,
        ClientAreaSettingsEntity,
        ClientAreaCompanySettingsEntity,
        ClientAreaPreviewEventEntity,
        ClientAreaInvitationEntity,
        ClientAreaMemberEventEntity,
        AgencyPasswordResetEntity,
        AgencyUserSecuritySettingsEntity,
        AgencyUserSessionEntity,
        AgencyUserProfileEntity,
        AgencyWorkspaceUserEntity,
        AgencyWorkspaceCompanySettingsEntity,
        AgencyClient,
        AgencyClientCompanyContext,
        ContactEntity,
        ContactCompanyLinkEntity,
        TenantProductEntitlementEntity,
      ],
      AGENCY_CONNECTION,
    ),
  ],
  controllers: [
    ClientAreaAuthController,
    ClientAreaDirectoryController,
    ClientAreaInvitationsController,
  ],
  providers: [
    ClientAreaJwtStrategy,
    ClientAreaSessionService,
    ClientAreaManagementService,
    ClientAreaAuthService,
    ClientAreaAuthorizationService,
    ClientAreaMembershipService,
    ClientAreaEligibilityService,
    ClientAreaLegacyAuditService,
    ClientAreaDirectoryService,
    ClientAreaMemberAuditService,
    ClientAreaEmailService,
    ClientAreaInvitationService,
    ClientAreaPasswordResetService,
    ClientAreaRateLimitService,
    ClientAreaEnabledGuard,
    ClientAreaAuthGuard,
    ClientAreaMembershipGuard,
  ],
  exports: [
    // Re-exported so a module that already depends on the Client Area (AP3)
    // gets the credential primitives without importing
    // `AgencyIdentityCredentialsModule` itself: that import pulls `otplib`
    // (ESM) into the module graph of every spec that reaches it.
    AgencyIdentityCredentialsModule,
    ClientAreaMembershipService,
    ClientAreaEligibilityService,
    ClientAreaInvitationService,
    ClientAreaRateLimitService,
    ClientAreaAuthorizationService,
    ClientAreaSessionService,
    ClientAreaManagementService,
    ClientAreaAuthGuard,
    ClientAreaMembershipGuard,
    ClientAreaEnabledGuard,
  ],
})
export class ClientAreaModule implements OnModuleInit {
  private readonly logger = new Logger(ClientAreaModule.name);

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const requested =
      this.config.get<string>(CLIENT_AREA_ENABLED_ENV)?.trim().toLowerCase() ===
      'true';

    if (requested && !isClientAreaEnabled(this.config)) {
      // Fail closed, but loudly: the flag alone never opens the surface.
      this.logger.error(
        'CLIENT_AREA_ENABLED=true but JWT_CLIENT_AREA_ACCESS_SECRET is missing, shorter than 32 chars or equal to another JWT secret. Client Area stays disabled.',
      );
    }
  }
}
