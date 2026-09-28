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
  AgencyWorkspaceUserEntity,
} from '../agency/entities/agency-settings.entities';
import { AgencyClient } from '../clients/entities/agency-client.entity';
import { AgencyClientCompanyContext } from '../clients/entities/agency-client-company-context.entity';
import { ContactEntity } from '../contacts/entities/contact.entity';
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
import { ClientAreaMembershipEntity } from './entities/client-area-membership.entity';
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
import { ClientAreaPasswordResetService } from './services/client-area-password-reset.service';
import { ClientAreaRateLimitService } from './services/client-area-rate-limit.service';
import { ClientAreaSessionService } from './services/client-area-session.service';
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
        ClientAreaInvitationEntity,
        ClientAreaMemberEventEntity,
        AgencyPasswordResetEntity,
        AgencyUserSecuritySettingsEntity,
        AgencyUserSessionEntity,
        AgencyUserProfileEntity,
        AgencyWorkspaceUserEntity,
        AgencyClient,
        AgencyClientCompanyContext,
        ContactEntity,
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
    ClientAreaAuthService,
    ClientAreaAuthorizationService,
    ClientAreaMembershipService,
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
    ClientAreaMembershipService,
    ClientAreaInvitationService,
    ClientAreaRateLimitService,
    ClientAreaAuthorizationService,
    ClientAreaSessionService,
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
