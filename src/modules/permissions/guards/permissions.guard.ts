import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from '../../auth/types/authenticated-request.type';
import {
  ANY_PERMISSION_KEYS_METADATA,
  CLIENT_ACCESS_METADATA,
  CLIENT_PRODUCT_ACCESS_METADATA,
  DANGEROUS_ACTION_METADATA,
  PERMISSION_KEY_METADATA,
  PRODUCT_ENTITLEMENT_METADATA,
  RequireClientAccessOptions,
  RequireClientProductAccessOptions,
} from '../decorators/permissions.decorators';
import { PlatformPermissionService } from '../services/platform-permission.service';
import { PermissionContext } from '../types/permission-context.types';

/**
 * Enforces the permission/entitlement/client-access metadata declared via
 * {@link RequirePermission}, {@link RequireProductEntitlement},
 * {@link RequireClientAccess}, {@link RequireClientProductAccess} and
 * {@link DangerousAction}.
 *
 * This guard is additive: routes without any of these decorators are
 * allowed through unchanged, so existing controllers keep working until
 * they opt in.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionService: PlatformPermissionService,
  ) {}

  async canActivate(executionContext: ExecutionContext): Promise<boolean> {
    const request = executionContext
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();
    const user = request.user;

    const targets = [
      executionContext.getHandler(),
      executionContext.getClass(),
    ];

    const productKey = this.reflector.getAllAndOverride<string | undefined>(
      PRODUCT_ENTITLEMENT_METADATA,
      targets,
    );

    const permissionKey = this.reflector.getAllAndOverride<string | undefined>(
      PERMISSION_KEY_METADATA,
      targets,
    );

    const anyPermissionKeys = this.reflector.getAllAndOverride<
      string[] | undefined
    >(ANY_PERMISSION_KEYS_METADATA, targets);

    const clientAccess = this.reflector.getAllAndOverride<
      RequireClientAccessOptions | undefined
    >(CLIENT_ACCESS_METADATA, targets);

    const clientProductAccess = this.reflector.getAllAndOverride<
      RequireClientProductAccessOptions | undefined
    >(CLIENT_PRODUCT_ACCESS_METADATA, targets);

    const isDangerous = this.reflector.getAllAndOverride<boolean | undefined>(
      DANGEROUS_ACTION_METADATA,
      targets,
    );

    const hasPermissionRequirements =
      Boolean(productKey) ||
      Boolean(permissionKey) ||
      Boolean(anyPermissionKeys?.length) ||
      Boolean(clientAccess) ||
      Boolean(clientProductAccess) ||
      Boolean(isDangerous);

    if (!hasPermissionRequirements) {
      return true;
    }

    if (!user?.sub || !user.tenantId) {
      throw new UnauthorizedException(
        'Authenticated user context is required.',
      );
    }

    const context: PermissionContext = {
      tenantId: user.tenantId,
      workspaceId: user.workspaceId,
      userId: user.sub,
      role: user.role,
    };
    const scopeRequest = {
      method: request.method,
      routePath: request.route?.path ?? null,
      params: request.params,
      query: request.query,
      body: request.body,
    };

    if (productKey) {
      const allowed = await this.permissionService.canAccessProduct(
        context,
        productKey,
      );

      if (!allowed) {
        throw new ForbiddenException(
          `Product "${productKey}" is not enabled for this tenant.`,
        );
      }
    }

    if (permissionKey) {
      await this.permissionService.assertCan(
        context,
        permissionKey,
        scopeRequest,
      );
    }

    if (anyPermissionKeys?.length) {
      await this.permissionService.assertAny(
        context,
        anyPermissionKeys,
        scopeRequest,
      );
    }

    if (clientAccess) {
      const clientId = String(request.params[clientAccess.param ?? 'clientId']);
      const allowed = await this.permissionService.canAccessClient({
        ...context,
        clientId,
        requiredLevel: clientAccess.level,
      });

      if (!allowed) {
        throw new ForbiddenException('You do not have access to this client.');
      }
    }

    if (clientProductAccess) {
      const clientId = String(
        request.params[clientProductAccess.param ?? 'clientId'],
      );
      const allowed = await this.permissionService.canAccessClientProduct({
        ...context,
        clientId,
        productKey: clientProductAccess.productKey,
        requiredRole: clientProductAccess.role,
      });

      if (!allowed) {
        throw new ForbiddenException(
          `You do not have access to the "${clientProductAccess.productKey}" product for this client.`,
        );
      }
    }

    if (isDangerous) {
      await this.permissionService.auditPermissionDecision({
        tenantId: context.tenantId,
        workspaceId: context.workspaceId ?? null,
        actorUserId: context.userId,
        action: 'dangerous_action_executed',
        permissionKey: permissionKey ?? anyPermissionKeys?.join('|') ?? null,
        riskLevel: permissionKey
          ? this.permissionService.isDangerousAction(permissionKey)
            ? 'critical'
            : null
          : anyPermissionKeys?.some((key) =>
                this.permissionService.isDangerousAction(key),
              )
            ? 'critical'
            : null,
        resourceType: request.route?.path,
      });
    }

    return true;
  }
}
