import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { Raw } from 'typeorm';
import { AGENCY_SELF_CONTACT_SOURCE } from '../../agency/agency-self-contact';
import { getAuthorizedContext } from '../../../common/context/authorized-context.decorator';
import { hasModuleWideAccess } from '../../../common/context/module-access';
import type { ClientAreaRequest } from '../../client-area/client-area.types';

/**
 * The client a Client Area request is confined to. `null` is the agency in its
 * own Client Area (CA15 / D-CA15-2): internal projects, i.e. no client or the
 * agency's own contact (`contacts.source = 'agency_self'`, 2026-11-25).
 */
export type ProjectClientAreaScope = { agencyClientId: string | null };
export type AuthorizedRequestContext = ReturnType<
  typeof getAuthorizedContext
> & {
  clientArea?: ProjectClientAreaScope;
};
export type ProjectRequestContext = Pick<
  AuthorizedRequestContext,
  'tenantId' | 'workspaceId' | 'userId'
> &
  Partial<
    Pick<AuthorizedRequestContext, 'role' | 'clientArea' | 'moduleAccess'>
  >;

/**
 * Settings > Users: a Member-level user in Projects (outside the Client Area,
 * which has its own rules) creates only for themselves, never re-assigns and
 * deletes only what they created.
 */
export const isNarrowedProjectsMember = (context: ProjectRequestContext) =>
  !context.clientArea && !hasModuleWideAccess(context, 'projects');

/** Only this product carries the verified membership into its existing services. */
export const AuthorizedContext = createParamDecorator(
  (_data: unknown, execution: ExecutionContext): AuthorizedRequestContext => {
    const request = execution.switchToHttp().getRequest<ClientAreaRequest>();
    return {
      ...getAuthorizedContext(request),
      ...(request.clientAreaContext
        ? {
            clientArea: {
              agencyClientId: request.clientAreaContext.agencyClientId,
            },
          }
        : request.clientAreaSelfContext
          ? { clientArea: { agencyClientId: null } }
          : {}),
    };
  },
);
/** The agency's own contact in the request's workspace (see `syncAgencySelfContact`). */
const selfContactSql = (column: string) =>
  `(${column} IS NULL OR ${column} IN (SELECT own_contact.id FROM contacts own_contact WHERE own_contact.tenant_id = CAST(:clientAreaTenantId AS uuid) AND own_contact.workspace_id = CAST(:clientAreaWorkspaceId AS uuid) AND own_contact.source = :clientAreaSelfSource))`;
const selfContactParams = (context: ProjectRequestContext) => ({
  clientAreaTenantId: context.tenantId,
  clientAreaWorkspaceId: context.workspaceId,
  clientAreaSelfSource: AGENCY_SELF_CONTACT_SOURCE,
});

export const clientProjectWhere = (context: ProjectRequestContext) =>
  context.clientArea
    ? {
        clientId:
          context.clientArea.agencyClientId ??
          Raw(selfContactSql, selfContactParams(context)),
      }
    : {};
/** SQL twin of `clientProjectWhere`, as `andWhere` arguments. */
export const clientAreaClientFilter = (
  column: string,
  context: ProjectRequestContext,
): [string, Record<string, unknown>] =>
  context.clientArea?.agencyClientId
    ? [
        `${column} = CAST(:clientAreaId AS uuid)`,
        { clientAreaId: context.clientArea.agencyClientId },
      ]
    : [selfContactSql(column), selfContactParams(context)];
