import { Injectable } from '@nestjs/common';
import type {
  ClientAreaContext,
  ClientAreaIdentity,
} from '../client-area.types';
import { ClientAreaAuthService } from './client-area-auth.service';
import { ClientAreaAuthorizationService } from './client-area-authorization.service';
import { ClientAreaManagementService } from './client-area-management.service';

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

  async projectContext(context: ClientAreaContext): Promise<ClientAreaContextProjection> {
    return {
      companyContextId: context.companyContextId,
      displayName: context.companyDisplayName,
      role: context.role,
      permissions: [...context.permissions].sort(),
      modules: { approvals: context.modules.approvals },
      branding: await this.management.branding(context.tenantId, context.workspaceId),
    };
  }
}
