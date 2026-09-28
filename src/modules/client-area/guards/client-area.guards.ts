import {
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
import type {
  ClientAreaModuleKey,
  ClientAreaPermissionKey,
  ClientAreaRequest,
  ClientAreaTokenPayload,
} from '../client-area.types';
import { ClientAreaAuthorizationService } from '../services/client-area-authorization.service';
import { ClientAreaSessionService } from '../services/client-area-session.service';
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
