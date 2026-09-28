import {
  createParamDecorator,
  SetMetadata,
  type ExecutionContext,
} from '@nestjs/common';
import type {
  ClientAreaContext,
  ClientAreaModuleKey,
  ClientAreaPermissionKey,
  ClientAreaRequest,
} from './client-area.types';

export const CLIENT_AREA_PERMISSION_KEY = 'client_area:permission';
export const CLIENT_AREA_MODULE_KEY = 'client_area:module';

/** Permission the membership role preset must grant for this route. */
export const RequireClientAreaPermission = (
  permission: ClientAreaPermissionKey,
) => SetMetadata(CLIENT_AREA_PERMISSION_KEY, permission);

/** Module that must be available for the company on this route. */
export const RequireClientAreaModule = (module: ClientAreaModuleKey) =>
  SetMetadata(CLIENT_AREA_MODULE_KEY, module);

/**
 * The context `ClientAreaMembershipGuard` resolved for this request. Only
 * present on company-bound routes, after the full authorization formula.
 */
export const ClientAreaContextData = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ClientAreaContext => {
    const request = ctx.switchToHttp().getRequest<ClientAreaRequest>();

    if (!request.clientAreaContext) {
      // A handler asking for the context without the guard is a wiring bug;
      // failing loudly beats running with no authorization at all.
      throw new Error(
        'ClientAreaContext requested without ClientAreaMembershipGuard.',
      );
    }

    return request.clientAreaContext;
  },
);
