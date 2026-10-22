import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { IsNull } from 'typeorm';
import { getAuthorizedContext } from '../../../common/context/authorized-context.decorator';
import type { ClientAreaRequest } from '../../client-area/client-area.types';

/**
 * The client a Client Area request is confined to. `null` is the agency in its
 * own Client Area (CA15 / D-CA15-2): only internal projects (no client).
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
  Partial<Pick<AuthorizedRequestContext, 'role' | 'clientArea'>>;

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
export const clientProjectWhere = (context: ProjectRequestContext) =>
  context.clientArea
    ? { clientId: context.clientArea.agencyClientId ?? IsNull() }
    : {};
/** SQL twin of `clientProjectWhere`; matches `null` (internal) too. */
export const CLIENT_AREA_CLIENT_SQL = (column: string) =>
  `${column} IS NOT DISTINCT FROM CAST(:clientAreaId AS uuid)`;
