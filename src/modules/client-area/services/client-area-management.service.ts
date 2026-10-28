import { ClientAreaCompanyHooksRegistry } from '../client-area-company-hooks.registry';
import { clientAreaUiPermissions } from '../client-area-agency-permission-projection';
import { randomBytes } from 'node:crypto';
import { ClientAreaMemberAccessService } from './client-area-member-access.service';
import { permissionsForMemberAccess } from '../client-area-permissions.catalog';
import { Optional } from '@nestjs/common';
import { ClientAreaConsentService } from './client-area-consent.service';
import {
  CLIENT_AREA_ANALYTICS_PRODUCTS,
  CLIENT_AREA_MODULE_KEYS,
  type ClientAreaAnalyticsProduct,
  type ClientAreaModuleSettings,
} from '../client-area.types';
import {
  validateModuleSettings,
  legacyDefaultLevel,
} from '../client-area-access-validation';
import { AgencyClientCompanyProduct } from '../../clients/entities/agency-client-company-product.entity';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { FilesService } from '../../../common/files/files.service';
import { isActiveProductEntitlement } from '../../../common/context/product-entitlement-availability';
import { AgencyWorkspaceCompanySettingsEntity } from '../../agency/entities/agency-settings.entities';
import { AgencyUserProfileEntity } from '../../agency/entities/agency-settings.entities';
import { AgencyUserSecuritySettingsEntity } from '../../agency/entities/agency-auth.entities';
import { AgencyClient } from '../../clients/entities/agency-client.entity';
import { AgencyClientCompanyContext } from '../../clients/entities/agency-client-company-context.entity';
import { ContactEntity } from '../../contacts/entities/contact.entity';
import { AgencyContactProfileEntity } from '../../agency/entities/agency-contact-details.entities';
import { TenantProductEntitlementEntity } from '../../platform/entities/tenant-product-entitlement.entity';
import {
  isActiveClient,
  isActiveCompany,
  isAvailableOrganization,
} from '../client-area-availability';
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
import { ClientAreaSelfAccessEntity } from '../entities/client-area-self-access.entity';
import {
  CLIENT_AREA_ERROR_CODES,
  type ClientAreaModules,
} from '../client-area.types';
import { permissionsForClientAreaRole } from '../client-area-permissions.catalog';
import { ClientAreaEligibilityService } from './client-area-eligibility.service';

const AGENCY_CONNECTION = 'agency';
export const CLIENT_AREA_BRAND_ASSET_SLOTS = [
  'logo_light',
  'logo_dark',
  'login_image',
] as const;
export type ClientAreaBrandAssetSlot =
  (typeof CLIENT_AREA_BRAND_ASSET_SLOTS)[number];

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
    @InjectRepository(ClientAreaSelfAccessEntity, AGENCY_CONNECTION)
    private readonly selfAccessRepo: Repository<ClientAreaSelfAccessEntity>,
    @InjectRepository(AgencyUserSecuritySettingsEntity, AGENCY_CONNECTION)
    private readonly securityRepo: Repository<AgencyUserSecuritySettingsEntity>,
    @InjectRepository(AgencyUserProfileEntity, AGENCY_CONNECTION)
    private readonly profilesRepo: Repository<AgencyUserProfileEntity>,
    @InjectRepository(ClientAreaInvitationEntity, AGENCY_CONNECTION)
    private readonly invitationsRepo: Repository<ClientAreaInvitationEntity>,
    @InjectRepository(TenantProductEntitlementEntity, AGENCY_CONNECTION)
    private readonly entitlementsRepo: Repository<TenantProductEntitlementEntity>,
    private readonly eligibility: ClientAreaEligibilityService,
    @InjectRepository(AgencyClientCompanyProduct, AGENCY_CONNECTION)
    private readonly productsRepo: Repository<AgencyClientCompanyProduct>,
    @Optional() private readonly consents?: ClientAreaConsentService,
    @Optional() private readonly memberAccess?: ClientAreaMemberAccessService,
    @Optional() private readonly companyHooks?: ClientAreaCompanyHooksRegistry,
    @Optional()
    @InjectRepository(AgencyContactProfileEntity, AGENCY_CONNECTION)
    private readonly contactProfilesRepo?: Repository<AgencyContactProfileEntity>,
    @Optional() private readonly filesService?: FilesService,
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
        conversationsDefaultEnabled: false,
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
    const identity = await this.companyIdentityRepo.findOne({
      where: { tenantId, workspaceId },
    });
    const name =
      dto.displayName?.trim() ||
      identity?.tradeName?.trim() ||
      identity?.workspaceName?.trim() ||
      identity?.legalName?.trim() ||
      'agency';
    const prefix =
      name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 15) || 'agency';
    await this.settingsRepo.upsert(
      {
        ...current,
        ...dto,
        tenantId,
        workspaceId,
        customDomain,
        domainMode,
        publicSlug: current.id
          ? current.publicSlug
          : `${prefix}-${randomBytes(12).toString('hex')}`,
        domainVerificationToken:
          customDomain &&
          (customDomain !== current.customDomain ||
            !current.domainVerificationToken)
            ? randomBytes(32).toString('hex')
            : customDomain
              ? current.domainVerificationToken
              : null,
        domainVerifiedAt:
          customDomain === current.customDomain && domainMode === 'custom'
            ? current.domainVerifiedAt
            : null,
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

  async uploadBrandAsset(
    tenantId: string,
    workspaceId: string,
    slot: ClientAreaBrandAssetSlot,
    file: Express.Multer.File,
  ) {
    if (!CLIENT_AREA_BRAND_ASSET_SLOTS.includes(slot))
      throw new BadRequestException('Unsupported Client Area asset slot.');
    if (!this.filesService)
      throw new BadRequestException('File storage is unavailable.');

    const stored = await this.filesService.uploadImageAsset({
      file,
      path: `tenants/${tenantId}/client-area/${slot}-${Date.now()}.webp`,
      maxDimension: slot === 'login_image' ? 2400 : 1200,
    });
    const patch =
      slot === 'logo_light'
        ? { logoLightUrl: stored.url }
        : slot === 'logo_dark'
          ? { logoDarkUrl: stored.url }
          : { loginImageUrl: stored.url };
    await this.patchSettings(tenantId, workspaceId, {});
    await this.settingsRepo.update({ tenantId, workspaceId }, patch);
    return { slot, url: stored.url };
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
    // PD3 — a self-context holder has no membership at all, so the gate above
    // can never pass for them. Their workspace must have both the Client Area
    // and the self-context switched on.
    const selfAccesses = await this.selfAccessRepo.find({
      where: {
        tenantId: identity.tenantId,
        userId: identity.userId,
        status: 'active',
      },
    });
    for (const access of selfAccesses) {
      const settings = await this.findSettings(
        access.tenantId,
        access.workspaceId,
      );
      if (settings?.enabled && settings.selfEnabled) return settings;
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
    return (await this.resolveCompanyAccess(input)).modules;
  }

  /**
   * The company's modules plus the products the `analytics` module reaches
   * (CA-AN1): a product counts with the same rule that gates its own modules —
   * Client Area on, product active on the company, entitled and consented.
   */
  async resolveCompanyAccess(input: {
    tenantId: string;
    workspaceId: string;
    agencyClientId: string;
    companyContextId: string;
    now?: Date;
  }): Promise<{
    modules: ClientAreaModules;
    analyticsProducts: ClientAreaAnalyticsProduct[];
  }> {
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
    const modules = Object.fromEntries(
      CLIENT_AREA_MODULE_KEYS.map((key) => [key, false]),
    ) as ClientAreaModules;
    if (
      !isClientAreaEnabled(this.config) ||
      !settings?.enabled ||
      !companySettings?.enabled ||
      !isActiveClient(client)
    )
      return { modules, analyticsProducts: [] };
    const moduleSettings = companySettings.moduleSettings ?? {};
    for (const key of CLIENT_AREA_MODULE_KEYS)
      modules[key] =
        moduleSettings[key]?.enabled ??
        (key === 'approvals'
          ? companySettings.approvalsEnabled
          : key === 'conversations'
            ? companySettings.conversationsEnabled
            : false);
    const [products, entitlements, consent] = await Promise.all([
      this.productsRepo.find({
        where: {
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          agencyClientId: input.agencyClientId,
          companyContextId: input.companyContextId,
          status: 'active',
        },
      }),
      client.managedTenantId
        ? this.entitlementsRepo.find({
            where: { tenantId: client.managedTenantId },
          })
        : Promise.resolve([]),
      this.consents?.state(input),
    ]);
    const productReady = (product: ClientAreaAnalyticsProduct) =>
      Boolean(
        client.managedTenantId &&
        products.some((row) => row.productKey === product) &&
        entitlements.some(
          (row) =>
            String(row.productKey) === product &&
            isActiveProductEntitlement(row, input.now ?? new Date()),
        ) &&
        consent?.status === 'accepted',
      );
    for (const key of CLIENT_AREA_MODULE_KEYS) {
      const product =
        key === 'approvals' || key.startsWith('social_')
          ? 'social'
          : key.startsWith('leadflow_')
            ? 'leadflow'
            : null;
      if (product)
        modules[key] = Boolean(modules[key] && productReady(product));
    }
    return {
      modules,
      analyticsProducts: CLIENT_AREA_ANALYTICS_PRODUCTS.filter(productReady),
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
        conversationsEnabled: global.conversationsDefaultEnabled,
        defaultRole: global.defaultRole,
        moduleSettings: Object.fromEntries(
          CLIENT_AREA_MODULE_KEYS.map((key) => [
            key,
            {
              enabled:
                key === 'approvals'
                  ? global.approvalsDefaultEnabled
                  : key === 'conversations'
                    ? global.conversationsDefaultEnabled
                    : ['overview', 'analytics', 'settings'].includes(key),
              defaultLevel: legacyDefaultLevel(global.defaultRole),
            },
          ]),
        ),
        allowAiCostActions: false,
        allowMediaSpendActions: false,
        analyticsOverviewFirst: 'leadflow',
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
    if (dto.moduleSettings !== undefined)
      validateModuleSettings(dto.moduleSettings);
    await this.companySettingsRepo.manager.transaction(async (manager) => {
      // Serialize switches with removal and invitations. In particular, an
      // approvals-only PATCH must not resurrect enabled=true from a stale row.
      const company = await manager
        .getRepository(AgencyClientCompanyContext)
        .findOne({
          where: {
            id: companyContextId,
            tenantId,
            workspaceId,
            agencyClientId,
          },
          lock: { mode: 'pessimistic_write' },
        });
      if (!company) throw new NotFoundException('Company is not available.');
      const current = await this.getCompanySettings(
        tenantId,
        workspaceId,
        agencyClientId,
        companyContextId,
      );
      const moduleSettings: ClientAreaModuleSettings = {
        ...current.moduleSettings,
        ...dto.moduleSettings,
      };
      if (dto.approvalsEnabled !== undefined)
        moduleSettings.approvals = {
          ...(moduleSettings.approvals ?? {
            defaultLevel: legacyDefaultLevel(current.defaultRole),
          }),
          enabled: dto.approvalsEnabled,
        };
      if (dto.conversationsEnabled !== undefined)
        moduleSettings.conversations = {
          ...(moduleSettings.conversations ?? {
            defaultLevel: legacyDefaultLevel(current.defaultRole),
          }),
          enabled: dto.conversationsEnabled,
        };
      const settingsRepository = manager.getRepository(
        ClientAreaCompanySettingsEntity,
      );
      await settingsRepository.upsert(
        {
          ...current,
          ...dto,
          moduleSettings,
          approvalsEnabled:
            moduleSettings.approvals?.enabled ?? current.approvalsEnabled,
          conversationsEnabled:
            moduleSettings.conversations?.enabled ??
            current.conversationsEnabled,
          // An absent key keeps the stored order (never the column default).
          analyticsOverviewFirst:
            dto.analyticsOverviewFirst ?? current.analyticsOverviewFirst,
          tenantId,
          workspaceId,
          agencyClientId,
          companyContextId,
        },
        ['companyContextId'],
      );
      if (dto.enabled === true)
        await this.companyHooks?.enabled(
          { tenantId, workspaceId, agencyClientId, companyContextId },
          manager,
        );
    });
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
        imageUrl: settings.loginImageUrl ?? null,
      },
    };
  }

  async overview(tenantId: string, workspaceId: string) {
    const [settings, companies] = await Promise.all([
      this.getSettings(tenantId, workspaceId),
      this.listCompanies(tenantId, workspaceId),
    ]);
    const enabled = companies.filter((company) => company.enabled);
    return {
      platformEnabled: isClientAreaEnabled(this.config),
      settings,
      domainDns: {
        cnameTarget:
          this.config.get<string>('CLIENT_AREA_DOMAIN_CNAME')?.trim() || null,
        ttl: 300,
      },
      metrics: {
        enabledCompanies: enabled.length,
        activeUsers: companies.reduce(
          (sum, company) => sum + company.membersCount,
          0,
        ),
        pendingInvites: companies.reduce(
          (sum, company) => sum + company.pendingInvites,
          0,
        ),
        approvalsEnabledCompanies: enabled.filter(
          (company) => company.approvalsEnabled,
        ).length,
        conversationsEnabledCompanies: enabled.filter(
          (company) => company.conversationsEnabled,
        ).length,
      },
    };
  }

  async listCompanies(tenantId: string, workspaceId: string) {
    const contexts = await this.contextsRepo.find({
      where: { tenantId, workspaceId, status: 'active', archivedAt: IsNull() },
    });
    const clientIds = [...new Set(contexts.map((c) => c.agencyClientId))];
    const contactIds = [...new Set(contexts.map((c) => c.companyContactId))];
    const [clients, contacts, configured, memberships, invitations, profiles]: [
      AgencyClient[],
      ContactEntity[],
      ClientAreaCompanySettingsEntity[],
      ClientAreaMembershipEntity[],
      ClientAreaInvitationEntity[],
      AgencyContactProfileEntity[],
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
      contactIds.length && this.contactProfilesRepo
        ? this.contactProfilesRepo.find({
            where: { tenantId, workspaceId, contactId: In(contactIds) },
          })
        : [],
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
    const profileByContactId = new Map(
      profiles.map((item) => [item.contactId, item]),
    );
    return contexts
      .filter((context) => {
        const organization = contactBy.get(context.companyContactId);
        return (
          isActiveCompany(context) &&
          isActiveClient(clientBy.get(context.agencyClientId)) &&
          isAvailableOrganization(organization) &&
          organization.status === 'active'
        );
      })
      .map((context) => {
        const config = configBy.get(context.id);
        const contact = contactBy.get(context.companyContactId);
        return {
          companyContextId: context.id,
          agencyClientId: context.agencyClientId,
          company: contact?.displayName || contact?.legalName || 'Empresa',
          avatarUrl:
            profileByContactId.get(context.companyContactId)?.avatarUrl ?? null,
          agencyClient:
            clientBy.get(context.agencyClientId)?.displayName || 'Cliente',
          enabled: config?.enabled ?? false,
          approvalsEnabled: config?.approvalsEnabled ?? false,
          conversationsEnabled: config?.conversationsEnabled ?? false,
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

  /**
   * Re-validated on every call: membership must still be active, the
   * Company Context must still resolve, the Agency app must still be
   * enabled, and the CRM identity chain (active identity-contact -> active
   * PF -> active contact_company_link -> this company) must still hold.
   * Nothing here is cached from a prior start, so a revoked membership, a
   * disabled Company/app, an archived PF or a revoked identity link all
   * fail the very next call.
   */
  private async resolvePreviewProjection(
    tenantId: string,
    workspaceId: string,
    agencyClientId: string,
    companyContextId: string,
    membershipId: string,
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
    const company = await this.assertUsableCompany(
      tenantId,
      workspaceId,
      agencyClientId,
      companyContextId,
    );
    const eligible = await this.eligibility.isMembershipEligible(
      this.membershipsRepo.manager,
      { tenantId, userId: membership.userId, companyContextId },
    );
    if (!eligible)
      throw new NotFoundException('Client Area membership not found.');
    const [identity, profile, modules, organization] = await Promise.all([
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
      this.contactsRepo.findOne({
        where: { id: company.companyContactId, tenantId, workspaceId },
      }),
    ]);
    const access = this.memberAccess
      ? await this.memberAccess.resolveMemberAccess(membership, modules)
      : undefined;
    const permissions = access
      ? permissionsForMemberAccess(access)
      : permissionsForClientAreaRole(membership.role);
    const companyDisplayName =
      organization?.displayName || organization?.legalName || 'Empresa';
    return {
      membership,
      preview: {
        surface: 'agency_client_preview' as const,
        companyContextId,
        membershipId: membership.id,
        user: {
          displayName:
            profile?.displayName?.trim() ||
            identity?.currentEmail ||
            'Usuário cliente',
          email: identity?.currentEmail || null,
        },
        company: companyDisplayName,
        displayName: companyDisplayName,
        role: membership.role,
        permissions: [...permissions].sort(),
        memberAccess: access,
        uiPermissions: access
          ? [
              ...new Set([...permissions, ...clientAreaUiPermissions(access)]),
            ].sort()
          : [...permissions].sort(),
        consent: this.consents
          ? await this.consents.state(
              { tenantId, workspaceId, agencyClientId, companyContextId },
              membership.role === 'client_owner',
            )
          : undefined,
        modules,
        branding: await this.branding(tenantId, workspaceId),
        readOnly: true as const,
      },
    };
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
    const resolved = await this.resolvePreviewProjection(
      tenantId,
      workspaceId,
      agencyClientId,
      companyContextId,
      membershipId,
    );
    await this.previewEventsRepo.save(
      this.previewEventsRepo.create({
        tenantId,
        workspaceId,
        agencyClientId,
        companyContextId,
        agencyActorUserId: actorUserId,
        targetMembershipId: resolved.membership.id,
        action,
      }),
    );
    return { preview: resolved.preview };
  }

  /**
   * Read-only refresh of the same projection `preview()` returns, without
   * writing an audit row. Used by the preview renderer while navigating so
   * every internal page revalidates the membership/company/app chain
   * without generating `preview_started`/`preview_ended` noise per page.
   */
  async previewContext(
    tenantId: string,
    workspaceId: string,
    agencyClientId: string,
    companyContextId: string,
    membershipId: string,
  ) {
    const resolved = await this.resolvePreviewProjection(
      tenantId,
      workspaceId,
      agencyClientId,
      companyContextId,
      membershipId,
    );
    return { preview: resolved.preview };
  }

  /**
   * AP3 §42/§43 — the membership/company a preview may read, re-validated by
   * the same chain `previewContext` runs. Returns the scope of a *module*
   * read inside the preview plus the target's own permissions, so a preview
   * of a viewer renders as a viewer. Read-only by construction: this returns
   * a scope, and no Client Area mutation accepts one (they all require a
   * `ClientAreaContext`, which only the Client Area guards can produce).
   */
  async previewModuleScope(
    tenantId: string,
    workspaceId: string,
    agencyClientId: string,
    companyContextId: string,
    membershipId: string,
  ) {
    const resolved = await this.resolvePreviewProjection(
      tenantId,
      workspaceId,
      agencyClientId,
      companyContextId,
      membershipId,
    );
    return {
      scope: {
        tenantId,
        workspaceId,
        agencyClientId,
        companyContextId,
      },
      membership: resolved.membership,
      modules: resolved.preview.modules,
      permissions: permissionsForClientAreaRole(resolved.membership.role),
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
    if (!isActiveCompany(context))
      throw new NotFoundException('Company is not available.');
    const [client, organization] = await Promise.all([
      this.clientsRepo.findOne({
        where: { id: agencyClientId, tenantId, workspaceId },
      }),
      this.contactsRepo.findOne({
        where: { id: context.companyContactId, tenantId, workspaceId },
      }),
    ]);
    if (
      !isActiveClient(client) ||
      !isAvailableOrganization(organization) ||
      organization.status !== 'active'
    )
      throw new NotFoundException('Company is not available.');
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
