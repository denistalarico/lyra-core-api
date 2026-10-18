import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { getAuthorizedContext } from '../../../common/context/authorized-context.decorator';
import type {
  ClientAreaContext,
  ClientAreaRequest,
} from '../../client-area/client-area.types';

export type AuthorizedRequestContext = ReturnType<
  typeof getAuthorizedContext
> & {
  clientArea?: ClientAreaContext;
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
        ? { clientArea: request.clientAreaContext }
        : {}),
    };
  },
);
export const clientProjectWhere = (context: ProjectRequestContext) =>
  context.clientArea ? { clientId: context.clientArea.agencyClientId } : {};
