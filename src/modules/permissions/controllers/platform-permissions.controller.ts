import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthenticatedUser } from '../../auth/decorators/authenticated-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthTokenPayload } from '../../auth/types/auth-token-payload.type';
import { getDangerousPermissionKeys } from '../catalog/permission-keys.catalog';
import { PlatformPermissionService } from '../services/platform-permission.service';
import { ClientProductKey } from '../enums/permission.enums';
import { resolveClientProductAccessPermissionKey } from './client-product-access-permission.helper';

@Controller('permissions')
export class PlatformPermissionsController {
  constructor(private readonly permissionService: PlatformPermissionService) {}

  /**
   * Returns the effective permission keys for the authenticated user in
   * their current tenant/workspace context (blueprint section 13).
   */
  @Get('effective')
  @UseGuards(JwtAuthGuard)
  async getEffectivePermissions(@AuthenticatedUser() user: AuthTokenPayload) {
    if (!user.sub || !user.tenantId) {
      throw new BadRequestException('Missing authenticated tenant context.');
    }

    const permissions = await this.permissionService.getEffectivePermissions({
      tenantId: user.tenantId,
      workspaceId: user.workspaceId,
      userId: user.sub,
      role: user.role,
    });
    const dangerousPermissionKeys = new Set(getDangerousPermissionKeys());
    const effectivePermissionKeys = [...permissions].sort();

    return {
      tenantId: user.tenantId,
      workspaceId: user.workspaceId,
      userId: user.sub,
      role: user.role,
      permissions: effectivePermissionKeys,
      dangerousPermissions: effectivePermissionKeys.filter((permissionKey) =>
        dangerousPermissionKeys.has(permissionKey),
      ),
    };
  }

  /**
   * Returns the authorized operating contexts for a product: whether the
   * agency tenant itself can use it, plus the managed clients the caller may
   * operate it for. This is the single source of truth product surfaces
   * (LeadFlow's context switcher, onboarding wizard) must use instead of
   * inferring authorization from the raw client list.
   */
  @Get('authorized-clients')
  @UseGuards(JwtAuthGuard)
  async listAuthorizedClients(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Query('productKey') productKey?: string,
  ) {
    if (!user.sub || !user.tenantId || !user.workspaceId) {
      throw new BadRequestException('Missing authenticated workspace context.');
    }

    if (
      !productKey ||
      !Object.values(ClientProductKey).includes(productKey as ClientProductKey)
    ) {
      throw new BadRequestException(
        `productKey must be one of: ${Object.values(ClientProductKey).join(', ')}.`,
      );
    }

    const context = {
      tenantId: user.tenantId,
      workspaceId: user.workspaceId,
      userId: user.sub,
      role: user.role,
    };

    const [agencyAvailable, clients] = await Promise.all([
      this.permissionService.canAccessProduct(context, productKey),
      this.permissionService.listAuthorizedManagedClients(context, productKey),
    ]);

    return {
      productKey,
      tenantId: user.tenantId,
      workspaceId: user.workspaceId,
      agency: { available: agencyAvailable },
      clients,
    };
  }

  /**
   * Read-only view of who is granted access to a product (LeadFlow, Social,
   * ...) for one managed client, from `agency_client_product_access` — the
   * table that actually authorizes (Social Settings decision D-5). Granting
   * or revoking access continues to happen in `/settings/users`; this
   * endpoint exists so a product's own settings can show who already has
   * access without inventing a parallel, unenforced permission model.
   *
   * Product-bound authorization (S1.4.7 pointed correction): this route
   * deliberately does not use `PermissionsGuard`/`@RequirePermission` — a
   * static decorator cannot pick the right key at compile time because the
   * product is a route param decided per request. Instead, exactly one
   * permission key is resolved from the requested `productKey` via
   * `resolveClientProductAccessPermissionKey` and checked with
   * `assertCan()` (the same primitive `PermissionsGuard` itself calls for
   * `@RequirePermission`) — never an OR of both products' keys. A
   * `leadflow.settings.permissions.manage.admin` holder can never satisfy a
   * `productKey=social` request, and vice versa. `canAccessClientProduct`
   * remains a second, independent fence: it proves the caller may operate
   * *this specific client's* product, which the administrative permission
   * alone does not.
   */
  @Get('clients/:clientId/products/:productKey/access')
  @UseGuards(JwtAuthGuard)
  async listClientProductAccess(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('clientId') clientId: string,
    @Param('productKey') productKey: string,
  ) {
    if (!user.sub || !user.tenantId || !user.workspaceId) {
      throw new BadRequestException('Missing authenticated workspace context.');
    }

    if (
      !Object.values(ClientProductKey).includes(productKey as ClientProductKey)
    ) {
      throw new BadRequestException(
        `productKey must be one of: ${Object.values(ClientProductKey).join(', ')}.`,
      );
    }

    const context = {
      tenantId: user.tenantId,
      workspaceId: user.workspaceId,
      userId: user.sub,
      role: user.role,
    };

    // Exactly one permission key for the requested product — never an OR
    // of both products' keys.
    const permissionKey = resolveClientProductAccessPermissionKey(productKey);
    await this.permissionService.assertCan(context, permissionKey);

    // The permission check above proves the caller may administer access
    // for *this product*, not for this specific client. Cross-tenant and
    // cross-client isolation, plus the product's own entitlement, are
    // enforced by the same check `canAccessClientProduct` uses everywhere
    // else — a client id from the URL is never trusted on its own.
    const canAccessThisClientProduct =
      await this.permissionService.canAccessClientProduct({
        ...context,
        clientId,
        productKey,
      });

    if (!canAccessThisClientProduct) {
      throw new ForbiddenException(
        `You do not have access to the "${productKey}" product for this client.`,
      );
    }

    const access = await this.permissionService.listClientProductAccess(
      user.tenantId,
      clientId,
      productKey,
    );

    return {
      clientId,
      productKey,
      access,
    };
  }
}
