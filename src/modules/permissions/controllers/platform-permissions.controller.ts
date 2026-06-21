import {
  BadRequestException,
  Controller,
  Get,
  UseGuards,
} from '@nestjs/common';
import { AuthenticatedUser } from '../../auth/decorators/authenticated-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthTokenPayload } from '../../auth/types/auth-token-payload.type';
import { getDangerousPermissionKeys } from '../catalog/permission-keys.catalog';
import { PlatformPermissionService } from '../services/platform-permission.service';

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
}
