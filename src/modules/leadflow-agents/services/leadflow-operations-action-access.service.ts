import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../auth/types/authenticated-request.type';
import { projectAgencyPermissions } from '../../client-area/client-area-agency-permission-projection';
import type {
  ClientAreaContext,
  ClientAreaModuleKey,
  ClientAreaRequest,
} from '../../client-area/client-area.types';
import { PermissionScopeEvaluatorService } from '../../permissions/services/permission-scope-evaluator.service';
import { PlatformPermissionService } from '../../permissions/services/platform-permission.service';
import type { PermissionContext } from '../../permissions/types/permission-context.types';
import type { LeadFlowOperationsActionIntent } from '../entities';
import { LEADFLOW_AGENTS_PERMISSIONS } from '../leadflow-agents.permissions';

/**
 * Who proposes or confirms, as proven by the JWT and the guards of the room
 * routes (same shape as the Orion's principal). Built only by a controller
 * from the request; never from the body or the proposal payload.
 */
export type LeadFlowActionAccess =
  | { kind: 'agency'; permission: PermissionContext }
  | { kind: 'client_area'; context: ClientAreaContext };

type RouteCheck = {
  method: 'POST' | 'PATCH';
  routePath: string;
  params: Record<string, string>;
};

/**
 * The route an OR5 intent stands in for. The confirmation calls the domain
 * service directly, so the `PermissionsGuard` of that route never runs; this
 * is the same requirement, per surface.
 */
export type LeadFlowActionRequirement = {
  agency: RouteCheck & { anyOf: readonly string[] };
  clientArea: RouteCheck & { module: ClientAreaModuleKey; key: string };
};

const CRM_UPDATE = [
  'leadflow.crm.records.update.assigned',
  'leadflow.crm.records.update.client',
] as const;
const CONTACT_UPDATE = [
  'shared.contacts.update.assigned',
  'shared.contacts.update.client',
] as const;

/**
 * OR5 — the permission each executable intent needs from the person who
 * confirms it (and, to be offered at all, from the person who proposes it).
 * `targetId` is the resolved record (agent, opportunity, contact); `company`
 * is whether the request runs in a company context (the contact routes
 * differ). `null`: the intent has no domain execution (legacy rules).
 */
export function operationsActionRequirement(
  intent: LeadFlowOperationsActionIntent,
  targetId: string | null,
  company: boolean,
): LeadFlowActionRequirement | null {
  const id = targetId ?? '';
  switch (intent) {
    case 'pause_agent':
    case 'activate_agent': {
      const pause = intent === 'pause_agent';
      const key = pause
        ? LEADFLOW_AGENTS_PERMISSIONS.pause
        : LEADFLOW_AGENTS_PERMISSIONS.activate;
      const route: RouteCheck = {
        method: 'POST',
        routePath: `/leadflow/agents/:id/${pause ? 'pause' : 'activate'}`,
        params: { id },
      };
      return {
        agency: { ...route, anyOf: [key] },
        clientArea: { ...route, module: 'leadflow_agents', key },
      };
    }
    case 'create_contact': {
      const route: RouteCheck = {
        method: 'POST',
        routePath: company
          ? '/agency/contacts/leadflow/company-contacts'
          : '/agency/contacts/leadflow',
        params: {},
      };
      return {
        agency: { ...route, anyOf: ['shared.contacts.create'] },
        clientArea: {
          ...route,
          module: 'leadflow_crm',
          key: 'shared.contacts.create',
        },
      };
    }
    case 'update_contact_fields': {
      const route: RouteCheck = {
        method: 'PATCH',
        routePath: company
          ? '/agency/contacts/leadflow/company-contacts/:contactId'
          : '/agency/contacts/:contactId',
        params: { contactId: id },
      };
      return {
        agency: { ...route, anyOf: CONTACT_UPDATE },
        clientArea: {
          ...route,
          module: 'leadflow_crm',
          key: 'shared.contacts.update.client',
        },
      };
    }
    case 'move_opportunity': {
      const route: RouteCheck = {
        method: 'PATCH',
        routePath: '/crm/opportunities/:id/stage',
        params: { id },
      };
      return {
        agency: { ...route, anyOf: CRM_UPDATE },
        clientArea: {
          ...route,
          module: 'leadflow_crm',
          key: 'leadflow.crm.records.update.client',
        },
      };
    }
    case 'create_appointment': {
      const route: RouteCheck = {
        method: 'POST',
        routePath: '/leadflow/agenda/v1/appointments',
        params: {},
      };
      const key = 'leadflow.appointments.item.create.client';
      return {
        agency: { ...route, anyOf: [key] },
        clientArea: { ...route, module: 'leadflow_appointments', key },
      };
    }
    default:
      return null;
  }
}

/**
 * OR5 — the explicit permission check of a proposal's execution, with the
 * formula of the `PermissionsGuard` (the same as the Orion's read tools):
 *
 * - Agency: `PlatformPermissionService.assertAny` (key held + resource scope,
 *   denial audited).
 * - Client Area: the module available to the member, the level projecting
 *   the key for the method, and the bridge scope resolver proving the
 *   company (and, for `created_by_me` grants, the authorship) of the record.
 */
@Injectable()
export class LeadFlowOperationsActionAccessService {
  constructor(
    private readonly permissions: PlatformPermissionService,
    private readonly scopes: PermissionScopeEvaluatorService,
  ) {}

  async assert(
    access: LeadFlowActionAccess,
    requirement: LeadFlowActionRequirement,
    body: Record<string, unknown> | null = null,
  ): Promise<void> {
    if (access.kind === 'agency') {
      const { anyOf, method, routePath, params } = requirement.agency;
      await this.permissions.assertAny(access.permission, [...anyOf], {
        method,
        routePath,
        params,
        query: {},
        body,
      });
      return;
    }

    const { module, key, method, routePath, params } = requirement.clientArea;
    const member = access.context.memberAccess?.[module];
    if (!member?.available) throw new ForbiddenException('Not available.');
    const grant = projectAgencyPermissions(module, member.level).find(
      (candidate) =>
        candidate.key === key && candidate.methods.includes(method),
    );
    if (!grant) throw new ForbiddenException('Insufficient module level.');
    await this.scopes.assertClientAreaScope(
      access.context,
      module,
      key,
      { method, routePath, params, query: {}, body },
      grant.scope === 'created_by_me',
    );
  }
}

/** The principal of a room request, from the authenticated request only. */
export function leadFlowActionAccessOf(
  request: AuthenticatedRequest & ClientAreaRequest,
): LeadFlowActionAccess {
  const user = request.user;
  if (user?.surface === 'client_area') {
    if (!request.clientAreaContext)
      throw new ForbiddenException('Client Area action is not allowed.');
    return { kind: 'client_area', context: request.clientAreaContext };
  }
  return {
    kind: 'agency',
    permission: {
      tenantId: user.tenantId,
      workspaceId: user.workspaceId,
      userId: user.sub,
      role: user.role,
    },
  };
}
