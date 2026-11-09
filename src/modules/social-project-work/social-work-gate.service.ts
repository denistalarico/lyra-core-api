import { ForbiddenException, Injectable } from '@nestjs/common';
import type { CompanyAwareScope } from '../../common/context/company-aware-scope';
import type { RequestContext } from '../../common/context/request-context.interface';
import { ManagedContextDirectoryService } from '../../common/context/managed-context-directory.service';
import { PlatformPermissionService } from '../permissions';

export type SocialWorkCompany = { id: string; name: string };

export function permissionIdentity(ctx: RequestContext) {
  return {
    tenantId: ctx.tenantId,
    workspaceId: ctx.workspaceId,
    userId: ctx.userId ?? '',
    role: ctx.role ?? 'member',
  };
}

export function socialNotContracted() {
  return new ForbiddenException({
    statusCode: 403,
    error: 'Forbidden',
    code: 'social_not_contracted',
    message: 'O Social não está contratado para este cliente.',
  });
}

/**
 * R-11 — the integration only exists where Social does. Authorized clients and
 * companies come from the managed-context directory, the same source as the
 * context switcher, so what is offered here matches what the Social surfaces
 * would let this person operate.
 */
@Injectable()
export class SocialWorkGateService {
  constructor(
    private readonly permissions: PlatformPermissionService,
    private readonly directory: ManagedContextDirectoryService,
  ) {}

  /** `client_id IS NULL` is the agency's own Social (D-27). */
  async ownAvailable(ctx: RequestContext): Promise<boolean> {
    const identity = permissionIdentity(ctx);
    const [entitled, moduleAccess] = await Promise.all([
      this.permissions.canAccessProduct(identity, 'social'),
      this.permissions.getModuleAccess(identity),
    ]);
    return entitled && moduleAccess.social !== null;
  }

  async companiesOf(
    ctx: RequestContext,
    clientId: string,
  ): Promise<SocialWorkCompany[]> {
    const clients = await this.directory.listAuthorizedClients(
      permissionIdentity(ctx),
      'social',
    );
    return (
      clients
        .find((client) => client.clientId === clientId)
        ?.companies.map((company) => ({
          id: company.companyContextId,
          name: company.displayName,
        })) ?? []
    );
  }

  async scopeAvailable(
    ctx: RequestContext,
    scope: CompanyAwareScope,
  ): Promise<boolean> {
    if (!scope.agencyClientId) return this.ownAvailable(ctx);
    const companies = await this.companiesOf(ctx, scope.agencyClientId);
    return companies.some((company) => company.id === scope.companyContextId);
  }

  async assertScope(
    ctx: RequestContext,
    scope: CompanyAwareScope,
  ): Promise<void> {
    if (!(await this.scopeAvailable(ctx, scope))) throw socialNotContracted();
  }
}
