import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PlatformPermissionService } from '../../permissions/services/platform-permission.service';
import type { AuthenticatedRequest } from '../../auth/types/authenticated-request.type';

/** Assigned visibility at this new boundary, without changing Agency guards. */
@Injectable()
export class CompanyProductClientAccessGuard implements CanActivate {
  constructor(private readonly permissions: PlatformPermissionService) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (req.user.role === 'owner' || req.user.role === 'admin') return true;
    const allowed = await this.permissions.canAccessClient({
      tenantId: req.user.tenantId,
      workspaceId: req.user.workspaceId,
      userId: req.user.sub,
      role: req.user.role,
      clientId: String(req.params.clientId),
    });
    if (!allowed) throw new NotFoundException('Client not found.');
    return true;
  }
}
