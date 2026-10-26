import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { projectAgencyPermissions } from '../../client-area/client-area-agency-permission-projection';
import type {
  ClientAreaContext,
  ClientAreaModuleKey,
  ClientAreaModules,
} from '../../client-area/client-area.types';
import { PermissionScopeEvaluatorService } from '../../permissions/services/permission-scope-evaluator.service';
import { PlatformPermissionService } from '../../permissions/services/platform-permission.service';
import type { PermissionContext } from '../../permissions/types/permission-context.types';

/**
 * Who is asking, as proven by the JWT and the guards of `POST /orion/turns`.
 * Built only by the controller from the request; never from the body, never
 * from a tool argument.
 */
export type OrionAccess =
  | {
      kind: 'agency';
      permission: PermissionContext;
      /**
       * OR7 — the answer is visible to a client company (agency↔client
       * chat). Tools then need, besides the Agency key, the route's Client
       * Area exposure and that module enabled for the company: the
       * intersection of what the operator and the client may see (§3.5
       * item 6). Built server-side from the conversation's company.
       */
      clientVisible?: { modules: ClientAreaModules };
    }
  | { kind: 'client_area'; context: ClientAreaContext };

/** Whether the turn's output reaches a client (Client Area or client chat). */
export function isClientVisible(access: OrionAccess): boolean {
  return access.kind === 'client_area' || Boolean(access.clientVisible);
}

/**
 * The read route a tool stands in for. A tool may only do what the equivalent
 * endpoint would let this caller do, so the requirement names that endpoint's
 * keys (Agency) and its exposure on the Client Area bridge (or `null`: the
 * tool does not exist for the client).
 */
export type OrionToolRequirement = {
  /** `method` defaults to GET (read tools); OR5's proposal tool uses POST. */
  agency: { anyOf: readonly string[]; routePath: string; method?: string };
  clientArea: {
    module: ClientAreaModuleKey;
    key: string;
    routePath: string;
    method?: string;
  } | null;
};

/**
 * OR4 — the explicit permission check of every Orion tool.
 *
 * Tools call services directly, so the `PermissionsGuard` of the equivalent
 * route never runs. This service re-applies the same formula the guard does,
 * per surface:
 *
 * - Agency: `PlatformPermissionService.assertAny` — the user must hold one of
 *   the keys (role + tenant overrides + user overrides) and then pass the
 *   `PermissionScopeEvaluatorService` for it. A denial is audited there.
 * - Client Area: the module must be available to the member, the module
 *   level must project the key for GET (`projectAgencyPermissions`), and the
 *   bridge scope resolver must prove the company grain
 *   (`assertClientAreaScope`). No Agency role or Owner shortcut applies.
 *
 * The plan (§3.5) named only the scope evaluator; that service checks the
 * resource scope, not whether the key is held, hence `assertAny` here.
 */
@Injectable()
export class OrionToolAccessService {
  constructor(
    private readonly permissions: PlatformPermissionService,
    private readonly scopes: PermissionScopeEvaluatorService,
  ) {}

  async allowed(
    access: OrionAccess,
    requirement: OrionToolRequirement,
  ): Promise<boolean> {
    try {
      await this.assert(access, requirement);
      return true;
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof NotFoundException
      )
        return false;
      throw error;
    }
  }

  async assert(
    access: OrionAccess,
    requirement: OrionToolRequirement,
  ): Promise<void> {
    if (access.kind === 'agency') {
      if (access.clientVisible) {
        const exposure = requirement.clientArea;
        if (!exposure || !access.clientVisible.modules[exposure.module])
          throw new ForbiddenException('Not available.');
      }
      await this.permissions.assertAny(
        access.permission,
        [...requirement.agency.anyOf],
        {
          method: requirement.agency.method ?? 'GET',
          routePath: requirement.agency.routePath,
          params: {},
          query: {},
          body: null,
        },
      );
      return;
    }

    const exposure = requirement.clientArea;
    if (!exposure) throw new ForbiddenException('Not available.');
    const method = exposure.method ?? 'GET';
    const member = access.context.memberAccess?.[exposure.module];
    if (!member?.available) throw new ForbiddenException('Not available.');
    const grant = projectAgencyPermissions(exposure.module, member.level).find(
      (candidate) =>
        candidate.key === exposure.key && candidate.methods.includes(method),
    );
    if (!grant) throw new ForbiddenException('Insufficient module level.');
    await this.scopes.assertClientAreaScope(
      access.context,
      exposure.module,
      exposure.key,
      {
        method,
        routePath: exposure.routePath,
        params: {},
        query: {},
      },
      grant.scope === 'created_by_me',
    );
  }
}
