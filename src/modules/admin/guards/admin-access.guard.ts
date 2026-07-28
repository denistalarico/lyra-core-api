import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ADMIN_PERMISSIONS_METADATA } from '../decorators/require-admin-permissions.decorator';
import { AdminAccessService } from '../services/admin-access.service';
import type {
  AdminPrincipal,
  PlatformAdminPermission,
} from '../types/admin-access.types';

export type AdminAuthenticatedRequest = Request & {
  adminPrincipal?: AdminPrincipal;
};

@Injectable()
export class AdminAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessService: AdminAccessService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<AdminAuthenticatedRequest>();
    const principal = request.adminPrincipal;

    if (!principal) {
      throw new UnauthorizedException('Administrative principal is required.');
    }

    if (principal.sessionContext !== 'admin') {
      throw new ForbiddenException('Invalid administrative session context.');
    }

    const required =
      this.reflector.getAllAndOverride<
        readonly PlatformAdminPermission[] | undefined
      >(ADMIN_PERMISSIONS_METADATA, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    if (
      !this.accessService.hasAllPermissions(principal.permissions, required)
    ) {
      throw new ForbiddenException('Administrative permission denied.');
    }

    return true;
  }
}
