// src/common/context/managed-context-directory.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type FindOptionsWhere, In, IsNull, Not, Repository } from 'typeorm';
import { AgencyClient } from '../../modules/clients/entities';
import { AgencyClientStatus } from '../../modules/clients/enums';
import { AgencyClientCompanyContext } from '../../modules/clients/entities/agency-client-company-context.entity';
import { ContactEntity } from '../../modules/contacts/entities/contact.entity';
import { AgencyClientAccessEntity } from '../../modules/permissions/entities/agency-client-access.entity';
import { AgencyClientProductAccessEntity } from '../../modules/permissions/entities/agency-client-product-access.entity';
import {
  CLIENT_PRODUCT_ROLE_ORDER,
  ClientProductRoleKey,
  PlatformRoleKey,
} from '../../modules/permissions/enums/permission.enums';
// Imported from the concrete files instead of the `platform` barrel: the
// barrel re-exports `PlatformModule`, whose provider now depends on this
// service, which would close a runtime import cycle.
import { TenantProductEntitlementEntity } from '../../modules/platform/entities/tenant-product-entitlement.entity';
import { PlatformProductKey } from '../../modules/platform/enums/platform-product.enums';
import {
  ActiveManagedContextResolution,
  AuthorizedManagedCompany,
  AuthorizedManagedClient,
  buildAgencyActiveContext,
  isManagedClientProductKey,
  ManagedContextIdentity,
  ManagedContextRejectionCode,
  RequestedManagedContext,
} from './managed-context.contract';
import { isActiveProductEntitlement } from './product-entitlement-availability';

const AGENCY_CONNECTION = 'agency';

const CLIENT_PRODUCT_KEYS = new Set<string>([
  PlatformProductKey.LeadFlow,
  PlatformProductKey.Social,
]);

function normalizeRole(role: string): PlatformRoleKey {
  if (role === 'owner') return PlatformRoleKey.Owner;
  if (role === 'admin' || role === 'administrator')
    return PlatformRoleKey.Admin;
  if (role === 'manager') return PlatformRoleKey.Manager;
  return PlatformRoleKey.Member;
}

export interface ManagedClientAccessCheck extends ManagedContextIdentity {
  clientId: string;
  productKey: string;
  requiredRole?: ClientProductRoleKey;
}

/**
 * Single source of truth for managed-company authorization (LF-RF-F12-001).
 *
 * Both the permission guard (`PlatformPermissionService`) and the shell
 * context endpoint (`PlatformContextService`) answer "may this person operate
 * this product for this company?" — before this service they would have had
 * to answer it twice, and the Portal would have been a third copy. It lives
 * in `common/context` because `PermissionsModule` already imports
 * `PlatformModule`: putting it in either of those would create a cycle.
 *
 * Authorization is cumulative and deny-by-default (blueprint section 11):
 * active client → active entitlement on the *managed* tenant → explicit
 * client grant → explicit client/product grant. Owner and admin of the
 * agency skip the two explicit grants (they administer the tenant) but never
 * skip the entitlement.
 */
@Injectable()
export class ManagedContextDirectoryService {
  constructor(
    @InjectRepository(AgencyClient, AGENCY_CONNECTION)
    private readonly clientsRepository: Repository<AgencyClient>,
    @InjectRepository(AgencyClientCompanyContext, AGENCY_CONNECTION)
    private readonly companyContextsRepository: Repository<AgencyClientCompanyContext>,
    @InjectRepository(ContactEntity, AGENCY_CONNECTION)
    private readonly contactsRepository: Repository<ContactEntity>,
    @InjectRepository(TenantProductEntitlementEntity, AGENCY_CONNECTION)
    private readonly entitlementsRepository: Repository<TenantProductEntitlementEntity>,
    @InjectRepository(AgencyClientAccessEntity, AGENCY_CONNECTION)
    private readonly clientAccessRepository: Repository<AgencyClientAccessEntity>,
    @InjectRepository(AgencyClientProductAccessEntity, AGENCY_CONNECTION)
    private readonly clientProductAccessRepository: Repository<AgencyClientProductAccessEntity>,
  ) {}

  /**
   * Checks whether the caller can operate a product contracted by a managed
   * client (blueprint sections 8.3 and 10/11).
   */
  async canAccessClientProduct(
    check: ManagedClientAccessCheck,
  ): Promise<boolean> {
    const roleKey = normalizeRole(check.role);

    if (
      !check.tenantId ||
      !check.workspaceId ||
      !check.clientId ||
      !check.userId ||
      !CLIENT_PRODUCT_KEYS.has(check.productKey)
    ) {
      return false;
    }

    const client = await this.clientsRepository.findOne({
      where: {
        id: check.clientId,
        tenantId: check.tenantId,
        workspaceId: check.workspaceId,
      },
    });

    if (
      !client ||
      client.status !== AgencyClientStatus.Active ||
      client.archivedAt ||
      !client.managedTenantId
    ) {
      return false;
    }

    const entitlement = await this.entitlementsRepository.findOne({
      where: {
        tenantId: client.managedTenantId,
        productKey: check.productKey as PlatformProductKey,
      },
    });

    if (!isActiveProductEntitlement(entitlement)) {
      return false;
    }

    if (
      roleKey === PlatformRoleKey.Owner ||
      roleKey === PlatformRoleKey.Admin
    ) {
      return true;
    }

    const clientAccessWhere: FindOptionsWhere<AgencyClientAccessEntity> = {
      tenantId: check.tenantId,
      clientId: check.clientId,
      userId: check.userId,
      workspaceId: check.workspaceId,
    };

    const clientAccess = await this.clientAccessRepository.findOne({
      where: clientAccessWhere,
    });

    if (
      !clientAccess ||
      clientAccess.managedTenantId !== client.managedTenantId
    ) {
      return false;
    }

    const where: FindOptionsWhere<AgencyClientProductAccessEntity> = {
      tenantId: check.tenantId,
      workspaceId: check.workspaceId,
      clientId: check.clientId,
      managedTenantId: client.managedTenantId,
      productKey:
        check.productKey as AgencyClientProductAccessEntity['productKey'],
      userId: check.userId,
    };

    const access = await this.clientProductAccessRepository.findOne({
      where,
    });

    if (!access) {
      return false;
    }

    if (!check.requiredRole) {
      return true;
    }

    const requiredIndex = CLIENT_PRODUCT_ROLE_ORDER.indexOf(check.requiredRole);
    const grantedIndex = CLIENT_PRODUCT_ROLE_ORDER.indexOf(access.roleKey);

    return grantedIndex >= requiredIndex;
  }

  /**
   * Lists the managed clients the caller is authorized to operate a given
   * product in. No client is ever returned solely because it belongs to the
   * tenant (blueprint sections 8.3, 9.6 and 12.6).
   */
  async listAuthorizedClients(
    context: ManagedContextIdentity,
    productKey: string,
  ): Promise<AuthorizedManagedClient[]> {
    if (!context.workspaceId || !CLIENT_PRODUCT_KEYS.has(productKey)) {
      return [];
    }

    const clients = await this.clientsRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        status: AgencyClientStatus.Active,
        archivedAt: IsNull(),
      },
    });

    const managedTenantIds = [
      ...new Set(
        clients
          .map((client) => client.managedTenantId)
          .filter((managedTenantId): managedTenantId is string =>
            Boolean(managedTenantId),
          ),
      ),
    ];

    if (managedTenantIds.length === 0) {
      return [];
    }

    const entitlements = await this.entitlementsRepository.find({
      where: {
        tenantId: In(managedTenantIds),
        productKey: productKey as PlatformProductKey,
      },
    });

    const entitlementByManagedTenantId = new Map(
      entitlements.map((entitlement) => [entitlement.tenantId, entitlement]),
    );

    const roleKey = normalizeRole(context.role);
    const isPrivileged =
      roleKey === PlatformRoleKey.Owner || roleKey === PlatformRoleKey.Admin;

    let accessByClientId: Map<string, AgencyClientAccessEntity> | null = null;
    let productAccessByClientId: Map<
      string,
      AgencyClientProductAccessEntity
    > | null = null;

    if (!isPrivileged) {
      const clientIds = clients.map((client) => client.id);

      const [accessRows, productAccessRows] = await Promise.all([
        this.clientAccessRepository.find({
          where: {
            tenantId: context.tenantId,
            workspaceId: context.workspaceId,
            userId: context.userId,
            clientId: In(clientIds),
          },
        }),
        this.clientProductAccessRepository.find({
          where: {
            tenantId: context.tenantId,
            workspaceId: context.workspaceId,
            userId: context.userId,
            clientId: In(clientIds),
            productKey:
              productKey as AgencyClientProductAccessEntity['productKey'],
          },
        }),
      ]);

      accessByClientId = new Map(accessRows.map((row) => [row.clientId, row]));
      productAccessByClientId = new Map(
        productAccessRows.map((row) => [row.clientId, row]),
      );
    }

    const entries: AuthorizedManagedClient[] = [];

    for (const client of clients) {
      if (!client.managedTenantId) continue;

      const entitlement =
        entitlementByManagedTenantId.get(client.managedTenantId) ?? null;

      if (!isActiveProductEntitlement(entitlement)) continue;

      if (!isPrivileged) {
        const access = accessByClientId?.get(client.id);
        const productAccess = productAccessByClientId?.get(client.id);

        if (!access || access.managedTenantId !== client.managedTenantId) {
          continue;
        }

        if (
          !productAccess ||
          productAccess.managedTenantId !== client.managedTenantId
        ) {
          continue;
        }
      }

      entries.push({
        clientId: client.id,
        displayName: client.displayName,
        avatarUrl: this.extractClientAvatarUrl(client),
        status: client.status,
        managedTenantId: client.managedTenantId,
        companies: [],
        entitlement: {
          status: entitlement!.status,
          planKey: entitlement!.planKey,
          source: entitlement!.source,
          startsAt: this.toIsoStringOrNull(entitlement!.startsAt),
          endsAt: this.toIsoStringOrNull(entitlement!.endsAt),
          trialEndsAt: this.toIsoStringOrNull(entitlement!.trialEndsAt),
        },
      });
    }

    entries.sort((a, b) => a.displayName.localeCompare(b.displayName));

    return this.attachActiveCompanies(entries, context);
  }

  /**
   * Resolves the context a request actually operates in, given what the
   * client asked for through headers.
   *
   * Fail-closed: anything that cannot be proven authorized falls back to the
   * agency context and reports why. The caller never receives a client
   * context it did not earn, and never receives an error for merely holding
   * a stale selection.
   */
  async resolveActiveContext(
    context: ManagedContextIdentity,
    requested: RequestedManagedContext,
  ): Promise<ActiveManagedContextResolution> {
    const productKey = requested.productKey ?? 'agency';

    if (requested.operatingMode !== 'client') {
      return {
        active: buildAgencyActiveContext(productKey),
        requested,
        rejection: null,
      };
    }

    const reject = (code: ManagedContextRejectionCode) => ({
      active: buildAgencyActiveContext(productKey),
      requested,
      rejection: {
        code,
        requestedClientId: requested.clientId,
        requestedCompanyContextId: requested.companyContextId,
        requestedProductKey: requested.productKey,
      },
    });

    if (!isManagedClientProductKey(productKey)) {
      return reject('product_not_client_scoped');
    }

    if (!context.workspaceId) {
      return reject('workspace_missing');
    }

    if (!requested.clientId) {
      return reject(
        requested.companyContextId
          ? 'company_context_client_id_missing'
          : 'client_id_missing',
      );
    }

    const authorized = await this.canAccessClientProduct({
      ...context,
      clientId: requested.clientId,
      productKey,
    });

    if (!authorized) {
      return reject('context_not_authorized');
    }

    const client = await this.clientsRepository.findOne({
      where: {
        id: requested.clientId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    // `canAccessClientProduct` already proved the client exists with a
    // managed tenant; this guards against a concurrent archive between the
    // two reads rather than re-deciding authorization.
    if (!client?.managedTenantId) {
      return reject('context_not_authorized');
    }

    let companyContextId: string | null = null;
    if (requested.companyContextId) {
      const companyContext = await this.companyContextsRepository.findOne({
        where: {
          id: requested.companyContextId,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          agencyClientId: client.id,
        },
      });

      // A missing row intentionally groups nonexistent, foreign-client,
      // cross-tenant, and cross-workspace ids into one non-disclosing result.
      if (
        !companyContext ||
        companyContext.agencyClientId !== client.id ||
        companyContext.tenantId !== context.tenantId ||
        companyContext.workspaceId !== context.workspaceId
      ) {
        return reject('company_context_not_available');
      }
      if (companyContext.status === 'archived' || companyContext.archivedAt) {
        return reject('company_context_archived');
      }
      if (companyContext.status !== 'active') {
        return reject('company_context_inactive');
      }

      const companyContact = await this.contactsRepository.findOne({
        where: {
          id: companyContext.companyContactId,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          type: 'organization',
          status: Not('archived'),
        },
      });
      if (!companyContact) return reject('company_context_not_available');
      if (
        companyContact.tenantId !== context.tenantId ||
        companyContact.workspaceId !== context.workspaceId ||
        companyContact.type !== 'organization' ||
        companyContact.status === 'archived'
      ) {
        return reject('company_context_not_available');
      }

      companyContextId = companyContext.id;
    }

    return {
      active: {
        kind: 'client',
        productKey,
        clientId: client.id,
        companyContextId,
        managedTenantId: client.managedTenantId,
        displayName: client.displayName,
      },
      requested,
      rejection: null,
    };
  }

  private async attachActiveCompanies(
    clients: AuthorizedManagedClient[],
    context: ManagedContextIdentity,
  ): Promise<AuthorizedManagedClient[]> {
    if (clients.length === 0 || !context.workspaceId) return clients;

    const clientIds = clients.map((client) => client.clientId);
    const companyContexts = await this.companyContextsRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        agencyClientId: In(clientIds),
        status: 'active',
        archivedAt: IsNull(),
      },
      order: { isPrimary: 'DESC', createdAt: 'ASC' },
    });
    const validContextRows = companyContexts.filter(
      (companyContext) =>
        companyContext.tenantId === context.tenantId &&
        companyContext.workspaceId === context.workspaceId &&
        companyContext.status === 'active' &&
        !companyContext.archivedAt &&
        clients.some(
          (client) => client.clientId === companyContext.agencyClientId,
        ),
    );

    const contacts = validContextRows.length
      ? await this.contactsRepository.find({
          where: {
            id: In(
              validContextRows.map(
                (companyContext) => companyContext.companyContactId,
              ),
            ),
            tenantId: context.tenantId,
            workspaceId: context.workspaceId,
            type: 'organization',
            status: Not('archived'),
          },
        })
      : [];
    const contactsById = new Map(
      contacts
        .filter(
          (contact) =>
            contact.tenantId === context.tenantId &&
            contact.workspaceId === context.workspaceId &&
            contact.type === 'organization' &&
            contact.status !== 'archived',
        )
        .map((contact) => [contact.id, contact]),
    );
    const companiesByClientId = new Map<string, AuthorizedManagedCompany[]>();

    for (const companyContext of validContextRows) {
      const company = contactsById.get(companyContext.companyContactId);
      if (!company) continue;

      const companies =
        companiesByClientId.get(companyContext.agencyClientId) ?? [];
      companies.push({
        companyContextId: companyContext.id,
        companyContactId: company.id,
        displayName: company.displayName,
        legalName: company.legalName,
        isPrimary: companyContext.isPrimary,
      });
      companiesByClientId.set(companyContext.agencyClientId, companies);
    }

    return clients.map((client) => ({
      ...client,
      companies: companiesByClientId.get(client.clientId) ?? [],
    }));
  }

  private extractClientAvatarUrl(client: AgencyClient): string | null {
    const contactAvatarUrl = client.metadata?.contactAvatarUrl;

    return typeof contactAvatarUrl === 'string' && contactAvatarUrl.trim()
      ? contactAvatarUrl
      : null;
  }

  private toIsoStringOrNull(value: Date | null): string | null {
    return value ? value.toISOString() : null;
  }
}
