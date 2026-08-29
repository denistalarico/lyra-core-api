import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from '../../auth/types/authenticated-request.type';
import { OperationalContextResolver } from '../../../common/context/operational-context.resolver';
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
import type { ProductKey } from '../../../common/context/request-context.interface';

const CLIENT_PRODUCT_HEADER_KEYS = new Set<ProductKey>(['leadflow', 'social']);

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
    private readonly operationalContextResolver: OperationalContextResolver,
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

    request.managedContext ??= await this.operationalContextResolver.resolve({
      request,
      tenantId: user.tenantId,
      workspaceId: user.workspaceId,
    });

    const managedContext = request.managedContext;
    let clientProductAccessSatisfied = false;

    // The client id in `managedContext` was requested through a browser header;
    // the managed tenant was resolved from the agency's client directory. The
    // resolver proves that the client belongs to this tenant/workspace and is
    // active, but it does not know whether *this user* may operate this product.
    // Every client-mode LeadFlow/Social request must additionally pass the same
    // entitlement + explicit access check used by canAccessClientProduct.
    if (
      managedContext &&
      managedContext.operatingMode === 'client' &&
      managedContext.clientId &&
      CLIENT_PRODUCT_HEADER_KEYS.has(managedContext.productKey)
    ) {
      // A product header is a request, not authority. It must name the same
      // product as the guarded route; otherwise a LeadFlow entitlement could
      // be used to enter a Social handler (or vice versa) while preserving the
      // selected client's id in the resolved context.
      if (productKey && managedContext.productKey !== productKey) {
        throw new ForbiddenException(
          `The requested context does not belong to the "${productKey}" product.`,
        );
      }

      const allowedManagedContext =
        await this.permissionService.canAccessClientProduct({
          ...context,
          clientId: managedContext.clientId,
          productKey: managedContext.productKey,
        });

      if (!allowedManagedContext) {
        await this.permissionService.auditPermissionDecision({
          tenantId: context.tenantId,
          workspaceId: context.workspaceId ?? null,
          actorUserId: context.userId,
          action: 'access_denied',
          permissionKey: `managed_context:${managedContext.productKey}`,
          resourceType: 'agency_client',
          resourceId: managedContext.clientId,
          riskLevel: 'high',
        });

        throw new ForbiddenException(
          `You do not have access to the "${managedContext.productKey}" product for this client.`,
        );
      }

      clientProductAccessSatisfied = true;
    }

    const scopeRequest = {
      method: request.method,
      routePath: request.route?.path ?? null,
      params: request.params,
      query: request.query,
      body: request.body,
    };

    if (productKey) {
      // Agency and managed-client subscriptions are deliberately independent.
      // In client mode the check above proved the selected managed tenant owns
      // this product; requiring the agency tenant to own it as well would make
      // a client-only Social/LeadFlow subscription unusable. Agency mode still
      // uses the agency tenant entitlement exactly as before.
      const allowed = clientProductAccessSatisfied
        ? true
        : await this.permissionService.canAccessProduct(context, productKey);

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
