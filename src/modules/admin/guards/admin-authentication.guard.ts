import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AdminAuthService } from '../services/admin-auth.service';
import { AdminAuthTokenService } from '../services/admin-auth-token.service';
import type { AdminAuthenticatedRequest } from './admin-access.guard';

@Injectable()
export class AdminAuthenticationGuard implements CanActivate {
  constructor(
    private readonly tokenService: AdminAuthTokenService,
    private readonly authService: AdminAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<AdminAuthenticatedRequest>();
    const token = extractBearerToken(request);
    const payload = await this.tokenService.verifyAccessToken(token);
    request.adminPrincipal =
      await this.authService.authenticateAccessToken(payload);
    return true;
  }
}

function extractBearerToken(request: Request): string {
  const authorization = request.headers.authorization;
  if (!authorization) {
    throw new UnauthorizedException(
      'Administrative authorization is required.',
    );
  }

  const [scheme, token, extra] = authorization.trim().split(/\s+/);
  if (scheme !== 'Bearer' || !token || extra) {
    throw new UnauthorizedException('Administrative authorization is invalid.');
  }

  return token;
}
