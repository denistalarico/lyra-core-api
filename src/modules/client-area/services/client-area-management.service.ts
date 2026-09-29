import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { isActiveProductEntitlement } from '../../../common/context/product-entitlement-availability';
import { AgencyWorkspaceCompanySettingsEntity } from '../../agency/entities/agency-settings.entities';
import { AgencyUserProfileEntity } from '../../agency/entities/agency-settings.entities';
import { AgencyUserSecuritySettingsEntity } from '../../agency/entities/agency-auth.entities';
import { AgencyClient } from '../../clients/entities/agency-client.entity';
import { AgencyClientCompanyContext } from '../../clients/entities/agency-client-company-context.entity';
import { ContactEntity } from '../../contacts/entities/contact.entity';
import { TenantProductEntitlementEntity } from '../../platform/entities/tenant-product-entitlement.entity';
import { PlatformProductKey } from '../../platform/enums/platform-product.enums';
import { isClientAreaEnabled } from '../client-area.config';
import {
  type PatchClientAreaCompanySettingsDto,
  type PatchClientAreaSettingsDto,
} from '../dto/client-area-management.dto';
import {
  ClientAreaCompanySettingsEntity,
  ClientAreaPreviewEventEntity,
  ClientAreaSettingsEntity,
} from '../entities/client-area-settings.entity';
import { ClientAreaInvitationEntity } from '../entities/client-area-invitation.entity';
import { ClientAreaMembershipEntity } from '../entities/client-area-membership.entity';
import {
  CLIENT_AREA_ERROR_CODES,
  type ClientAreaModules,
} from '../client-area.types';
import { permissionsForClientAreaRole } from '../client-area-permissions.catalog';

const AGENCY_CONNECTION = 'agency';
const EMPTY_MODULES: ClientAreaModules = { approvals: false };

function trimOrNull(value: string | null | undefined) {
  return value?.trim() || null;
}
function unavailable() {
  return new NotFoundException({
    statusCode: 404,
    error: 'Not Found',
    message: 'Client Area is unavailable.',
    code: CLIENT_AREA_ERROR_CODES.disabled,
  });
}

/** CA3's source of truth for activation, safe branding and company settings. */
@Injectable()
export class ClientAreaManagementService {
  constructor(
    private readonly config: ConfigService,
    @InjectRepository(ClientAreaSettingsEntity, AGENCY_CONNECTION)
    private readonly settingsRepo: Repository<ClientAreaSettingsEntity>,
    @InjectRepository(ClientAreaCompanySettingsEntity, AGENCY_CONNECTION)
    private readonly companySettingsRepo: Repository<ClientAreaCompanySettingsEntity>,
    @InjectRepository(ClientAreaPreviewEventEntity, AGENCY_CONNECTION)
    private readonly previewEventsRepo: Repository<ClientAreaPreviewEventEntity>,
    @InjectRepository(AgencyWorkspaceCompanySettingsEntity, AGENCY_CONNECTION)
    private readonly companyIdentityRepo: Repository<AgencyWorkspaceCompanySettingsEntity>,
    @InjectRepository(AgencyClientCompanyContext, AGENCY_CONNECTION)
    private readonly contextsRepo: Repository<AgencyClientCompanyContext>,
    @InjectRepository(AgencyClient, AGENCY_CONNECTION)
    private readonly clientsRepo: Repository<AgencyClient>,
    @InjectRepository(ContactEntity, AGENCY_CONNECTION)
    private readonly contactsRepo: Repository<ContactEntity>,
    @InjectRepository(ClientAreaMembershipEntity, AGENCY_CONNECTION)
    private readonly membershipsRepo: Repository<ClientAreaMembershipEntity>,
    @InjectRepository(AgencyUserSecuritySettingsEntity, AGENCY_CONNECTION)
    private readonly securityRepo: Repository<AgencyUserSecuritySettingsEntity>,
    @InjectRepository(AgencyUserProfileEntity, AGENCY_CONNECTION)
    private readonly profilesRepo: Repository<AgencyUserProfileEntity>,
    @InjectRepository(ClientAreaInvitationEntity, AGENCY_CONNECTION)
    private readonly invitationsRepo: Repository<ClientAreaInvitationEntity>,
    @InjectRepository(TenantProductEntitlementEntity, AGENCY_CONNECTION)
    private readonly entitlementsRepo: Repository<TenantProductEntitlementEntity>,
  ) {}

  private async findSettings(tenantId: string, workspaceId: string) {
    return this.settingsRepo.findOne({ where: { tenantId, workspaceId } });
  }

  async getSettings(tenantId: string, workspaceId: string) {
    return (
      (await this.findSettings(tenantId, workspaceId)) ??
      this.settingsRepo.create({
        tenantId,
        workspaceId,
        enabled: false,
        brandingMode: 'agency',
        loginLayout: 'centered',
        defaultRole: 'client_viewer',
        approvalsDefaultEnabled: false,
        domainMode: 'default',
        domainVerificationStatus: 'not_configured',
      })
    );
  }

  async patchSettings(
    tenantId: string,
    workspaceId: string,
    dto: PatchClientAreaSettingsDto,
  ) {
    const current = await this.getSettings(tenantId, workspaceId);
    const domainMode = dto.domainMode ?? current.domainMode;
    const customDomain =
      domainMode === 'custom'
        ? normalizeDomain(dto.customDomain ?? current.customDomain)
        : null;
    if (domainMode === 'custom' && !customDomain)
      throw new BadRequestException('A custom domain is required.');
    await this.settingsRepo.upsert(
      {
        ...current,
        ...dto,
        tenantId,
        workspaceId,
        customDomain,
        domainMode,
        domainVerificationStatus:
          domainMode === 'custom' && customDomain !== current.customDomain
            ? 'pending'
            : domainMode === 'default'
              ? 'not_configured'
              : current.domainVerificationStatus,
        displayName: trimOrNull(dto.displayName ?? current.displayName),
        loginHeading: trimOrNull(dto.loginHeading ?? current.loginHeading),
        loginSupportingText: trimOrNull(
          dto.loginSupportingText ?? current.loginSupportingText,
        ),
      },
      ['tenantId', 'workspaceId'],
    );
    return this.getSettings(tenantId, workspaceId);
  }

  async assertAgencyEnabled(tenantId: string, workspaceId: string) {
    if (!isClientAreaEnabled(this.config)) throw unavailable();
    const settings = await this.findSettings(tenantId, workspaceId);
    if (!settings?.enabled) throw unavailable();
    return settings;
  }

  async assertIdentityAgencyEnabled(identity: {
    tenantId: string;
    userId: string;
  }) {
    if (!isClientAreaEnabled(this.config)) throw unavailable();
    const memberships = await this.membershipsRepo.find({
      where: {
        tenantId: identity.tenantId,
        userId: identity.userId,
        status: 'active',
      },
    });
    for (const membership of memberships) {
      const settings = await this.findSettings(
        membership.tenantId,
        membership.workspaceId,
      );
      if (settings?.enabled) return settings;
    }
    throw unavailable();
  }

  async hasIdentityAvailableCompany(identity: {
    tenantId: string;
    userId: string;
  }) {
    if (!isClientAreaEnabled(this.config)) return false;
    const memberships = await this.membershipsRepo.find({
      where: {
        tenantId: identity.tenantId,
        userId: identity.userId,
        status: 'active',
      },
    });
    for (const membership of memberships) {
      const [settings, company] = await Promise.all([
        this.findSettings(membership.tenantId, membership.workspaceId),
        this.companySettingsRepo.findOne({
          where: {
            tenantId: membership.tenantId,
            workspaceId: membership.workspaceId,
            agencyClientId: membership.agencyClientId,
            companyContextId: membership.companyContextId,
            enabled: true,
          },
        }),
      ]);
      if (settings?.enabled && company) return true;
    }
    return false;
  }

  async resolveCompanyModules(input: {
    tenantId: string;
    workspaceId: string;
    agencyClientId: string;
    companyContextId: string;
    now?: Date;
  }) {
    const [settings, companySettings, client] = await Promise.all([
      this.findSettings(input.tenantId, input.workspaceId),
      this.companySettingsRepo.findOne({
        where: {
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          agencyClientId: input.agencyClientId,
          companyContextId: input.companyContextId,
        },
      }),
      this.clientsRepo.findOne({
        where: {
          id: input.agencyClientId,
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
        },
      }),
    ]);
    if (
      !isClientAreaEnabled(this.config) ||
      !settings?.enabled ||
      !companySettings?.enabled ||
      !client?.managedTenantId
    )
      return EMPTY_MODULES;
    const entitlement = await this.entitlementsRepo.findOne({
      where: {
        tenantId: client.managedTenantId,
        productKey: PlatformProductKey.Social,
      },
    });
    return {
      approvals: Boolean(
        companySettings.approvalsEnabled &&
        isActiveProductEntitlement(entitlement, input.now ?? new Date()),
      ),
    };
  }

  async getCompanySettings(
    tenantId: string,
    workspaceId: string,
    agencyClientId: string,
    companyContextId: string,
  ) {
    await this.assertUsableCompany(
      tenantId,
      workspaceId,
      agencyClientId,
      companyContextId,
    );
    const global = await this.getSettings(tenantId, workspaceId);
    return (
      (await this.companySettingsRepo.findOne({
        where: { tenantId, workspaceId, agencyClientId, companyContextId },
      })) ??
      this.companySettingsRepo.create({
        tenantId,
        workspaceId,
        agencyClientId,
        companyContextId,
        enabled: false,
        approvalsEnabled: global.approvalsDefaultEnabled,
        defaultRole: global.defaultRole,
      })
    );
  }

  async patchCompanySettings(
    tenantId: string,
    workspaceId: string,
    agencyClientId: string,
    companyContextId: string,
    dto: PatchClientAreaCompanySettingsDto,
  ) {
    const current = await this.getCompanySettings(
      tenantId,
      workspaceId,
      agencyClientId,
      companyContextId,
    );
    await this.companySettingsRepo.upsert(
      {
        ...current,
        ...dto,
        tenantId,
        workspaceId,
        agencyClientId,
        companyContextId,
      },
      ['companyContextId'],
    );
    return this.getCompanySettings(
      tenantId,
      workspaceId,
      agencyClientId,
      companyContextId,
    );
  }

  async branding(tenantId: string, workspaceId: string) {
    const [settings, identity] = await Promise.all([
      this.getSettings(tenantId, workspaceId),
      this.companyIdentityRepo.findOne({ where: { tenantId, workspaceId } }),
    ]);
    const agencyName =
      identity?.tradeName?.trim() ||
      identity?.workspaceName?.trim() ||
      identity?.legalName?.trim() ||
      'Lyra';
    const agency = {
      displayName: agencyName,
      logoLightUrl: identity?.logoUrl ?? null,
      logoDarkUrl: identity?.logoDarkUrl ?? null,
      markLightUrl: identity?.markLightUrl ?? identity?.avatarUrl ?? null,
      markDarkUrl: identity?.markDarkUrl ?? null,
      faviconUrl: identity?.faviconUrl ?? null,
      primaryColor: identity?.primaryColor ?? null,
      secondaryColor: identity?.secondaryColor ?? null,
    };
    const custom = settings.brandingMode === 'custom';
    return {
      displayName: custom
        ? (settings.displayName ?? agency.displayName)
        : agency.displayName,
      logoLightUrl: custom
        ? (settings.logoLightUrl ?? agency.logoLightUrl)
        : agency.logoLightUrl,
      logoDarkUrl: custom ? settings.logoDarkUrl : agency.logoDarkUrl,
      markLightUrl: custom
        ? (settings.markLightUrl ?? agency.markLightUrl)
        : agency.markLightUrl,
      markDarkUrl: custom ? settings.markDarkUrl : agency.markDarkUrl,
      faviconUrl: custom ? settings.faviconUrl : agency.faviconUrl,
      primaryColor: custom ? settings.primaryColor : agency.primaryColor,
      secondaryColor: custom ? settings.secondaryColor : agency.secondaryColor,
      login: {
        layout: settings.loginLayout,
        heading: settings.loginHeading,
        supportingText: settings.loginSupportingText,
        backgroundColor: settings.loginBackgroundColor,
      },
    };
  }

  async overview(tenantId: string, workspaceId: string) {
    const contexts = await this.contextsRepo.find({
      where: { tenantId, workspaceId, status: 'active' },
    });
    const ids = contexts.map((context) => context.id);
    const [settings, configured, memberships, invitations] = await Promise.all([
      this.getSettings(tenantId, workspaceId),
      ids.length
        ? this.companySettingsRepo.find({
            where: ids.map((companyContextId) => ({
              tenantId,
              workspaceId,
              companyContextId,
            })),
          })
        : [],
      ids.length
        ? this.membershipsRepo.find({
            where: ids.map((companyContextId) => ({
              tenantId,
              workspaceId,
              companyContextId,
              status: 'active',
            })),
          })
        : [],
      ids.length
        ? this.invitationsRepo.find({
            where: ids.map((companyContextId) => ({
              tenantId,
              workspaceId,
              companyContextId,
              status: 'pending',
            })),
          })
        : [],
    ]);
    const enabled = configured.filter((item) => item.enabled);
    return {
      platformEnabled: isClientAreaEnabled(this.config),
      settings,
      metrics: {
        enabledCompanies: enabled.length,
        activeUsers: memberships.length,
        pendingInvites: invitations.length,
        approvalsEnabledCompanies: enabled.filter(
          (item) => item.approvalsEnabled,
        ).length,
      },
    };
  }

  async listCompanies(tenantId: string, workspaceId: string) {
    const contexts = await this.contextsRepo.find({
      where: { tenantId, workspaceId, status: 'active' },
    });
    const clientIds = [...new Set(contexts.map((c) => c.agencyClientId))];
    const contactIds = [...new Set(contexts.map((c) => c.companyContactId))];
    const [clients, contacts, configured, memberships, invitations]: [
      AgencyClient[],
      ContactEntity[],
      ClientAreaCompanySettingsEntity[],
      ClientAreaMembershipEntity[],
      ClientAreaInvitationEntity[],
    ] = await Promise.all([
      clientIds.length
        ? this.clientsRepo.find({
            where: clientIds.map((id) => ({ id, tenantId, workspaceId })),
          })
        : [],
      contactIds.length
        ? this.contactsRepo.find({
            where: contactIds.map((id) => ({ id, tenantId, workspaceId })),
          })
        : [],
      this.companySettingsRepo.find({ where: { tenantId, workspaceId } }),
      this.membershipsRepo.find({
        where: { tenantId, workspaceId, status: 'active' },
      }),
      this.invitationsRepo.find({
        where: { tenantId, workspaceId, status: 'pending' },
      }),
    ]);
    const configBy = new Map<string, ClientAreaCompanySettingsEntity>(
      configured.map((item) => [item.companyContextId, item]),
    );
    const clientBy = new Map<string, AgencyClient>(
      clients.map((item) => [item.id, item] as [string, AgencyClient]),
    );
    const contactBy = new Map<string, ContactEntity>(
      contacts.map((item) => [item.id, item] as [string, ContactEntity]),
    );
    return contexts
      .map((context) => {
        const config = configBy.get(context.id);
        const contact = contactBy.get(context.companyContactId);
        return {
          companyContextId: context.id,
          agencyClientId: context.agencyClientId,
          company: contact?.displayName || contact?.legalName || 'Empresa',
          agencyClient:
            clientBy.get(context.agencyClientId)?.displayName || 'Cliente',
          enabled: config?.enabled ?? false,
          approvalsEnabled: config?.approvalsEnabled ?? false,
          defaultRole: config?.defaultRole ?? 'client_viewer',
          membersCount: memberships.filter(
            (item) => item.companyContextId === context.id,
          ).length,
          pendingInvites: invitations.filter(
            (item) => item.companyContextId === context.id,
          ).length,
        };
      })
      .sort((a, b) => a.company.localeCompare(b.company, 'pt-BR'));
  }

  async preview(
    tenantId: string,
    workspaceId: string,
    agencyClientId: string,
    companyContextId: string,
    actorUserId: string,
    membershipId: string,
    action: 'preview_started' | 'preview_ended',
  ) {
    await this.assertAgencyEnabled(tenantId, workspaceId);
    const membership = await this.membershipsRepo.findOne({
      where: {
        id: membershipId,
        tenantId,
        workspaceId,
        agencyClientId,
        companyContextId,
        status: 'active',
      },
    });
    if (!membership)
      throw new NotFoundException('Client Area membership not found.');
    await this.previewEventsRepo.save(
      this.previewEventsRepo.create({
        tenantId,
        workspaceId,
        agencyClientId,
        companyContextId,
        agencyActorUserId: actorUserId,
        targetMembershipId: membership.id,
        action,
      }),
    );
    const [company, identity, profile, modules] = await Promise.all([
      this.contextsRepo.findOne({
        where: { id: companyContextId, tenantId, workspaceId, agencyClientId },
      }),
      this.securityRepo.findOne({
        where: { tenantId, userId: membership.userId },
      }),
      this.profilesRepo.findOne({
        where: { tenantId, userId: membership.userId },
      }),
      this.resolveCompanyModules({
        tenantId,
        workspaceId,
        agencyClientId,
        companyContextId,
      }),
    ]);
    const organization = company
      ? await this.contactsRepo.findOne({
          where: { id: company.companyContactId, tenantId, workspaceId },
        })
      : null;
    return {
      preview: {
        surface: 'agency_client_preview',
        companyContextId,
        membershipId: membership.id,
        user: {
          displayName:
            profile?.displayName?.trim() ||
            identity?.currentEmail ||
            'Usuário cliente',
          email: identity?.currentEmail || null,
        },
        company:
          organization?.displayName || organization?.legalName || 'Empresa',
        role: membership.role,
        permissions: [...permissionsForClientAreaRole(membership.role)].sort(),
        modules,
        readOnly: true,
      },
    };
  }

  async previewTargets(
    tenantId: string,
    workspaceId: string,
    agencyClientId: string,
    companyContextId: string,
  ) {
    await this.assertUsableCompany(
      tenantId,
      workspaceId,
      agencyClientId,
      companyContextId,
    );
    const memberships = await this.membershipsRepo.find({
      where: {
        tenantId,
        workspaceId,
        agencyClientId,
        companyContextId,
        status: 'active',
      },
    });
    const userIds = memberships.map((item) => item.userId);
    const [identities, profiles] = userIds.length
      ? await Promise.all([
          this.securityRepo.find({
            where: userIds.map((userId) => ({ tenantId, userId })),
          }),
          this.profilesRepo.find({
            where: userIds.map((userId) => ({ tenantId, userId })),
          }),
        ])
      : [[], []];
    const emails = new Map<string, string>(
      identities.map((item) => [item.userId, item.currentEmail]),
    );
    const names = new Map<string, string>(
      profiles.map((item) => [item.userId, item.displayName]),
    );
    return {
      targets: memberships.map((item) => ({
        membershipId: item.id,
        displayName:
          names.get(item.userId)?.trim() ||
          emails.get(item.userId) ||
          'Usuário cliente',
        role: item.role,
      })),
    };
  }

  private async assertUsableCompany(
    tenantId: string,
    workspaceId: string,
    agencyClientId: string,
    companyContextId: string,
  ) {
    const context = await this.contextsRepo.findOne({
      where: {
        id: companyContextId,
        tenantId,
        workspaceId,
        agencyClientId,
        status: 'active',
      },
    });
    if (!context) throw new NotFoundException('Company is not available.');
    return context;
  }
}

export function normalizeDomain(
  value: string | null | undefined,
): string | null {
  const domain = value?.trim().toLowerCase().replace(/\.$/, '') || '';
  if (!domain) return null;
  if (
    domain.includes('://') ||
    /[/?#@]/.test(domain) ||
    domain.length > 253 ||
    domain === 'localhost' ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(domain) ||
    domain.includes(':') ||
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
      domain,
    )
  )
    throw new BadRequestException('Invalid custom domain hostname.');
  return domain;
}
