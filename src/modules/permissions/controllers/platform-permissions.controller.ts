import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthenticatedUser } from '../../auth/decorators/authenticated-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthTokenPayload } from '../../auth/types/auth-token-payload.type';
import { getDangerousPermissionKeys } from '../catalog/permission-keys.catalog';
import { PlatformPermissionService } from '../services/platform-permission.service';
import { ClientProductKey } from '../enums/permission.enums';

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
      !Object.values(ClientProductKey).includes(
        productKey as ClientProductKey,
      )
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
}
