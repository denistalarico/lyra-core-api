import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import {
  CLIENT_AREA_MODULE_KEY,
  CLIENT_AREA_PERMISSION_KEY,
} from '../client-area.decorators';
import { assertClientAreaEnabled } from '../client-area.config';
import {
  CLIENT_AREA_ERROR_CODES,
  type ClientAreaModuleKey,
  type ClientAreaPermissionKey,
  type ClientAreaRequest,
  type ClientAreaTokenPayload,
} from '../client-area.types';
import { ClientAreaAuthorizationService } from '../services/client-area-authorization.service';
import { ClientAreaSelfAccessService } from '../services/client-area-self-access.service';
import { ClientAreaSessionService } from '../services/client-area-session.service';
import { ClientAreaManagementService } from '../services/client-area-management.service';
import {
  CLIENT_AREA_JWT_STRATEGY,
  clientAreaSessionInvalidError,
} from '../strategies/client-area-jwt.strategy';

/**
 * `CLIENT_AREA_ENABLED` gate for every Client Area route, including the
 * unauthenticated login/refresh endpoints. Hiding the UI is not enough: with
 * the gate off the whole surface answers 404.
 */
@Injectable()
export class ClientAreaEnabledGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(): boolean {
    assertClientAreaEnabled(this.config);
    return true;
  }
}

/**
 * Authenticates the person: gate → `client-area-jwt` (dedicated secret,
 * `typ='client_area'`) → live `surface='client_area'` session row → identity
 * still exists and is not an Agency operator. Sets
 * `request.clientAreaIdentity`; says nothing about companies.
 *
 * Headers such as `x-tenant-id`, `x-user-id`, `x-workspace-id` or
 * `x-lyra-company-context-id` are never read: tenant and user come from the
 * verified token + session, everything else from the membership.
 */
@Injectable()
export class ClientAreaAuthGuard
  extends AuthGuard(CLIENT_AREA_JWT_STRATEGY)
  implements CanActivate
{
  constructor(
    private readonly config: ConfigService,
    private readonly sessions: ClientAreaSessionService,
    private readonly management: ClientAreaManagementService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    assertClientAreaEnabled(this.config);

    await super.canActivate(context);

    const request = context.switchToHttp().getRequest<ClientAreaRequest>();
    const payload = request.user as ClientAreaTokenPayload | undefined;

    if (!payload) {
      throw clientAreaSessionInvalidError();
    }

    request.clientAreaIdentity = await this.sessions.authenticate(payload);
    // A valid historical session must not survive the Agency application gate.
    await this.management.assertIdentityAgencyEnabled(
      request.clientAreaIdentity,
    );
    return true;
  }

  handleRequest<TUser>(error: unknown, user: TUser): TUser {
    if (error instanceof UnauthorizedException) {
      throw error;
    }

    if (error || !user) {
      throw clientAreaSessionInvalidError();
    }

    return user;
  }
}

/**
 * PD3 — routes of the agency self-context (`/client-area/self/...`).
 * Must run after `ClientAreaAuthGuard`. Resolves `request.clientAreaSelfContext`
 * and never a company context, so no company scope can leak out of here.
 *
 * Fails closed with the same generic 404 for "self not enabled", "no access",
 * "revoked", "no longer an eligible operator" and "external client": the
 * response never reveals which link of the chain failed (§28).
 */
@Injectable()
export class ClientAreaSelfContextGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly selfAccess: ClientAreaSelfAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ClientAreaRequest>();

    if (!request.clientAreaIdentity) {
      throw clientAreaSessionInvalidError();
    }

    const selfContext = await this.selfAccess.requireSelfContext(
      request.clientAreaIdentity,
    );

    const targets = [context.getHandler(), context.getClass()];
    const permission = this.reflector.getAllAndOverride<
      ClientAreaPermissionKey | undefined
    >(CLIENT_AREA_PERMISSION_KEY, targets);
    const module = this.reflector.getAllAndOverride<
      ClientAreaModuleKey | undefined
    >(CLIENT_AREA_MODULE_KEY, targets);

    // Modules are all-false in the self-context V1, so a module-gated route
    // is unreachable here by construction rather than by omission (§15).
    if (module && !selfContext.modules[module]) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: 'This module is not available in the agency self context.',
        code: CLIENT_AREA_ERROR_CODES.moduleUnavailable,
      });
    }

    if (permission && !selfContext.permissions.has(permission)) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: 'You do not have permission for this action.',
        code: CLIENT_AREA_ERROR_CODES.permissionDenied,
      });
    }

    request.clientAreaSelfContext = selfContext;
    return true;
  }
}

/**
 * Company-bound routes (`/client-area/companies/:companyContextId/...`).
 * Must run after `ClientAreaAuthGuard`. The path id is only a *request*; the
 * membership decides. Attaches `request.clientAreaContext` only after the
 * full formula (membership, company, organization, Agency Client, module,
 * permission) holds.
 */
@Injectable()
export class ClientAreaMembershipGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorization: ClientAreaAuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ClientAreaRequest>();

    if (!request.clientAreaIdentity) {
      throw clientAreaSessionInvalidError();
    }

    const targets = [context.getHandler(), context.getClass()];
    const module = this.reflector.getAllAndOverride<
      ClientAreaModuleKey | undefined
    >(CLIENT_AREA_MODULE_KEY, targets);
    const permission = this.reflector.getAllAndOverride<
      ClientAreaPermissionKey | undefined
    >(CLIENT_AREA_PERMISSION_KEY, targets);

    request.clientAreaContext = await this.authorization.authorize({
      identity: request.clientAreaIdentity,
      companyContextId: request.params?.companyContextId,
      module: module ?? null,
      permission: permission ?? null,
    });

    return true;
  }
}
