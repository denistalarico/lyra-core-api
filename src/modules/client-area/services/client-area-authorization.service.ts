import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { isActiveProductEntitlement } from '../../../common/context/product-entitlement-availability';
import { AgencyClient } from '../../clients/entities/agency-client.entity';
import { AgencyClientCompanyContext } from '../../clients/entities/agency-client-company-context.entity';
import { AgencyClientStatus } from '../../clients/enums';
import { ContactEntity } from '../../contacts/entities/contact.entity';
import { TenantProductEntitlementEntity } from '../../platform/entities/tenant-product-entitlement.entity';
import { PlatformProductKey } from '../../platform/enums/platform-product.enums';
import { permissionsForClientAreaRole } from '../client-area-permissions.catalog';
import {
  CLIENT_AREA_ERROR_CODES,
  isClientAreaRole,
  isUuid,
  type ClientAreaContext,
  type ClientAreaIdentity,
  type ClientAreaModuleKey,
  type ClientAreaModules,
  type ClientAreaPermissionKey,
} from '../client-area.types';
import { ClientAreaMembershipEntity } from '../entities/client-area-membership.entity';

const AGENCY_CONNECTION = 'agency';

/** Which contracted product makes each Client Area module available. */
const MODULE_PRODUCT: Record<ClientAreaModuleKey, PlatformProductKey> = {
  approvals: PlatformProductKey.Social,
};

export type AuthorizeClientAreaInput = {
  identity: ClientAreaIdentity;
  /** Requested id from the path. Untrusted until a membership matches it. */
  companyContextId: unknown;
  module?: ClientAreaModuleKey | null;
  permission?: ClientAreaPermissionKey | null;
  now?: Date;
};

function companyNotFound() {
  // One generic answer for "no membership", "revoked", "other company",
  // "archived company/client" and malformed ids: nothing is enumerable.
  return new NotFoundException({
    statusCode: 404,
    error: 'Not Found',
    message: 'Company is not available.',
    code: CLIENT_AREA_ERROR_CODES.companyNotFound,
  });
}

/**
 * CA1 — Client Area authorization (CA0 §J), evaluated per request.
 *
 *   authenticated identity (live session, checked by ClientAreaAuthGuard)
 *   AND active membership (user, company from the path)
 *   AND Company Context active + not archived
 *   AND organization Contact valid + not archived (same tenant/workspace)
 *   AND Agency Client active + not archived
 *   AND module available (entitlement of the managed tenant)
 *   AND role preset grants the permission
 *
 * The Company Context checks mirror `OperationalContextResolver`; what
 * differs is the source of human authorization — the membership, never
 * `workspace_users.role`, Agency grants or `ManagedContextDirectoryService`.
 * There is no bypass for any role.
 */
@Injectable()
export class ClientAreaAuthorizationService {
  constructor(
    @InjectRepository(ClientAreaMembershipEntity, AGENCY_CONNECTION)
    private readonly membershipsRepo: Repository<ClientAreaMembershipEntity>,
    @InjectRepository(AgencyClientCompanyContext, AGENCY_CONNECTION)
    private readonly companyContextsRepo: Repository<AgencyClientCompanyContext>,
    @InjectRepository(ContactEntity, AGENCY_CONNECTION)
    private readonly contactsRepo: Repository<ContactEntity>,
    @InjectRepository(AgencyClient, AGENCY_CONNECTION)
    private readonly clientsRepo: Repository<AgencyClient>,
    @InjectRepository(TenantProductEntitlementEntity, AGENCY_CONNECTION)
    private readonly entitlementsRepo: Repository<TenantProductEntitlementEntity>,
  ) {}

  async authorize(input: AuthorizeClientAreaInput): Promise<ClientAreaContext> {
    const { identity } = input;

    if (!isUuid(input.companyContextId)) {
      throw companyNotFound();
    }

    const membership = await this.membershipsRepo.findOne({
      where: {
        tenantId: identity.tenantId,
        userId: identity.userId,
        companyContextId: input.companyContextId,
        status: 'active',
      },
    });

    const context = membership
      ? await this.resolveMembershipContext(membership, identity, input.now)
      : null;

    if (!context) {
      throw companyNotFound();
    }

    if (input.module && !context.modules[input.module]) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: 'This module is not available for the company.',
        code: CLIENT_AREA_ERROR_CODES.moduleUnavailable,
      });
    }

    if (input.permission && !context.permissions.has(input.permission)) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: 'You do not have permission for this action.',
        code: CLIENT_AREA_ERROR_CODES.permissionDenied,
      });
    }

    return context;
  }

  /** Active memberships of the person, in no particular order. */
  listActiveMemberships(
    identity: Pick<ClientAreaIdentity, 'tenantId' | 'userId'>,
  ) {
    return this.membershipsRepo.find({
      where: {
        tenantId: identity.tenantId,
        userId: identity.userId,
        status: 'active',
      },
    });
  }

  /**
   * The full context a membership grants right now, or `null` when any link
   * of the chain (membership, company, organization, Agency Client) is no
   * longer valid. Shared by the guard and the directory so the list of
   * companies and the per-request authorization can never disagree.
   */
  async resolveMembershipContext(
    membership: ClientAreaMembershipEntity,
    identity: ClientAreaIdentity,
    now = new Date(),
  ): Promise<ClientAreaContext | null> {
    if (
      membership.status !== 'active' ||
      membership.tenantId !== identity.tenantId ||
      membership.userId !== identity.userId ||
      !isClientAreaRole(membership.role)
    ) {
      return null;
    }

    const scope = {
      tenantId: membership.tenantId,
      workspaceId: membership.workspaceId,
    };

    const company = await this.companyContextsRepo.findOne({
      where: {
        id: membership.companyContextId,
        ...scope,
        agencyClientId: membership.agencyClientId,
      },
    });

    if (!company || company.status !== 'active' || company.archivedAt) {
      return null;
    }

    const [organization, client] = await Promise.all([
      this.contactsRepo.findOne({
        where: { id: company.companyContactId, ...scope },
      }),
      this.clientsRepo.findOne({
        where: { id: membership.agencyClientId, ...scope },
      }),
    ]);

    if (
      !organization ||
      organization.type !== 'organization' ||
      organization.status === 'archived' ||
      !client ||
      client.status !== AgencyClientStatus.Active ||
      client.archivedAt
    ) {
      return null;
    }

    return {
      surface: 'client_area',
      userId: identity.userId,
      tenantId: identity.tenantId,
      sessionId: identity.sessionId,
      membershipId: membership.id,
      workspaceId: membership.workspaceId,
      agencyClientId: membership.agencyClientId,
      companyContextId: membership.companyContextId,
      companyDisplayName: companyDisplayName(organization),
      role: membership.role,
      permissions: permissionsForClientAreaRole(membership.role),
      modules: await this.resolveModules(client, now),
    };
  }

  private async resolveModules(
    client: AgencyClient,
    now: Date,
  ): Promise<ClientAreaModules> {
    if (!client.managedTenantId) {
      return { approvals: false };
    }

    // Commercial availability only: entitlement lives on the managed tenant of
    // the Agency Client (no company-level entitlement exists, CC2B/CC2H).
    const entitlement = await this.entitlementsRepo.findOne({
      where: {
        tenantId: client.managedTenantId,
        productKey: MODULE_PRODUCT.approvals,
      },
    });

    return { approvals: isActiveProductEntitlement(entitlement, now) };
  }
}

/**
 * Operational company name: the organization Contact, never
 * `AgencyClient.displayName` (an internal commercial label of the agency).
 */
export function companyDisplayName(
  organization: Pick<ContactEntity, 'displayName' | 'legalName'>,
): string {
  return (
    organization.displayName?.trim() ||
    organization.legalName?.trim() ||
    'Empresa'
  );
}
