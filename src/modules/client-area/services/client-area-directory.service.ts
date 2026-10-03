import { Injectable } from '@nestjs/common';
import {
  AGENCY_SELF_CONTEXT_ID,
  type ClientAreaContext,
  type ClientAreaIdentity,
  type ClientAreaRole,
  type ClientAreaSelfContext,
} from '../client-area.types';
import { ClientAreaAuthService } from './client-area-auth.service';
import { ClientAreaAuthorizationService } from './client-area-authorization.service';
import { ClientAreaManagementService } from './client-area-management.service';
import { ClientAreaSelfAccessService } from './client-area-self-access.service';

export type ClientAreaCompanyListItem = {
  companyContextId: string;
  displayName: string;
  role: ClientAreaContext['role'];
};

export type ClientAreaContextProjection = {
  companyContextId: string;
  displayName: string;
  role: ClientAreaContext['role'];
  permissions: string[];
  modules: ClientAreaContext['modules'];
  branding: Awaited<ReturnType<ClientAreaManagementService['branding']>>;
};

/**
 * PD3 §16 — the directory entry of either kind. `kind` is the discriminator;
 * `companyContextId` is present only for `kind: 'company'`, so the agency
 * self-context never travels as a company id.
 */
export type ClientAreaDirectoryEntry =
  | {
      kind: 'company';
      contextId: string;
      companyContextId: string;
      displayName: string;
      role: ClientAreaContext['role'];
    }
  | {
      kind: 'agency_self';
      contextId: typeof AGENCY_SELF_CONTEXT_ID;
      displayName: string;
      role: ClientAreaRole;
    };

export type ClientAreaSelfContextProjection = {
  kind: typeof AGENCY_SELF_CONTEXT_ID;
  displayName: string;
  role: ClientAreaRole;
  permissions: string[];
  modules: ClientAreaSelfContext['modules'];
  branding: Awaited<ReturnType<ClientAreaManagementService['branding']>>;
};

/**
 * CA1 — "which companies may this person represent?".
 *
 * Deliberately not `ManagedContextDirectoryService`: that one starts from
 * `workspace_users.role`, bypasses grants for Owner/Admin and answers "which
 * clients may this operator operate". Here the only source is the person's
 * own active memberships; sharing a tenant or an Agency Client with another
 * company never widens the list.
 *
 * Projections are built field by field (portal-public.view pattern): no
 * tenant/workspace/Agency Client ids, managed tenant or Agency labels.
 */
@Injectable()
export class ClientAreaDirectoryService {
  constructor(
    private readonly authorization: ClientAreaAuthorizationService,
    private readonly auth: ClientAreaAuthService,
    private readonly management: ClientAreaManagementService,
    private readonly selfAccess: ClientAreaSelfAccessService,
  ) {}

  async me(identity: ClientAreaIdentity) {
    const memberships =
      await this.authorization.listActiveMemberships(identity);

    return {
      user: await this.auth.buildUserResponse({
        tenantId: identity.tenantId,
        userId: identity.userId,
        currentEmail: identity.email,
      }),
      activeMembershipCount: memberships.length,
      // PD3 — lets the shell know a self-context exists without a second
      // round trip. Additive: CA1 clients ignore it.
      hasAgencySelfContext: await this.selfAccess.hasActiveSelfAccess(identity),
    };
  }

  /**
   * PD3 §16/§17 — the union directory. `/companies` keeps its exact CA1
   * contract for the existing frontend; this is the additive endpoint that
   * can also carry the agency self-context.
   */
  async listContexts(
    identity: ClientAreaIdentity,
  ): Promise<ClientAreaDirectoryEntry[]> {
    const companies = await this.listCompanies(identity);
    const entries: ClientAreaDirectoryEntry[] = companies.map((company) => ({
      kind: 'company' as const,
      contextId: company.companyContextId,
      companyContextId: company.companyContextId,
      displayName: company.displayName,
      role: company.role,
    }));

    const self = await this.selfAccess.resolveSelfContext(identity);
    if (self) {
      // The agency's own context leads the list: it is the person's own
      // organization, not one of the clients it is sorted among.
      entries.unshift({
        kind: AGENCY_SELF_CONTEXT_ID,
        contextId: AGENCY_SELF_CONTEXT_ID,
        displayName: self.agencyDisplayName,
        role: self.role,
      });
    }

    return entries;
  }

  async projectSelfContext(
    context: ClientAreaSelfContext,
  ): Promise<ClientAreaSelfContextProjection> {
    return {
      kind: AGENCY_SELF_CONTEXT_ID,
      displayName: context.agencyDisplayName,
      role: context.role,
      permissions: [...context.permissions].sort(),
      modules: {
        approvals: context.modules.approvals,
        conversations: context.modules.conversations,
      },
      // §32 — the self Client Area wears the agency's own branding, reusing
      // the PD1-corrected resolver. No separate self branding.
      branding: await this.management.branding(
        context.tenantId,
        context.workspaceId,
      ),
    };
  }

  async listCompanies(
    identity: ClientAreaIdentity,
  ): Promise<ClientAreaCompanyListItem[]> {
    const memberships =
      await this.authorization.listActiveMemberships(identity);
    const contexts = await Promise.all(
      memberships.map((membership) =>
        this.authorization.resolveMembershipContext(membership, identity),
      ),
    );

    return contexts
      .filter((context): context is ClientAreaContext => context !== null)
      .map((context) => ({
        companyContextId: context.companyContextId,
        displayName: context.companyDisplayName,
        role: context.role,
      }))
      .sort(
        (left, right) =>
          left.displayName.localeCompare(right.displayName, 'pt-BR') ||
          left.companyContextId.localeCompare(right.companyContextId),
      );
  }

  async projectContext(
    context: ClientAreaContext,
  ): Promise<ClientAreaContextProjection> {
    return {
      companyContextId: context.companyContextId,
      displayName: context.companyDisplayName,
      role: context.role,
      permissions: [...context.permissions].sort(),
      modules: {
        approvals: context.modules.approvals,
        conversations: context.modules.conversations,
      },
      branding: await this.management.branding(
        context.tenantId,
        context.workspaceId,
      ),
    };
  }
}
