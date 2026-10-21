import { CompanyLogoRegistryModule } from '../../common/client-area-bridge/company-logo.registry';
import { ClientAreaProductSettingsController } from './controllers/client-area-product-settings.controller';
import {
  ClientAreaSettingsRegistry,
  ClientAreaSettingsRegistryModule,
} from '../../common/client-area-bridge/client-area-settings.registry';
import { ClientAreaSettingsRequestsRegistry } from './client-area-settings-requests.registry';
import { ClientAreaSettingsRequestsController } from './controllers/client-area-settings-requests.controller';
import { ClientAreaSecurityController } from './controllers/client-area-security.controller';
import { ClientAreaSecurityService } from './services/client-area-security.service';
import { ClientAreaCompanyHooksRegistry } from './client-area-company-hooks.registry';
import { ClientAreaPublicController } from './controllers/client-area-public.controller';
import { ClientAreaPreferencesController } from './controllers/client-area-preferences.controller';
import { ClientAreaPublicBrandingService } from './services/client-area-public-branding.service';
import { ClientAreaIdentityPreferencesEntity } from './entities/client-area-identity-preferences.entity';
import { APP_INTERCEPTOR } from '@nestjs/core';
import {
  ClientAreaBridgeRegistry,
  ClientAreaBridgeRegistryModule,
} from '../../common/client-area-bridge/client-area-bridge.registry';
import { ClientAreaBridgeAuthenticator } from './services/client-area-bridge-authenticator';
import { ClientAreaMemberModuleAccessEntity } from './entities/client-area-member-module-access.entity';
import { AuditChangeEventEntity } from './entities/audit-change-event.entity';
import { LeadFlowTelemetryConsentEntity } from '../leadflow-privacy/entities/leadflow-telemetry-consent.entity';
import { LeadFlowTelemetryConsentNoticeEntity } from '../leadflow-privacy/entities/leadflow-telemetry-consent-notice.entity';
import { ClientAreaAccessController } from './controllers/client-area-access.controller';
import { ClientAreaMemberAccessService } from './services/client-area-member-access.service';
import { ClientAreaConsentService } from './services/client-area-consent.service';
import { AuditChangeService } from './services/audit-change.service';
import { AuditChangeInterceptor } from './services/audit-change.interceptor';
import { ActorDirectoryService } from './services/actor-directory.service';
import { AgencyClientCompanyProduct } from '../clients/entities/agency-client-company-product.entity';
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
  AgencyUserTrustedDeviceEntity,
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
  ClientAreaSelfAccessEntity,
  ClientAreaSelfAccessEventEntity,
} from './entities/client-area-self-access.entity';
import {
  ClientAreaCompanySettingsEntity,
  ClientAreaPreviewEventEntity,
  ClientAreaSettingsEntity,
} from './entities/client-area-settings.entity';
import {
  ClientAreaAuthGuard,
  ClientAreaEnabledGuard,
  ClientAreaMembershipGuard,
  ClientAreaSelfContextGuard,
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
import { ClientAreaSelfAccessService } from './services/client-area-self-access.service';
import { ClientAreaSessionService } from './services/client-area-session.service';
import { ClientAreaLifecycleService } from './services/client-area-lifecycle.service';
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
    CompanyLogoRegistryModule,
    ClientAreaSettingsRegistryModule,
    ClientAreaBridgeRegistryModule,
    PassportModule,
    JwtModule.register({}),
    AgencyIdentityCredentialsModule,
    EmailModule,
    TypeOrmModule.forFeature(
      [
        ClientAreaIdentityPreferencesEntity,
        ClientAreaMemberModuleAccessEntity,
        AuditChangeEventEntity,
        LeadFlowTelemetryConsentEntity,
        LeadFlowTelemetryConsentNoticeEntity,
        ClientAreaMembershipEntity,
        ClientAreaSelfAccessEntity,
        ClientAreaSelfAccessEventEntity,
        ClientAreaIdentityContactEntity,
        ClientAreaSettingsEntity,
        ClientAreaCompanySettingsEntity,
        ClientAreaPreviewEventEntity,
        ClientAreaInvitationEntity,
        ClientAreaMemberEventEntity,
        AgencyPasswordResetEntity,
        AgencyUserSecuritySettingsEntity,
        AgencyUserSessionEntity,
        AgencyUserTrustedDeviceEntity,
        AgencyUserProfileEntity,
        AgencyWorkspaceUserEntity,
        AgencyWorkspaceCompanySettingsEntity,
        AgencyClientCompanyProduct,
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
    ClientAreaProductSettingsController,
    ClientAreaSettingsRequestsController,
    ClientAreaSecurityController,
    ClientAreaPublicController,
    ClientAreaPreferencesController,
    ClientAreaAccessController,
    ClientAreaAuthController,
    ClientAreaDirectoryController,
    ClientAreaInvitationsController,
  ],
  providers: [
    ClientAreaSettingsRequestsRegistry,
    ClientAreaSecurityService,
    ClientAreaCompanyHooksRegistry,
    ClientAreaPublicBrandingService,
    ClientAreaBridgeAuthenticator,
    ClientAreaMemberAccessService,
    ClientAreaConsentService,
    AuditChangeService,
    AuditChangeInterceptor,
    ActorDirectoryService,
    { provide: APP_INTERCEPTOR, useExisting: AuditChangeInterceptor },
    ClientAreaJwtStrategy,
    ClientAreaSessionService,
    ClientAreaManagementService,
    ClientAreaLifecycleService,
    ClientAreaSelfAccessService,
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
    ClientAreaSelfContextGuard,
  ],
  exports: [
    ClientAreaSettingsRequestsRegistry,
    ClientAreaCompanyHooksRegistry,
    ClientAreaPublicBrandingService,
    ClientAreaMemberAccessService,
    ClientAreaConsentService,
    AuditChangeService,
    ActorDirectoryService,
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
    ClientAreaLifecycleService,
    ClientAreaSelfAccessService,
    ClientAreaAuthGuard,
    ClientAreaMembershipGuard,
    ClientAreaSelfContextGuard,
    ClientAreaEnabledGuard,
  ],
})
export class ClientAreaModule implements OnModuleInit {
  private readonly logger = new Logger(ClientAreaModule.name);

  constructor(
    private readonly settingsRegistry: ClientAreaSettingsRegistry,
    private readonly sessions: ClientAreaSessionService,
    private readonly authorization: ClientAreaAuthorizationService,
    private readonly audit: AuditChangeService,
    private readonly config: ConfigService,
    private readonly bridgeRegistry: ClientAreaBridgeRegistry,
    private readonly bridge: ClientAreaBridgeAuthenticator,
    private readonly actors: ActorDirectoryService,
  ) {}

  onModuleInit() {
    this.settingsRegistry.registerAuditWriter((input) =>
      this.audit.record(input),
    );
    this.settingsRegistry.registerOAuthValidator(async (binding) => {
      const identity = await this.sessions.authenticate({
        sub: binding.userId,
        tenantId: binding.tenantId,
        sessionId: binding.sessionId,
        typ: 'client_area',
      });
      const context = await this.authorization.authorize({
        identity,
        companyContextId: binding.companyContextId,
        module: binding.module,
      });
      if (
        context.workspaceId !== binding.workspaceId ||
        context.agencyClientId !== binding.agencyClientId ||
        context.role !== 'client_owner'
      )
        throw new Error('OAuth requires the current Owner.');
    });
    this.bridgeRegistry.register(this.bridge);
    this.bridgeRegistry.registerActorDirectory((tenantId, ids) =>
      this.actors.resolveNames(tenantId, ids),
    );
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
